import { HISTORY_PAGE_SIZE, MIN_BET_CENTS, STARTING_BALANCE_CENTS } from '@drop-win/contract';
import { computeRound, payoutCents, sha256Hex } from '@drop-win/fairness';
import { describe, expect, it } from 'vitest';
import type { LedgerResult } from '../src/ledger.ts';
import { makeLedger } from './helpers.ts';

const PLAYER = '6a0f6d0e-6c39-4c2c-9f53-2c1f1b5f7a10';
const bet = { amountCents: 100, rows: 16, risk: 'high' } as const;

function unwrap<T>(result: LedgerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

function activeServerSeed(db: ReturnType<typeof makeLedger>['db']): string {
  const row = db.all<{ server_seed: string }>(
    'SELECT server_seed FROM seeds WHERE player_id = ? AND revealed_at IS NULL',
    PLAYER,
  )[0];
  if (!row) throw new Error('no active seed');
  return row.server_seed;
}

describe('Ledger', () => {
  it('creates a player with the starting balance and only a hash of the server seed', async () => {
    const { db, ledger } = makeLedger();
    const state = await ledger.create(PLAYER);
    expect(state.balanceCents).toBe(STARTING_BALANCE_CENTS);
    expect(state.seed.nonce).toBe(0);
    expect(state.seed.serverSeedHash).toBe(await sha256Hex(activeServerSeed(db)));
    expect(JSON.stringify(state)).not.toContain(activeServerSeed(db));
  });

  it('settles a bet in one step and records exactly what the fairness package computes', async () => {
    const { db, ledger } = makeLedger();
    const before = await ledger.create(PLAYER);
    const receipt = unwrap(await ledger.bet(PLAYER, bet, crypto.randomUUID()));

    const expected = await computeRound({
      serverSeed: activeServerSeed(db),
      clientSeed: before.seed.clientSeed,
      nonce: 0,
      rows: bet.rows,
      risk: bet.risk,
    });
    expect(receipt.bet).toMatchObject({
      nonce: 0,
      path: expected.path,
      bucket: expected.bucket,
      multiplierHundredths: expected.multiplierHundredths,
      payoutCents: payoutCents(bet.amountCents, expected.multiplierHundredths),
      serverSeed: null,
    });
    const balance = STARTING_BALANCE_CENTS - bet.amountCents + receipt.bet.payoutCents;
    expect(receipt.bet.balanceAfterCents).toBe(balance);
    expect(receipt.state.balanceCents).toBe(balance);
    expect(receipt.state.seed.nonce).toBe(1);
  });

  it('increments the nonce once per bet, even when bets arrive concurrently', async () => {
    const { ledger } = makeLedger();
    await ledger.create(PLAYER);
    const results = await Promise.all(
      Array.from({ length: 30 }, () => ledger.bet(PLAYER, bet, crypto.randomUUID())),
    );
    const receipts = results.map(unwrap);
    expect(receipts.map((r) => r.bet.nonce).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i),
    );

    const totalPayout = receipts.reduce((sum, r) => sum + r.bet.payoutCents, 0);
    const state = await ledger.state(PLAYER);
    expect(state?.balanceCents).toBe(STARTING_BALANCE_CENTS - 30 * bet.amountCents + totalPayout);
    expect(state?.seed.nonce).toBe(30);
  });

  it('never lets the balance go negative', async () => {
    const { db, ledger } = makeLedger();
    await ledger.create(PLAYER);
    db.run('UPDATE players SET balance_cents = ? WHERE id = ?', 250, PLAYER);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        ledger.bet(PLAYER, { ...bet, amountCents: 200 }, crypto.randomUUID()),
      ),
    );
    const settled = [];
    for (const result of results) {
      if (result.ok) settled.push(result.value.bet);
      else expect(result.error).toBe('insufficient_funds');
    }
    // Walk the accepted bets in nonce order: each one must have been covered
    // by the balance left by the previous one.
    settled.sort((a, b) => a.nonce - b.nonce);
    let balance = 250;
    for (const accepted of settled) {
      expect(balance).toBeGreaterThanOrEqual(accepted.amountCents);
      balance = balance - accepted.amountCents + accepted.payoutCents;
      expect(accepted.balanceAfterCents).toBe(balance);
    }
    const state = await ledger.state(PLAYER);
    expect(state?.balanceCents).toBe(balance);
    expect(state?.seed.nonce).toBe(settled.length);

    // The schema refuses a negative balance even if application code were wrong.
    expect(() => {
      db.run('UPDATE players SET balance_cents = -1 WHERE id = ?', PLAYER);
    }).toThrow(/CHECK constraint/);
  });

  it('rejects a bet larger than the balance without touching the nonce', async () => {
    const { db, ledger } = makeLedger();
    await ledger.create(PLAYER);
    db.run('UPDATE players SET balance_cents = 50 WHERE id = ?', PLAYER);
    const result = await ledger.bet(PLAYER, bet, crypto.randomUUID());
    expect(result).toEqual({ ok: false, error: 'insufficient_funds' });
    expect((await ledger.state(PLAYER))?.seed.nonce).toBe(0);
  });

  it('replays a repeated idempotency key instead of charging twice', async () => {
    const { ledger } = makeLedger();
    await ledger.create(PLAYER);
    const key = crypto.randomUUID();
    const [first, second] = await Promise.all([
      ledger.bet(PLAYER, bet, key),
      ledger.bet(PLAYER, bet, key),
    ]);
    const a = unwrap(first);
    const b = unwrap(second);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(b.bet).toEqual(a.bet);
    expect((await ledger.state(PLAYER))?.seed.nonce).toBe(1);

    const conflict = await ledger.bet(PLAYER, { ...bet, amountCents: 500 }, key);
    expect(conflict).toEqual({ ok: false, error: 'idempotency_conflict' });
  });

  it('reveals the committed seed on rotation and every past round verifies', async () => {
    const { ledger } = makeLedger();
    const initial = await ledger.create(PLAYER);
    const bets = [];
    for (let i = 0; i < 12; i++) {
      bets.push(
        unwrap(
          await ledger.bet(
            PLAYER,
            { amountCents: 100, rows: (8 + (i % 9)) as 8, risk: i % 2 ? 'low' : 'high' },
            crypto.randomUUID(),
          ),
        ).bet,
      );
    }

    const rotation = unwrap(await ledger.rotateSeed(PLAYER, 'my-new-seed'));
    expect(rotation.revealed.serverSeedHash).toBe(initial.seed.serverSeedHash);
    expect(await sha256Hex(rotation.revealed.serverSeed)).toBe(initial.seed.serverSeedHash);
    expect(rotation.revealed.betCount).toBe(12);
    expect(rotation.state.seed).toMatchObject({ clientSeed: 'my-new-seed', nonce: 0 });
    expect(rotation.state.seed.serverSeedHash).not.toBe(initial.seed.serverSeedHash);

    // The verifier's job, done here with the shared package and only public data.
    const history = await ledger.history(PLAYER);
    expect(history.bets).toHaveLength(12);
    for (const recorded of history.bets) {
      expect(recorded.serverSeed).toBe(rotation.revealed.serverSeed);
      const replayed = await computeRound({
        serverSeed: recorded.serverSeed ?? '',
        clientSeed: recorded.clientSeed,
        nonce: recorded.nonce,
        rows: recorded.rows,
        risk: recorded.risk,
      });
      expect(replayed.path).toBe(recorded.path);
      expect(replayed.bucket).toBe(recorded.bucket);
      expect(replayed.multiplierHundredths).toBe(recorded.multiplierHundredths);
    }
    expect(history.bets.map((b) => b.id).reverse()).toEqual(bets.map((b) => b.id));
  });

  it('keeps the new active seed hidden after rotation', async () => {
    const { db, ledger } = makeLedger();
    await ledger.create(PLAYER);
    unwrap(await ledger.rotateSeed(PLAYER, 'next'));
    const receipt = unwrap(await ledger.bet(PLAYER, bet, crypto.randomUUID()));
    const page = await ledger.history(PLAYER);
    const secret = activeServerSeed(db);
    for (const payload of [receipt, page, await ledger.state(PLAYER)]) {
      expect(JSON.stringify(payload)).not.toContain(secret);
    }
    expect(receipt.bet.serverSeed).toBeNull();
  });

  it('pages history newest first', async () => {
    const { ledger } = makeLedger();
    await ledger.create(PLAYER);
    for (let i = 0; i < HISTORY_PAGE_SIZE + 3; i++) {
      unwrap(await ledger.bet(PLAYER, { ...bet, amountCents: MIN_BET_CENTS }, crypto.randomUUID()));
    }
    const first = await ledger.history(PLAYER);
    expect(first.bets).toHaveLength(HISTORY_PAGE_SIZE);
    expect(first.nextBefore).not.toBeNull();
    const second = await ledger.history(PLAYER, Number(first.nextBefore));
    expect(second.bets).toHaveLength(3);
    expect(second.nextBefore).toBeNull();
    expect(second.bets[0]?.nonce).toBe(2);
  });

  it('refills only when the balance is below the minimum bet', async () => {
    const { db, ledger } = makeLedger();
    await ledger.create(PLAYER);
    expect(await ledger.refill(PLAYER)).toEqual({ ok: false, error: 'refill_not_allowed' });
    db.run('UPDATE players SET balance_cents = ? WHERE id = ?', MIN_BET_CENTS - 1, PLAYER);
    expect((await ledger.state(PLAYER))?.canRefill).toBe(true);
    const state = unwrap(await ledger.refill(PLAYER));
    expect(state.balanceCents).toBe(STARTING_BALANCE_CENTS);
  });

  it('reports unknown players', async () => {
    const { ledger } = makeLedger();
    expect(await ledger.state(PLAYER)).toBeNull();
    expect(await ledger.bet(PLAYER, bet, crypto.randomUUID())).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await ledger.rotateSeed(PLAYER, 'x')).toEqual({ ok: false, error: 'not_found' });
  });
});
