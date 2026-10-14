import {
  BetRequest,
  type ErrorCode,
  HistoryQuery,
  IdempotencyKey,
  RotateSeedRequest,
} from '@drop-win/contract';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getSignedCookie, setSignedCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as z from 'zod/mini';
import type { AppConfig } from './config.ts';
import type { LedgerError, PlayerStore } from './ledger.ts';
import type { RateLimiter } from './rate-limit.ts';

export interface AppDeps {
  config: AppConfig;
  players: PlayerStore;
  limiter: RateLimiter;
  /** Best available client address, used only as a rate-limit key. */
  clientIp: (c: Context) => string;
  newPlayerId?: () => string;
  logError?: (error: unknown) => void;
}

interface Env {
  Variables: { playerId: string };
}

const COOKIE_NAME = 'dw_session';
const COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const MAX_BODY_BYTES = 2 * 1024;
const PlayerId = z.uuid();

const LEDGER_STATUS: Record<LedgerError, { status: ContentfulStatusCode; code: ErrorCode }> = {
  not_found: { status: 401, code: 'unauthorized' },
  insufficient_funds: { status: 422, code: 'insufficient_funds' },
  idempotency_conflict: { status: 409, code: 'idempotency_conflict' },
  refill_not_allowed: { status: 409, code: 'refill_not_allowed' },
  busy: { status: 503, code: 'busy' },
};

const LEDGER_MESSAGES: Record<LedgerError, string> = {
  not_found: 'Session expired. Reload to start a new one.',
  insufficient_funds: 'Not enough balance for that bet.',
  idempotency_conflict: 'This idempotency key was already used for a different bet.',
  refill_not_allowed: 'Refills are only available when the balance is below the minimum bet.',
  busy: 'Another request for this player is in progress. Retry with the same key.',
};

function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  error: ErrorCode,
  message: string,
) {
  return c.json({ error, message }, status);
}

function describeIssues(error: z.core.$ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')}: ` : '') + issue.message)
    .join('; ');
}

async function readJson(c: Context): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

function isSameOrigin(c: Context, origin: string): boolean {
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}

