import {
  BetPage,
  BetReceipt,
  type BetRequest,
  ErrorBody,
  PlayerState,
  SeedRotation,
} from '@drop-win/contract';
import { type GameBackend, GameError } from './types.ts';

interface Parser<T> {
  parse(value: unknown): T;
}

interface CallInit {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
}

export interface HttpBackendOptions {
  /** Origin of the API, or '' when it is served from the same origin as the app. */
  base: string;
  fetch?: typeof fetch;
}

/** The house on a server: the Node API or the Cloudflare Worker. */
export function createHttpBackend({ base, fetch: send = fetch }: HttpBackendOptions): GameBackend {
  async function call<T>(path: string, schema: Parser<T>, init: CallInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...init.headers },
      });
    } catch {
      throw new GameError(0, 'network', 'Could not reach the server.');
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = ErrorBody.safeParse(body);
      if (parsed.success) {
        throw new GameError(response.status, parsed.data.error, parsed.data.message);
      }
      throw new GameError(
        response.status,
        'internal',
        `Unexpected response (${String(response.status)}).`,
      );
    }
    // The server is trusted to be honest about outcomes (that is what the
    // verifier is for), but not to be well formed.
    return schema.parse(body);
  }

  const post = (body: unknown, headers: Record<string, string> = {}): CallInit => ({
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });

  return {
    mode: 'server',
    session: () => call('/api/session', PlayerState, post({})),
    state: () => call('/api/state', PlayerState),
    history: (before?: string) =>
      call(`/api/bets${before ? `?before=${encodeURIComponent(before)}` : ''}`, BetPage),
    bet: (request: BetRequest, idempotencyKey: string) =>
      call('/api/bets', BetReceipt, post(request, { 'Idempotency-Key': idempotencyKey })),
    rotateSeed: (clientSeed: string) =>
      call('/api/seeds/rotate', SeedRotation, post({ clientSeed })),
    refill: () => call('/api/balance/refill', PlayerState, post({})),
  };
}
