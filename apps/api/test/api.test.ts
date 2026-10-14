import {
  BetReceipt,
  ErrorBody,
  MAX_BET_CENTS,
  PlayerState,
  RATE_LIMITS,
  SeedRotation,
} from '@drop-win/contract';
import { computeRound, sha256Hex } from '@drop-win/fairness';
import { describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, Client, makeApp } from './helpers.ts';

const bet = { amountCents: 100, rows: 12, risk: 'medium' } as const;

async function startSession(options: Parameters<typeof makeApp>[0] = {}) {
  const ctx = makeApp(options);
  const client = new Client(ctx.app);
  const response = await client.post('/api/session', {});
  expect(response.status).toBe(201);
  const state = PlayerState.parse(await response.json());
  return { ...ctx, client, state };
}

async function errorOf(response: Response) {
  return ErrorBody.parse(await response.json()).error;
}

describe('sessions', () => {
  it('issues a signed, HttpOnly, SameSite=Strict cookie and resumes it', async () => {
    const ctx = makeApp();
    const client = new Client(ctx.app);
    const created = await client.post('/api/session', {});
    expect(created.status).toBe(201);
    const cookie = created.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^dw_session=[0-9a-f-]{36}\.[^;]+;/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const resumed = await client.post('/api/session', {});
    expect(resumed.status).toBe(200);
    expect(PlayerState.parse(await resumed.json())).toEqual(
      PlayerState.parse(await created.json()),
    );
  });

  it('uses a Secure __Host- cookie in production', async () => {
    const ctx = makeApp({ env: { APP_ENV: 'production' } });
    const response = await new Client(ctx.app).post('/api/session', {});
    const cookie = response.headers.get('Set-Cookie') ?? '';
    expect(cookie).toMatch(/^__Host-dw_session=/);
    expect(cookie).toContain('Secure');
  });

  it('rejects a cookie whose signature does not match', async () => {
    const { client } = await startSession();
    const [name, value] = client.cookie.split('=');
    const [id, signature] = (value ?? '').split('.');
    const forgedId = (id ?? '').replace(/^./, (ch) => (ch === 'a' ? 'b' : 'a'));
    client.cookie = `${name ?? ''}=${forgedId}.${signature ?? ''}`;
    const response = await client.request('/api/state');
    expect(response.status).toBe(401);
  });

  it('requires a session for player endpoints', async () => {
    const client = new Client(makeApp().app);
    expect((await client.request('/api/state')).status).toBe(401);
    expect((await client.bet(bet)).status).toBe(401);
    expect((await client.request('/api/bets')).status).toBe(401);
    expect((await client.post('/api/seeds/rotate', { clientSeed: 'x' })).status).toBe(401);
  });
});

describe('placing bets', () => {
  it('returns a receipt whose result the fairness package reproduces after rotation', async () => {
    const { client, state } = await startSession();
    const response = await client.bet(bet);
    expect(response.status).toBe(201);
    const receipt = BetReceipt.parse(await response.json());
    expect(receipt.bet.serverSeed).toBeNull();
    expect(receipt.bet.serverSeedHash).toBe(state.seed.serverSeedHash);

    const rotated = SeedRotation.parse(
      await (await client.post('/api/seeds/rotate', { clientSeed: 'fresh' })).json(),
    );
    expect(await sha256Hex(rotated.revealed.serverSeed)).toBe(state.seed.serverSeedHash);
    const round = await computeRound({
      serverSeed: rotated.revealed.serverSeed,
      clientSeed: receipt.bet.clientSeed,
      nonce: receipt.bet.nonce,
      rows: receipt.bet.rows,
      risk: receipt.bet.risk,
    });
    expect(round.path).toBe(receipt.bet.path);
    expect(round.multiplierHundredths).toBe(receipt.bet.multiplierHundredths);
  });

  it('increments the nonce on every bet', async () => {
    const { client } = await startSession();
    const nonces = [];
    for (let i = 0; i < 5; i++) {
      nonces.push(BetReceipt.parse(await (await client.bet(bet)).json()).bet.nonce);
    }
    expect(nonces).toEqual([0, 1, 2, 3, 4]);
    const state = PlayerState.parse(await (await client.request('/api/state')).json());
    expect(state.seed.nonce).toBe(5);
  });

  it.each([
    ['zero amount', { ...bet, amountCents: 0 }],
    ['negative amount', { ...bet, amountCents: -500 }],
    ['fractional cents', { ...bet, amountCents: 99.5 }],
    ['amount over the maximum', { ...bet, amountCents: MAX_BET_CENTS + 1 }],
    ['amount as a string', { ...bet, amountCents: '100' }],
    ['seven rows', { ...bet, rows: 7 }],
    ['seventeen rows', { ...bet, rows: 17 }],
    ['unknown risk', { ...bet, risk: 'yolo' }],
    ['a client-chosen multiplier', { ...bet, multiplierHundredths: 100_000 }],
    ['an array', [bet]],
  ])('rejects %s with 400', async (_label, body) => {
    const { client } = await startSession();
    const response = await client.bet(body);
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toBe('bad_request');
  });

  it('rejects a missing or malformed idempotency key', async () => {
    const { client } = await startSession();
    const missing = await client.post('/api/bets', bet);
    expect(missing.status).toBe(400);
    const malformed = await client.bet(bet, 'not-a-uuid');
    expect(malformed.status).toBe(400);
  });

  it('rejects invalid JSON, non-JSON bodies and oversized bodies', async () => {
    const { client } = await startSession();
    const key = { 'Idempotency-Key': crypto.randomUUID() };
    const invalid = await client.request('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...key },
      body: '{"amountCents":',
    });
    expect(invalid.status).toBe(400);

    const form = await client.request('/api/bets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...key },
      body: 'amountCents=100&rows=8&risk=low',
    });
    expect(form.status).toBe(415);

    const huge = await client.post('/api/bets', { ...bet, padding: 'x'.repeat(5000) }, key);
    expect(huge.status).toBe(413);
  });

  it('refuses bets the balance cannot cover', async () => {
    const { client, db } = await startSession();
    db.run('UPDATE players SET balance_cents = 99');
    const response = await client.bet(bet);
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toBe('insufficient_funds');
  });

  it('replays an idempotent retry and rejects reuse for a different bet', async () => {
    const { client } = await startSession();
    const key = crypto.randomUUID();
    const first = BetReceipt.parse(await (await client.bet(bet, key)).json());
    const retry = await client.bet(bet, key);
    expect(retry.status).toBe(200);
    const replayed = BetReceipt.parse(await retry.json());
    expect(replayed.replayed).toBe(true);
    expect(replayed.bet.id).toBe(first.bet.id);
    expect(replayed.state.balanceCents).toBe(first.state.balanceCents);

    const conflict = await client.bet({ ...bet, amountCents: 200 }, key);
    expect(conflict.status).toBe(409);
  });

  it('rate limits bets per player', async () => {
    const { client } = await startSession();
    const statuses = [];
    for (let i = 0; i < RATE_LIMITS.bet.limit; i++) {
      statuses.push((await client.bet({ ...bet, amountCents: 10 })).status);
    }
    expect(statuses.every((s) => s === 201)).toBe(true);
    const last = await client.bet({ ...bet, amountCents: 10 });
    expect(last.status).toBe(429);
    expect(last.headers.get('Retry-After')).toBe('10');
  });
});