export function createApp(deps: AppDeps): Hono<Env> {
  const { config, players, limiter } = deps;
  const newPlayerId = deps.newPlayerId ?? (() => crypto.randomUUID());
  const cookiePrefix = config.cookieSecure ? 'host' : undefined;
  const app = new Hono<Env>();

  app.onError((error, c) => {
    deps.logError?.(error);
    return errorResponse(c, 500, 'internal', 'Something went wrong.');
  });
  app.notFound((c) => errorResponse(c, 404, 'not_found', 'No such endpoint.'));

  app.use(
    '/api/*',
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      crossOriginResourcePolicy: 'same-site',
      referrerPolicy: 'no-referrer',
      xFrameOptions: 'DENY',
    }),
  );

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.use(
    '/api/*',
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST'],
      allowHeaders: ['Content-Type', 'Idempotency-Key'],
      maxAge: 600,
    }),
  );

  // Cross-site request forgery: state-changing requests must come from the
  // app's own origin or a configured one, and must be JSON. A cross-site form
  // cannot send application/json without a CORS preflight, which fails for
  // unknown origins.
  const sameOriginJson = createMiddleware<Env>(async (c, next) => {
    if (c.req.method === 'POST') {
      const origin = c.req.header('Origin');
      if (origin && !isSameOrigin(c, origin) && !config.allowedOrigins.includes(origin)) {
        return errorResponse(c, 403, 'forbidden_origin', 'Origin not allowed.');
      }
      const type = c.req.header('Content-Type') ?? '';
      if (!/^application\/json(;|$)/i.test(type)) {
        return errorResponse(c, 415, 'unsupported_media_type', 'Send application/json.');
      }
    }
    return next();
  });
  app.use('/api/*', sameOriginJson);

  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => errorResponse(c, 413, 'payload_too_large', 'Request body too large.'),
    }),
  );

  const ipLimit = createMiddleware<Env>(async (c, next) => {
    if (!(await limiter.limit('api', deps.clientIp(c)))) {
      c.header('Retry-After', '60');
      return errorResponse(c, 429, 'rate_limited', 'Too many requests. Slow down a little.');
    }
    return next();
  });
  app.use('/api/*', ipLimit);

  app.get('/api/health', (c) => c.json({ ok: true }));

  const readPlayerId = async (c: Context): Promise<string | undefined> => {
    const value = await getSignedCookie(c, config.sessionSecret, COOKIE_NAME, cookiePrefix);
    if (!value) return undefined;
    const parsed = PlayerId.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  };

  const writeSession = (c: Context, playerId: string) =>
    setSignedCookie(c, COOKIE_NAME, playerId, config.sessionSecret, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: config.cookieSameSite,
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
      ...(cookiePrefix ? { prefix: cookiePrefix } : {}),
    });

  // Creates an anonymous player, or resumes the one named by the cookie.
  app.post('/api/session', async (c) => {
    const existing = await readPlayerId(c);
    if (existing) {
      const state = await players.state(existing);
      if (state) {
        await writeSession(c, existing);
        return c.json(state, 200);
      }
    }
    if (!(await limiter.limit('session', deps.clientIp(c)))) {
      c.header('Retry-After', '60');
      return errorResponse(c, 429, 'rate_limited', 'Too many new sessions from this address.');
    }
    const playerId = newPlayerId();
    const state = await players.create(playerId);
    await writeSession(c, playerId);
    return c.json(state, 201);
  });

  const requireSession = createMiddleware<Env>(async (c, next) => {
    const playerId = await readPlayerId(c);
    if (!playerId) return errorResponse(c, 401, 'unauthorized', 'No valid session.');
    c.set('playerId', playerId);
    return next();
  });

  app.get('/api/state', requireSession, async (c) => {
    const state = await players.state(c.get('playerId'));
    if (!state) return errorResponse(c, 401, 'unauthorized', LEDGER_MESSAGES.not_found);
    return c.json(state);
  });

  app.post('/api/bets', requireSession, async (c) => {
    const key = IdempotencyKey.safeParse(c.req.header('Idempotency-Key'));
    if (!key.success) {
      return errorResponse(c, 400, 'bad_request', 'Idempotency-Key header must be a UUID.');
    }
    const body = await readJson(c);
    if (!body.ok) return errorResponse(c, 400, 'bad_request', 'Body is not valid JSON.');
    const request = BetRequest.safeParse(body.value);
    if (!request.success) {
      return errorResponse(c, 400, 'bad_request', describeIssues(request.error));
    }
    const playerId = c.get('playerId');
    if (!(await limiter.limit('bet', playerId))) {
      c.header('Retry-After', '10');
      return errorResponse(c, 429, 'rate_limited', 'Too many bets. Slow down a little.');
    }
    const result = await players.bet(playerId, request.data, key.data);
    if (!result.ok) {
      const { status, code } = LEDGER_STATUS[result.error];
      return errorResponse(c, status, code, LEDGER_MESSAGES[result.error]);
    }
    return c.json(result.value, result.value.replayed ? 200 : 201);
  });

  app.get('/api/bets', requireSession, async (c) => {
    const query = HistoryQuery.safeParse(c.req.query());
    if (!query.success) return errorResponse(c, 400, 'bad_request', describeIssues(query.error));
    const before = query.data.before === undefined ? undefined : Number(query.data.before);
    return c.json(await players.history(c.get('playerId'), before));
  });

  app.post('/api/seeds/rotate', requireSession, async (c) => {
    const body = await readJson(c);
    if (!body.ok) return errorResponse(c, 400, 'bad_request', 'Body is not valid JSON.');
    const request = RotateSeedRequest.safeParse(body.value);
    if (!request.success) {
      return errorResponse(c, 400, 'bad_request', describeIssues(request.error));
    }
    const result = await players.rotateSeed(c.get('playerId'), request.data.clientSeed);
    if (!result.ok) {
      const { status, code } = LEDGER_STATUS[result.error];
      return errorResponse(c, status, code, LEDGER_MESSAGES[result.error]);
    }
    return c.json(result.value);
  });

  app.post('/api/balance/refill', requireSession, async (c) => {
    const result = await players.refill(c.get('playerId'));
    if (!result.ok) {
      const { status, code } = LEDGER_STATUS[result.error];
      return errorResponse(c, status, code, LEDGER_MESSAGES[result.error]);
    }
    return c.json(result.value);
  });

  return app;
}
