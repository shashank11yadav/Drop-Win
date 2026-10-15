// Server mode and browser mode must be the same game. This drives the real
// HTTP API (Hono on node:sqlite) and the real browser house (over a
// MessageChannel, as the page talks to its worker) through the same script,
// with the same seed source and clock, and requires identical results.

import { MAX_BET_CENTS, MIN_BET_CENTS } from '@drop-win/contract';
import { computeRound, payoutCents, RISKS, ROW_COUNTS, sha256Hex } from '@drop-win/fairness';
import { Ledger, type LedgerOptions } from '@drop-win/ledger';
import { describe, expect, it } from 'vitest';
import { createApp } from '../apps/api/src/app.ts';
import { loadConfig } from '../apps/api/src/config.ts';
import { openNodeSqlite } from '../apps/api/src/node-sqlite.ts';
import { SqlStore } from '../apps/api/src/sql-store.ts';
import { BrowserBackend } from '../apps/web/src/backend/browser.ts';
import { createHttpBackend } from '../apps/web/src/backend/http.ts';
import { type GameBackend, GameError } from '../apps/web/src/backend/types.ts';
import { House, serveHouse } from '../apps/web/src/house/house.ts';

/** Deterministic bytes (xorshift32), so both houses draw the same seeds. */
function fixedRandom(seed: number): (byteLength: number) => string {
  let state = seed >>> 0 || 1;
  return (byteLength) => {
    let hex = '';
    for (let i = 0; i < byteLength; i++) {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      hex += (state & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
  };
}

function ledgerOptions(seed: number): LedgerOptions {
  return { randomHex: fixedRandom(seed), now: () => 1_760_000_000_000 };
}

function serverBackend(seed: number): GameBackend {
  const app = createApp({
    config: loadConfig({ APP_ENV: 'test', SESSION_SECRET: 'parity-test-secret-0123456789abcdef' })
      .config,
    players: new Ledger(new SqlStore(openNodeSqlite(':memory:')), ledgerOptions(seed)),
    // Rate limits are a server concern with no browser equivalent; the
    // script below places more bets than the per-player limit allows.
    limiter: { limit: () => Promise.resolve(true) },
    clientIp: () => '203.0.113.9',
  });
  let cookie = '';
  const viaApp: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('Cookie', cookie);
    const response = await app.request(input, { ...init, headers });
    const setCookie = response.headers.get('Set-Cookie');
    if (setCookie) cookie = setCookie.split(';')[0] ?? '';
    return response;
  };
  return createHttpBackend({ base: 'http://localhost', fetch: viaApp });
}

function browserBackend(seed: number): { backend: GameBackend; close: () => void } {
  const channel = new MessageChannel();
  serveHouse(channel.port2, new House({ storage: null, ledger: ledgerOptions(seed) }));
  const backend = new BrowserBackend(channel.port1);
  channel.port1.start();
  channel.port2.start();
  return {
    backend,
    close: () => {
      channel.port1.close();
    },
  };
}

type Step = (backend: GameBackend) => Promise<unknown>;

/** A bet script covering every row count and risk, small and large stakes. */
function script(): { name: string; run: Step }[] {
  const keys = Array.from({ length: 60 }, () => crypto.randomUUID());
  const steps: { name: string; run: Step }[] = [{ name: 'session', run: (b) => b.session() }];
  const bet = (i: number) => ({
    amountCents: [MIN_BET_CENTS, 100, 2_500, 777, MAX_BET_CENTS / 10][i % 5] ?? 100,
    rows: ROW_COUNTS[i % ROW_COUNTS.length] ?? 8,
    risk: RISKS[i % RISKS.length] ?? 'low',
  });
  for (let i = 0; i < 30; i++) {
    steps.push({ name: `bet ${String(i)}`, run: (b) => b.bet(bet(i), keys[i] ?? '') });
  }
  steps.push(
    { name: 'retry bet 5', run: (b) => b.bet(bet(5), keys[5] ?? '') },
    { name: 'reuse key 5', run: (b) => b.bet({ ...bet(5), amountCents: 999 }, keys[5] ?? '') },
    { name: 'zero bet', run: (b) => b.bet({ ...bet(0), amountCents: 0 }, keys[59] ?? '') },
    { name: 'refill', run: (b) => b.refill() },
    { name: 'history', run: (b) => b.history() },
    {
      name: 'history page 2',
      run: async (b) => b.history((await b.history()).nextBefore ?? undefined),
    },
    { name: 'rotate', run: (b) => b.rotateSeed('parity-check') },
  );
  for (let i = 30; i < 45; i++) {
    steps.push({ name: `bet ${String(i)}`, run: (b) => b.bet(bet(i), keys[i] ?? '') });
  }
  steps.push(
    { name: 'state', run: (b) => b.state() },
    { name: 'rotate again', run: (b) => b.rotateSeed('second-check') },
    { name: 'final history', run: (b) => b.history() },
  );
  return steps;
}

async function record(backend: GameBackend, steps: { name: string; run: Step }[]) {
  const results: { name: string; result: unknown }[] = [];
  for (const step of steps) {
    try {
      results.push({ name: step.name, result: await step.run(backend) });
    } catch (error) {
      if (!(error instanceof GameError)) throw error;
      results.push({
        name: step.name,
        result: { status: error.status, code: error.code, message: error.message },
      });
    }
  }
  return results;
}

describe('server and browser modes', () => {
  it('produce identical outcomes, payouts, errors and reveals for the same seeds', async () => {
    const steps = script();
    const server = await record(serverBackend(2024), steps);
    const browser = browserBackend(2024);
    const local = await record(browser.backend, steps);
    browser.close();

    expect(local).toHaveLength(steps.length);
    for (const [i, step] of steps.entries()) {
      expect(local[i], step.name).toEqual(server[i]);
    }

    // The script really exercised what it claims to.
    const byName = new Map(server.map((s) => [s.name, s.result]));
    expect(byName.get('retry bet 5')).toMatchObject({ replayed: true });
    expect(byName.get('reuse key 5')).toMatchObject({ status: 409 });
    expect(byName.get('zero bet')).toMatchObject({ status: 400, code: 'bad_request' });
    expect(byName.get('refill')).toMatchObject({ status: 409, code: 'refill_not_allowed' });
    const buckets = new Set(
      server.flatMap((s) =>
        s.name.startsWith('bet ') ? [(s.result as { bet: { bucket: number } }).bet.bucket] : [],
      ),
    );
    expect(buckets.size).toBeGreaterThan(4);
  });

  it('settle each bet exactly as the fairness package computes it from the revealed seed', async () => {
    const browser = browserBackend(7);
    const { backend } = browser;
    const start = await backend.session();
    const placed = [];
    for (let i = 0; i < 20; i++) {
      placed.push(
        await backend.bet(
          { amountCents: 300, rows: ROW_COUNTS[i % 9] ?? 8, risk: RISKS[i % 3] ?? 'low' },
          crypto.randomUUID(),
        ),
      );
    }
    const { revealed } = await backend.rotateSeed('done');
    browser.close();
    expect(await sha256Hex(revealed.serverSeed)).toBe(start.seed.serverSeedHash);
    for (const { bet } of placed) {
      const round = await computeRound({
        serverSeed: revealed.serverSeed,
        clientSeed: start.seed.clientSeed,
        nonce: bet.nonce,
        rows: bet.rows,
        risk: bet.risk,
      });
      expect(bet.path).toBe(round.path);
      expect(bet.multiplierHundredths).toBe(round.multiplierHundredths);
      expect(bet.payoutCents).toBe(payoutCents(bet.amountCents, round.multiplierHundredths));
    }
  });

  it('differ when the seeds differ, so the comparison above is not trivially true', async () => {
    const steps = script().slice(0, 11);
    const a = browserBackend(1);
    const b = browserBackend(2);
    const first = await record(a.backend, steps);
    const second = await record(b.backend, steps);
    a.close();
    b.close();
    expect(first).not.toEqual(second);
  });
});