describe('seed rotation', () => {
  it('validates the new client seed', async () => {
    const { client } = await startSession();
    for (const clientSeed of ['', 'has spaces', 'a'.repeat(65), 'a:b']) {
      expect((await client.post('/api/seeds/rotate', { clientSeed })).status).toBe(400);
    }
  });

  it('marks earlier bets as revealed in the history', async () => {
    const { client } = await startSession();
    await client.bet(bet);
    const before: unknown = await (await client.request('/api/bets')).json();
    expect(JSON.stringify(before)).toContain('"serverSeed":null');
    const rotated = SeedRotation.parse(
      await (await client.post('/api/seeds/rotate', { clientSeed: 'second' })).json(),
    );
    const after = (await (await client.request('/api/bets')).json()) as {
      bets: { serverSeed: string | null }[];
    };
    expect(after.bets[0]?.serverSeed).toBe(rotated.revealed.serverSeed);
  });
});

describe('refill', () => {
  it('only refills an empty balance', async () => {
    const { client, db } = await startSession();
    expect((await client.post('/api/balance/refill', {})).status).toBe(409);
    db.run('UPDATE players SET balance_cents = 0');
    const response = await client.post('/api/balance/refill', {});
    expect(response.status).toBe(200);
    expect(PlayerState.parse(await response.json()).balanceCents).toBeGreaterThan(0);
  });
});

describe('origin checks and CORS', () => {
  it('blocks state-changing requests from unknown origins', async () => {
    const { client } = await startSession();
    const response = await client.bet(bet, crypto.randomUUID());
    expect(response.status).toBe(201);
    const foreign = await client.post('/api/bets', bet, {
      'Idempotency-Key': crypto.randomUUID(),
      Origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows the configured origin with credentials', async () => {
    const { client } = await startSession();
    const preflight = await client.request('/api/bets', {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,idempotency-key',
      },
    });
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBe('true');

    const response = await client.post('/api/bets', bet, {
      'Idempotency-Key': crypto.randomUUID(),
      Origin: ALLOWED_ORIGIN,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
  });

  it('does not answer preflights from unknown origins', async () => {
    const client = new Client(makeApp().app);
    const preflight = await client.request('/api/bets', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('hardening', () => {
  it('sends security headers and disables caching', async () => {
    const client = new Client(makeApp().app);
    const response = await client.request('/api/health');
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rate limits by client address', async () => {
    const client = new Client(makeApp().app);
    let status = 200;
    for (let i = 0; i <= RATE_LIMITS.api.limit; i++) {
      status = (await client.request('/api/health')).status;
    }
    expect(status).toBe(429);
  });

  it('limits how many sessions one address can create', async () => {
    const { app } = makeApp();
    let status = 201;
    for (let i = 0; i <= RATE_LIMITS.session.limit; i++) {
      status = (await new Client(app).post('/api/session', {})).status;
    }
    expect(status).toBe(429);
  });

  it('answers unknown routes with JSON 404', async () => {
    const response = await new Client(makeApp().app).request('/api/nope');
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe('not_found');
  });

  it('hides internal errors', async () => {
    const ctx = makeApp();
    ctx.db.close();
    const response = await new Client(ctx.app).post('/api/session', {});
    expect(response.status).toBe(500);
    const body = ErrorBody.parse(await response.json());
    expect(body).toEqual({ error: 'internal', message: 'Something went wrong.' });
  });
});
