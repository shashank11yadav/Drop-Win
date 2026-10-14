import {
  type BetPage,
  type BetReceipt,
  type BetRequest,
  type Bet,
  HISTORY_PAGE_SIZE,
  MIN_BET_CENTS,
  type PlayerState,
  type SeedRotation,
  STARTING_BALANCE_CENTS,
} from '@drop-win/contract';
import {
  computeRound,
  isRisk,
  isRowCount,
  payoutCents,
  randomSeedHex,
  sha256Hex,
} from '@drop-win/fairness';
import { migrate } from './schema.ts';
import type { SqlDriver } from './sql.ts';

export type LedgerError =
  'not_found' | 'insufficient_funds' | 'idempotency_conflict' | 'refill_not_allowed' | 'busy';

export type LedgerResult<T> = { ok: true; value: T } | { ok: false; error: LedgerError };

/** What the HTTP layer needs from player storage, in Node or in a Durable Object. */
export interface PlayerStore {
  create(playerId: string): Promise<PlayerState>;
  state(playerId: string): Promise<PlayerState | null>;
  bet(
    playerId: string,
    request: BetRequest,
    idempotencyKey: string,
  ): Promise<LedgerResult<BetReceipt>>;
  rotateSeed(playerId: string, clientSeed: string): Promise<LedgerResult<SeedRotation>>;
  history(playerId: string, before?: number): Promise<BetPage>;
  refill(playerId: string): Promise<LedgerResult<PlayerState>>;
}

interface PlayerRow {
  balance_cents: number;
}

interface SeedRow {
  id: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  next_nonce: number;
  revealed_at: number | null;
}

interface BetRow {
  id: number;
  created_at: number;
  amount_cents: number;
  row_count: number;
  risk: string;
  nonce: number;
  path: string;
  bucket: number;
  multiplier_hundredths: number;
  payout_cents: number;
  balance_after_cents: number;
  client_seed: string;
  server_seed_hash: string;
  server_seed: string;
  revealed_at: number | null;
}

const BET_COLUMNS = `b.id, b.created_at, b.amount_cents, b.row_count, b.risk, b.nonce, b.path,
  b.bucket, b.multiplier_hundredths, b.payout_cents, b.balance_after_cents,
  s.client_seed, s.server_seed_hash, s.server_seed, s.revealed_at`;

function ok<T>(value: T): LedgerResult<T> {
  return { ok: true, value };
}

function fail<T>(error: LedgerError): LedgerResult<T> {
  return { ok: false, error };
}

function toBet(row: BetRow): Bet {
  if (!isRowCount(row.row_count) || !isRisk(row.risk)) {
    throw new Error(`corrupt bet row ${String(row.id)}`);
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    amountCents: row.amount_cents,
    rows: row.row_count,
    risk: row.risk,
    nonce: row.nonce,
    path: row.path,
    bucket: row.bucket,
    multiplierHundredths: row.multiplier_hundredths,
    payoutCents: row.payout_cents,
    balanceAfterCents: row.balance_after_cents,
    clientSeed: row.client_seed,
    serverSeedHash: row.server_seed_hash,
    // The commitment only becomes verifiable once the seed is retired.
    serverSeed: row.revealed_at === null ? null : row.server_seed,
  };
}

export interface LedgerOptions {
  now?: () => number;
}

/**
 * Balances, seeds and bets for any number of players. All writes for one bet
 * (debit, credit, nonce increment, history row) happen in one transaction.
 */
export class Ledger implements PlayerStore {
  readonly #db: SqlDriver;
  readonly #now: () => number;
  // Bets for one player run one at a time. The HMAC is computed with async
  // Web Crypto, so without this two concurrent bets could both read nonce N.
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(db: SqlDriver, options: LedgerOptions = {}) {
    this.#db = db;
    this.#now = options.now ?? Date.now;
    migrate(db);
  }

