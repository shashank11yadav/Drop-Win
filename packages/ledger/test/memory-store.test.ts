import { STARTING_BALANCE_CENTS } from '@drop-win/contract';
import { computeRound } from '@drop-win/fairness';
import { describe, expect, it } from 'vitest';
import {
  InvalidDumpError,
  Ledger,
  type LedgerResult,
  type MemoryChanges,
  type MemoryDump,
  MemoryStore,
  restoreStore,
} from '../src/index.ts';

const PLAYER = 'local';
const bet = { amountCents: 250, rows: 12, risk: 'medium' } as const;

function unwrap<T>(result: LedgerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

async function playedStore(): Promise<{ store: MemoryStore; ledger: Ledger }> {
  const store = new MemoryStore();
  const ledger = new Ledger(store);
  await ledger.create(PLAYER);
  for (let i = 0; i < 5; i++) unwrap(await ledger.bet(PLAYER, bet, crypto.randomUUID()));
  unwrap(await ledger.rotateSeed(PLAYER, 'second'));
  for (let i = 0; i < 3; i++) unwrap(await ledger.bet(PLAYER, bet, crypto.randomUUID()));
  return { store, ledger };
}

/** JSON round trip, as IndexedDB would hand it back. */
function saved(store: MemoryStore): MemoryDump {
  return JSON.parse(JSON.stringify(store.dump())) as MemoryDump;
}

describe('MemoryStore', () => {
  it('rolls back every write of a failed transaction', async () => {
    const store = new MemoryStore();
    const ledger = new Ledger(store);
    await ledger.create(PLAYER);
    const before = JSON.stringify(store.dump());
    const seed = store.activeSeed(PLAYER);
    if (!seed) throw new Error('no seed');

    expect(() => {
      store.transaction(() => {
        store.setBalance(PLAYER, 5);
        store.incrementNonce(seed.id);
        store.insertBet({
          playerId: PLAYER,
          seedId: seed.id,
          nonce: 0,
          idempotencyKey: crypto.randomUUID(),
          amountCents: 100,
          rows: 8,
          risk: 'low',
          path: 'LLLLLLLL',
          bucket: 0,
          multiplierHundredths: 0,
          payoutCents: 0,
          balanceAfterCents: 5,
          createdAt: 0,
        });
        store.setBalance(PLAYER, -1);
      });
    }).toThrow(/balance_cents >= 0/);
    expect(JSON.stringify(store.dump())).toBe(before);
  });

  it('refuses a second unrevealed seed, a reused nonce and a reused key', async () => {
    const { store } = await playedStore();
    const seed = store.activeSeed(PLAYER);
    if (!seed) throw new Error('no seed');
    expect(() => {
      store.insertSeed({
        playerId: PLAYER,
        serverSeed: seed.serverSeed,
        serverSeedHash: seed.serverSeedHash,
        clientSeed: 'x',
        createdAt: 0,
      });
    }).toThrow(/one unrevealed seed/);

    const [existing] = store.bets(PLAYER, Number.MAX_SAFE_INTEGER, 1);
    if (!existing) throw new Error('no bet');
    const copy = {
      playerId: existing.playerId,
      seedId: existing.seedId,
      nonce: existing.nonce,
      idempotencyKey: crypto.randomUUID(),
      amountCents: existing.amountCents,
      rows: existing.rows,
      risk: existing.risk,
      path: existing.path,
      bucket: existing.bucket,
      multiplierHundredths: existing.multiplierHundredths,
      payoutCents: existing.payoutCents,
      balanceAfterCents: existing.balanceAfterCents,
      createdAt: existing.createdAt,
    };
    expect(() => {
      store.insertBet(copy);
    }).toThrow(/seed_id, nonce/);
    expect(() => {
      store.insertBet({ ...copy, nonce: 99, idempotencyKey: existing.idempotencyKey });
    }).toThrow(/idempotency_key/);
  });

  it('reports exactly the records each committed transaction wrote', async () => {
    const commits: MemoryChanges[] = [];
    const store = new MemoryStore({ onCommit: (changes) => commits.push(changes) });
    const ledger = new Ledger(store);
    await ledger.create(PLAYER);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.players).toHaveLength(1);
    expect(commits[0]?.seeds).toHaveLength(1);

    const receipt = unwrap(await ledger.bet(PLAYER, bet, crypto.randomUUID()));
    expect(commits).toHaveLength(2);
    expect(commits[1]?.players[0]?.balanceCents).toBe(receipt.state.balanceCents);
    expect(commits[1]?.seeds[0]?.nextNonce).toBe(1);
    expect(commits[1]?.bets.map((b) => b.id)).toEqual([receipt.bet.id]);

    // A rejected bet commits nothing.
    store.setBalance(PLAYER, 0);
    const before = commits.length;
    expect(await ledger.bet(PLAYER, bet, crypto.randomUUID())).toEqual({
      ok: false,
      error: 'insufficient_funds',
    });
    expect(commits).toHaveLength(before);
  });
});

