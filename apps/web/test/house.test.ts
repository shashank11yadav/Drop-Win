import { STARTING_BALANCE_CENTS } from '@drop-win/contract';
import { sha256Hex } from '@drop-win/fairness';
import type { MemoryChanges } from '@drop-win/ledger';
import { describe, expect, it } from 'vitest';
import { BrowserBackend } from '../src/backend/browser.ts';
import { GameError, placeBet } from '../src/backend/types.ts';
import { House, type HouseStorage, NOTICES, serveHouse } from '../src/house/house.ts';
import type { HouseMessage } from '../src/house/protocol.ts';

const bet = { amountCents: 100, rows: 12, risk: 'high' } as const;

/** An IndexedDB stand-in that keeps records the same way: one map per table, keyed by id. */
class FakeStorage implements HouseStorage {
  tables = { players: new Map<unknown, unknown>(), seeds: new Map(), bets: new Map() };
  failLoad = false;
  failSave = false;
  saves = 0;

  load(): Promise<unknown> {
    if (this.failLoad) return Promise.reject(new Error('blocked'));
    const { players, seeds, bets } = this.tables;
    if (players.size + seeds.size + bets.size === 0) return Promise.resolve(null);
    // Structured clone, as IndexedDB returns copies.
    return Promise.resolve(
      structuredClone({
        players: [...players.values()],
        seeds: [...seeds.values()],
        bets: [...bets.values()],
      }),
    );
  }

  save(changes: MemoryChanges): Promise<void> {
    if (this.failSave) return Promise.reject(new Error('quota'));
    this.saves += 1;
    for (const p of changes.players) this.tables.players.set(p.id, structuredClone(p));
    for (const s of changes.seeds) this.tables.seeds.set(s.id, structuredClone(s));
    for (const b of changes.bets) this.tables.bets.set(b.id, structuredClone(b));
    return Promise.resolve();
  }

  clear(): Promise<void> {
    for (const table of Object.values(this.tables)) table.clear();
    return Promise.resolve();
  }
}

/** A page-side backend talking to a house over a real MessageChannel. */
function connect(house: House) {
  const channel = new MessageChannel();
  serveHouse(channel.port2, house);
  const backend = new BrowserBackend(channel.port1);
  channel.port1.start();
  channel.port2.start();
  const notices: string[] = [];
  backend.onNotice((message) => notices.push(message));
  return {
    backend,
    notices,
    close: () => {
      channel.port1.close();
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<GameError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GameError) return error;
    throw error;
  }
  throw new Error('expected a GameError');
}