  async create(playerId: string): Promise<PlayerState> {
    const seed = await this.#freshServerSeed();
    const now = this.#now();
    this.#db.transaction(() => {
      this.#db.run(
        'INSERT INTO players (id, balance_cents, created_at) VALUES (?, ?, ?)',
        playerId,
        STARTING_BALANCE_CENTS,
        now,
      );
      this.#insertSeed(playerId, seed, randomSeedHex(8), now);
    });
    return this.#requireState(playerId);
  }

  state(playerId: string): Promise<PlayerState | null> {
    return Promise.resolve(this.#readState(playerId) ?? null);
  }

  bet(
    playerId: string,
    request: BetRequest,
    idempotencyKey: string,
  ): Promise<LedgerResult<BetReceipt>> {
    return this.#serialized(playerId, async () => {
      const replay = this.#replay(playerId, request, idempotencyKey);
      if (replay) return replay;

      const player = this.#player(playerId);
      const seed = this.#activeSeed(playerId);
      if (!player || !seed) return fail('not_found');
      if (player.balance_cents < request.amountCents) return fail('insufficient_funds');

      const round = await computeRound({
        serverSeed: seed.server_seed,
        clientSeed: seed.client_seed,
        nonce: seed.next_nonce,
        rows: request.rows,
        risk: request.risk,
      });
      const payout = payoutCents(request.amountCents, round.multiplierHundredths);

      return this.#db.transaction((): LedgerResult<BetReceipt> => {
        // Re-read inside the transaction. Another process sharing the same
        // database file could have moved the nonce while the HMAC was computed.
        const current = this.#activeSeed(playerId);
        const balance = this.#player(playerId)?.balance_cents;
        if (current?.id !== seed.id || current.next_nonce !== seed.next_nonce) return fail('busy');
        if (balance === undefined || balance < request.amountCents) {
          return fail('insufficient_funds');
        }

        const balanceAfter = balance - request.amountCents + payout;
        if (!Number.isSafeInteger(balanceAfter)) throw new Error('balance overflow');
        const now = this.#now();
        this.#db.run('UPDATE players SET balance_cents = ? WHERE id = ?', balanceAfter, playerId);
        this.#db.run('UPDATE seeds SET next_nonce = next_nonce + 1 WHERE id = ?', seed.id);
        this.#db.run(
          `INSERT INTO bets (player_id, seed_id, nonce, idempotency_key, amount_cents, row_count,
             risk, path, bucket, multiplier_hundredths, payout_cents, balance_after_cents, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          playerId,
          seed.id,
          seed.next_nonce,
          idempotencyKey,
          request.amountCents,
          request.rows,
          request.risk,
          round.path,
          round.bucket,
          round.multiplierHundredths,
          payout,
          balanceAfter,
          now,
        );
        const bet = this.#betByKey(playerId, idempotencyKey);
        if (!bet) throw new Error('bet row missing after insert');
        return ok({ bet: toBet(bet), state: this.#requireStateSync(playerId), replayed: false });
      });
    });
  }

  rotateSeed(playerId: string, clientSeed: string): Promise<LedgerResult<SeedRotation>> {
    return this.#serialized(playerId, async () => {
      const next = await this.#freshServerSeed();
      return this.#db.transaction((): LedgerResult<SeedRotation> => {
        const active = this.#activeSeed(playerId);
        if (!active) return fail('not_found');
        const now = this.#now();
        this.#db.run('UPDATE seeds SET revealed_at = ? WHERE id = ?', now, active.id);
        this.#insertSeed(playerId, next, clientSeed, now);
        return ok({
          revealed: {
            serverSeed: active.server_seed,
            serverSeedHash: active.server_seed_hash,
            clientSeed: active.client_seed,
            betCount: active.next_nonce,
            revealedAt: now,
          },
          state: this.#requireStateSync(playerId),
        });
      });
    });
  }

  history(playerId: string, before?: number): Promise<BetPage> {
    const rows = this.#db.all<BetRow>(
      `SELECT ${BET_COLUMNS} FROM bets b JOIN seeds s ON s.id = b.seed_id
       WHERE b.player_id = ? AND b.id < ? ORDER BY b.id DESC LIMIT ?`,
      playerId,
      before ?? Number.MAX_SAFE_INTEGER,
      HISTORY_PAGE_SIZE,
    );
    const last = rows.at(-1);
    return Promise.resolve({
      bets: rows.map(toBet),
      nextBefore: rows.length === HISTORY_PAGE_SIZE && last ? String(last.id) : null,
    });
  }

  refill(playerId: string): Promise<LedgerResult<PlayerState>> {
    return this.#serialized(playerId, () =>
      this.#db.transaction((): LedgerResult<PlayerState> => {
        const player = this.#player(playerId);
        if (!player) return fail('not_found');
        if (player.balance_cents >= MIN_BET_CENTS) return fail('refill_not_allowed');
        this.#db.run(
          'UPDATE players SET balance_cents = ? WHERE id = ?',
          STARTING_BALANCE_CENTS,
          playerId,
        );
        return ok(this.#requireStateSync(playerId));
      }),
    );
  }

  #serialized<T>(playerId: string, task: () => T | Promise<T>): Promise<T> {
    const previous = this.#queues.get(playerId) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.#queues.set(playerId, tail);
    void tail.then(() => {
      if (this.#queues.get(playerId) === tail) this.#queues.delete(playerId);
    });
    return result;
  }

  #replay(
    playerId: string,
    request: BetRequest,
    idempotencyKey: string,
  ): LedgerResult<BetReceipt> | undefined {
    const existing = this.#betByKey(playerId, idempotencyKey);
    if (!existing) return undefined;
    const same =
      existing.amount_cents === request.amountCents &&
      existing.row_count === request.rows &&
      existing.risk === request.risk;
    if (!same) return fail('idempotency_conflict');
    return ok({ bet: toBet(existing), state: this.#requireStateSync(playerId), replayed: true });
  }

  async #freshServerSeed(): Promise<{ seed: string; hash: string }> {
    const seed = randomSeedHex();
    return { seed, hash: await sha256Hex(seed) };
  }

  #insertSeed(
    playerId: string,
    serverSeed: { seed: string; hash: string },
    clientSeed: string,
    now: number,
  ): void {
    this.#db.run(
      `INSERT INTO seeds (player_id, server_seed, server_seed_hash, client_seed, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      playerId,
      serverSeed.seed,
      serverSeed.hash,
      clientSeed,
      now,
    );
  }

  #player(playerId: string): PlayerRow | undefined {
    return this.#db.all<PlayerRow>('SELECT balance_cents FROM players WHERE id = ?', playerId)[0];
  }

  #activeSeed(playerId: string): SeedRow | undefined {
    return this.#db.all<SeedRow>(
      `SELECT id, server_seed, server_seed_hash, client_seed, next_nonce, revealed_at
       FROM seeds WHERE player_id = ? AND revealed_at IS NULL`,
      playerId,
    )[0];
  }

  #betByKey(playerId: string, idempotencyKey: string): BetRow | undefined {
    return this.#db.all<BetRow>(
      `SELECT ${BET_COLUMNS} FROM bets b JOIN seeds s ON s.id = b.seed_id
       WHERE b.player_id = ? AND b.idempotency_key = ?`,
      playerId,
      idempotencyKey,
    )[0];
  }

  #readState(playerId: string): PlayerState | undefined {
    const player = this.#player(playerId);
    const seed = this.#activeSeed(playerId);
    if (!player || !seed) return undefined;
    return {
      balanceCents: player.balance_cents,
      seed: {
        serverSeedHash: seed.server_seed_hash,
        clientSeed: seed.client_seed,
        nonce: seed.next_nonce,
      },
      canRefill: player.balance_cents < MIN_BET_CENTS,
    };
  }

  #requireStateSync(playerId: string): PlayerState {
    const state = this.#readState(playerId);
    if (!state) throw new Error('player vanished inside a transaction');
    return state;
  }

  #requireState(playerId: string): Promise<PlayerState> {
    return Promise.resolve(this.#requireStateSync(playerId));
  }
}