describe('restoreStore', () => {
  it('restores a saved store that keeps playing from the same nonce', async () => {
    const { store, ledger } = await playedStore();
    const restored = await restoreStore(saved(store));
    expect(restored.dump()).toEqual(store.dump());

    const again = new Ledger(restored);
    const state = await again.state(PLAYER);
    expect(state).toEqual(await ledger.state(PLAYER));
    const next = unwrap(await again.bet(PLAYER, bet, crypto.randomUUID()));
    expect(next.bet.nonce).toBe(3);
    expect(next.bet.id).toBe(9);

    const seed = restored.activeSeed(PLAYER);
    const expected = await computeRound({
      serverSeed: seed?.serverSeed ?? '',
      clientSeed: 'second',
      nonce: 3,
      rows: bet.rows,
      risk: bet.risk,
    });
    expect(next.bet.path).toBe(expected.path);
  });

  it('accepts a fresh player with no bets', async () => {
    const store = new MemoryStore();
    await new Ledger(store).create(PLAYER);
    const restored = await restoreStore(saved(store));
    expect(restored.player(PLAYER)?.balanceCents).toBe(STARTING_BALANCE_CENTS);
  });

  const tampering: [string, (dump: MemoryDump) => unknown][] = [
    ['not an object', () => 'hello'],
    ['null', () => null],
    ['a missing table', (d) => ({ players: d.players, seeds: d.seeds })],
    ['an unknown field', (d) => ({ ...d, extra: 1 })],
    ['a negative balance', (d) => ({ ...d, players: [{ ...d.players[0], balanceCents: -100 }] })],
    ['a fractional balance', (d) => ({ ...d, players: [{ ...d.players[0], balanceCents: 10.5 }] })],
    [
      'a seed that does not match its commitment',
      (d) => ({
        ...d,
        seeds: d.seeds.map((s, i) => (i === 0 ? { ...s, serverSeed: 'f'.repeat(64) } : s)),
      }),
    ],
    [
      'two unrevealed seeds',
      (d) => ({ ...d, seeds: d.seeds.map((s) => ({ ...s, revealedAt: null })) }),
    ],
    ['no unrevealed seed', (d) => ({ ...d, seeds: d.seeds.map((s) => ({ ...s, revealedAt: 1 })) })],
    [
      'a bet nonce the seed never issued',
      (d) => ({ ...d, bets: d.bets.map((b, i) => (i === 0 ? { ...b, nonce: 999 } : b)) }),
    ],
    [
      'a duplicate nonce',
      (d) => ({ ...d, bets: d.bets.map((b, i) => (i === 1 ? { ...b, nonce: 0 } : b)) }),
    ],
    [
      'a duplicate bet id',
      (d) => ({ ...d, bets: d.bets.map((b, i) => (i === 1 ? { ...b, id: 1 } : b)) }),
    ],
    [
      'a bet on a missing seed',
      (d) => ({ ...d, bets: d.bets.map((b, i) => (i === 0 ? { ...b, seedId: 77 } : b)) }),
    ],
    [
      'a path that disagrees with its bucket',
      (d) => ({ ...d, bets: d.bets.map((b, i) => (i === 0 ? { ...b, bucket: b.bucket + 1 } : b)) }),
    ],
    [
      'a bet above the maximum',
      (d) => ({ ...d, bets: d.bets.map((b, i) => (i === 0 ? { ...b, amountCents: 10 ** 9 } : b)) }),
    ],
  ];

  it.each(tampering)('rejects a save with %s', async (_name, tamper) => {
    const { store } = await playedStore();
    await expect(restoreStore(tamper(saved(store)))).rejects.toBeInstanceOf(InvalidDumpError);
  });
});