describe('browser house', () => {
  it('commits to a seed before any bet and reveals that exact seed on rotation', async () => {
    const { backend, close } = connect(new House({ storage: new FakeStorage() }));
    const start = await backend.session();
    expect(start.balanceCents).toBe(STARTING_BALANCE_CENTS);
    expect(start.seed.nonce).toBe(0);

    const receipts = [];
    for (let i = 0; i < 5; i++) receipts.push(await placeBet(backend, bet));
    expect(receipts.map((r) => r.bet.nonce)).toEqual([0, 1, 2, 3, 4]);
    expect(receipts.every((r) => r.bet.serverSeed === null)).toBe(true);
    expect(receipts.every((r) => r.bet.serverSeedHash === start.seed.serverSeedHash)).toBe(true);

    const rotation = await backend.rotateSeed('my-seed');
    expect(rotation.revealed.serverSeedHash).toBe(start.seed.serverSeedHash);
    expect(await sha256Hex(rotation.revealed.serverSeed)).toBe(start.seed.serverSeedHash);
    expect(rotation.revealed.betCount).toBe(5);
    expect(rotation.state.seed).toMatchObject({ clientSeed: 'my-seed', nonce: 0 });
    close();
  });

  it('replays a retried idempotency key and rejects a reused key for a different bet', async () => {
    const { backend, close } = connect(new House({ storage: new FakeStorage() }));
    await backend.session();
    const key = crypto.randomUUID();
    const [first, second] = await Promise.all([backend.bet(bet, key), backend.bet(bet, key)]);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.bet).toEqual(first.bet);
    expect((await backend.state()).seed.nonce).toBe(1);

    const conflict = await failure(backend.bet({ ...bet, amountCents: 200 }, key));
    expect(conflict).toMatchObject({ status: 409, code: 'idempotency_conflict' });
    close();
  });

  it('never lets the balance go negative', async () => {
    const storage = new FakeStorage();
    const { backend, close } = connect(new House({ storage }));
    await backend.session();
    // Leave 250 cents in the saved ledger, then reload the house from it.
    const player = storage.tables.players.get('local') as { balanceCents: number };
    player.balanceCents = 250;
    close();

    const reloaded = connect(new House({ storage }));
    expect((await reloaded.backend.session()).balanceCents).toBe(250);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => placeBet(reloaded.backend, { ...bet, amountCents: 200 })),
    );
    let balance = 250;
    const accepted = results
      .flatMap((r) => (r.status === 'fulfilled' ? [r.value.bet] : []))
      .sort((a, b) => a.nonce - b.nonce);
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toMatchObject({ status: 422, code: 'insufficient_funds' });
      }
    }
    for (const b of accepted) {
      expect(balance).toBeGreaterThanOrEqual(b.amountCents);
      balance = balance - b.amountCents + b.payoutCents;
      expect(b.balanceAfterCents).toBe(balance);
    }
    expect((await reloaded.backend.state()).balanceCents).toBe(balance);
    expect(balance).toBeGreaterThanOrEqual(0);
    reloaded.close();
  });

  it('validates every request like the API does', async () => {
    const { backend, close } = connect(new House({ storage: null }));
    await backend.session();
    const cases: [() => Promise<unknown>, RegExp][] = [
      [() => backend.bet({ ...bet, amountCents: 0 }, crypto.randomUUID()), /amountCents/],
      [() => backend.bet({ ...bet, amountCents: 1.5 }, crypto.randomUUID()), /amountCents/],
      [() => backend.bet({ ...bet, rows: 7 as 8 }, crypto.randomUUID()), /rows/],
      [() => backend.bet({ ...bet, risk: 'extreme' as 'low' }, crypto.randomUUID()), /risk/],
      [
        () => backend.bet({ ...bet, multiplier: 100 } as typeof bet, crypto.randomUUID()),
        /Invalid input/,
      ],
      [() => backend.bet(bet, 'not-a-uuid'), /UUID/],
      [() => backend.rotateSeed('has spaces'), /clientSeed/],
      [() => backend.history('0'), /before/],
    ];
    for (const [call, message] of cases) {
      const error = await failure(call());
      expect(error.code).toBe('bad_request');
      expect(error.status).toBe(400);
      expect(error.message).toMatch(message);
    }
    expect((await backend.state()).seed.nonce).toBe(0);
    close();
  });

  it('answers malformed messages without crashing', async () => {
    const house = new House({ storage: null });
    expect(await house.handle(null)).toBeNull();
    expect(await house.handle('bet')).toBeNull();
    expect(await house.handle({ op: 'bet' })).toBeNull();
    const reply: HouseMessage | null = await house.handle({ id: 3, op: 'steal-seed' });
    expect(reply).toMatchObject({ id: 3, ok: false, failure: { error: 'bad_request' } });
    const extra = await house.handle({ id: 4, op: 'state', serverSeed: true });
    expect(extra).toMatchObject({ id: 4, ok: false });
  });

  it('keeps the active server seed out of every response', async () => {
    const storage = new FakeStorage();
    const { backend, close } = connect(new House({ storage }));
    await backend.session();
    await placeBet(backend, bet);
    const seeds = [...storage.tables.seeds.values()] as { serverSeed: string }[];
    const active = seeds[0]?.serverSeed ?? '';
    expect(active).toMatch(/^[0-9a-f]{64}$/);
    for (const payload of [await backend.state(), await backend.history()]) {
      expect(JSON.stringify(payload)).not.toContain(active);
    }
    close();
  });

  it('survives a reload with the same balance, nonce and history', async () => {
    const storage = new FakeStorage();
    const first = connect(new House({ storage }));
    await first.backend.session();
    for (let i = 0; i < 3; i++) await placeBet(first.backend, bet);
    const before = await first.backend.state();
    const history = await first.backend.history();
    first.close();

    const second = connect(new House({ storage }));
    expect(await second.backend.session()).toEqual(before);
    expect(await second.backend.history()).toEqual(history);
    expect((await placeBet(second.backend, bet)).bet.nonce).toBe(3);
    expect(second.notices).toEqual([]);
    second.close();
  });

  it('starts a fresh demo, with a notice, when the save has been tampered with', async () => {
    const storage = new FakeStorage();
    const first = connect(new House({ storage }));
    await first.backend.session();
    await placeBet(first.backend, bet);
    const committed = (await first.backend.state()).seed.serverSeedHash;
    first.close();

    // Swap the hidden seed for one the player would like better.
    for (const seed of storage.tables.seeds.values()) {
      (seed as { serverSeed: string }).serverSeed = '0'.repeat(64);
    }

    const second = connect(new House({ storage }));
    const state = await second.backend.session();
    expect(state.balanceCents).toBe(STARTING_BALANCE_CENTS);
    expect(state.seed.nonce).toBe(0);
    expect(state.seed.serverSeedHash).not.toBe(committed);
    expect((await second.backend.history()).bets).toEqual([]);
    expect(second.notices).toEqual([NOTICES.rejected]);
    // The rejected records were wiped, and the fresh demo saved in their place.
    expect(storage.tables.bets.size).toBe(0);
    expect(storage.tables.seeds.size).toBe(1);
    second.close();
  });

  it('keeps playing in memory when storage fails, and says so once', async () => {
    const storage = new FakeStorage();
    storage.failLoad = true;
    const { backend, notices, close } = connect(new House({ storage }));
    await backend.session();
    await placeBet(backend, bet);
    await placeBet(backend, bet);
    expect((await backend.state()).seed.nonce).toBe(2);
    expect(notices).toEqual([NOTICES.unavailable]);
    close();

    const saving = new FakeStorage();
    saving.failSave = true;
    const other = connect(new House({ storage: saving }));
    await other.backend.session();
    await placeBet(other.backend, bet);
    expect((await other.backend.state()).seed.nonce).toBe(1);
    expect(other.notices).toEqual([NOTICES.unavailable]);
    other.close();
  });

  it('resets to a fresh ledger with new seeds and wipes the saved one', async () => {
    const storage = new FakeStorage();
    const { backend, close } = connect(new House({ storage }));
    const start = await backend.session();
    await Promise.all([placeBet(backend, bet), placeBet(backend, bet)]);
    const reset = await backend.reset();
    expect(reset.balanceCents).toBe(STARTING_BALANCE_CENTS);
    expect(reset.seed.nonce).toBe(0);
    expect(reset.seed.serverSeedHash).not.toBe(start.seed.serverSeedHash);
    expect((await backend.history()).bets).toEqual([]);
    expect(storage.tables.bets.size).toBe(0);
    expect(storage.tables.seeds.size).toBe(1);
    close();
  });

  it('refills only when the balance is below the minimum bet', async () => {
    const { backend, close } = connect(new House({ storage: null }));
    await backend.session();
    expect(await failure(backend.refill())).toMatchObject({
      status: 409,
      code: 'refill_not_allowed',
    });
    close();
  });
});
