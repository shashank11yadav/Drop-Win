import {
  type Bet,
  type BetPage,
  type BetReceipt,
  type BetRequest,
  type ErrorCode,
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
import type { BetView, LedgerStore, SeedRecord } from './store.ts';

export type LedgerError =
  'not_found' | 'insufficient_funds' | 'idempotency_conflict' | 'refill_not_allowed' | 'busy';

export type LedgerResult<T> = { ok: true; value: T } | { ok: false; error: LedgerError };

/**
 * How each ledger error is reported. The HTTP API uses the status, and the
 * browser house sends the same code and message so the UI cannot tell the
 * difference.
 */
export const LEDGER_ERRORS: Record<
  LedgerError,
  { status: 401 | 409 | 422 | 503; code: ErrorCode; message: string }
> = {
  not_found: {
    status: 401,
    code: 'unauthorized',
    message: 'Session expired. Reload to start a new one.',
  },
  insufficient_funds: {
    status: 422,
    code: 'insufficient_funds',
    message: 'Not enough balance for that bet.',
  },
  idempotency_conflict: {
    status: 409,
    code: 'idempotency_conflict',
    message: 'This idempotency key was already used for a different bet.',
  },
  refill_not_allowed: {
    status: 409,
    code: 'refill_not_allowed',
    message: 'Refills are only available when the balance is below the minimum bet.',
  },
  busy: {
    status: 503,
    code: 'busy',
    message: 'Another request for this player is in progress. Retry with the same key.',
  },
};

/** What a front end needs from player storage, wherever the ledger runs. */
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

function ok<T>(value: T): LedgerResult<T> {
  return { ok: true, value };
}

function fail<T>(error: LedgerError): LedgerResult<T> {
  return { ok: false, error };
}

function toBet(row: BetView): Bet {
  if (!isRowCount(row.rows) || !isRisk(row.risk)) {
    throw new Error(`corrupt bet row ${String(row.id)}`);
  }
  return {
    id: row.id,
    createdAt: row.createdAt,
    amountCents: row.amountCents,
    rows: row.rows,
    risk: row.risk,
    nonce: row.nonce,
    path: row.path,
    bucket: row.bucket,
    multiplierHundredths: row.multiplierHundredths,
    payoutCents: row.payoutCents,
    balanceAfterCents: row.balanceAfterCents,
    clientSeed: row.clientSeed,
    serverSeedHash: row.serverSeedHash,
    // The commitment only becomes verifiable once the seed is retired.
    serverSeed: row.revealedAt === null ? null : row.serverSeed,
  };
}

export interface LedgerOptions {
  now?: () => number;
  /** Hex of n random bytes. Defaults to the platform CSPRNG; tests pass a fixed sequence. */
  randomHex?: (byteLength: number) => string;
}

/**
 * Balances, seeds and bets for any number of players. All writes for one bet
 * (debit, credit, nonce increment, history row) happen in one transaction.
 */
export class Ledger implements PlayerStore {
  readonly #store: LedgerStore;
  readonly #now: () => number;
  readonly #randomHex: (byteLength: number) => string;
  // Bets for one player run one at a time. The HMAC is computed with async
  // Web Crypto, so without this two concurrent bets could both read nonce N.
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(store: LedgerStore, options: LedgerOptions = {}) {
    this.#store = store;
    this.#now = options.now ?? Date.now;
    this.#randomHex = options.randomHex ?? randomSeedHex;
  }

  async create(playerId: string): Promise<PlayerState> {
    const seed = await this.#freshServerSeed();
    const clientSeed = this.#randomHex(8);
    const now = this.#now();
    this.#store.transaction(() => {
      this.#store.insertPlayer({
        id: playerId,
        balanceCents: STARTING_BALANCE_CENTS,
        createdAt: now,
      });
      this.#store.insertSeed({ playerId, ...seed, clientSeed, createdAt: now });
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

      const player = this.#store.player(playerId);
      const seed = this.#store.activeSeed(playerId);
      if (!player || !seed) return fail('not_found');
      if (player.balanceCents < request.amountCents) return fail('insufficient_funds');

      const round = await computeRound({
        serverSeed: seed.serverSeed,
        clientSeed: seed.clientSeed,
        nonce: seed.nextNonce,
        rows: request.rows,
        risk: request.risk,
      });
      const payout = payoutCents(request.amountCents, round.multiplierHundredths);

      return this.#store.transaction((): LedgerResult<BetReceipt> => {
        // Re-read inside the transaction. Another process sharing the same
        // database file could have moved the nonce while the HMAC was computed.
        const current = this.#store.activeSeed(playerId);
        const balance = this.#store.player(playerId)?.balanceCents;
        if (current?.id !== seed.id || current.nextNonce !== seed.nextNonce) return fail('busy');
        if (balance === undefined || balance < request.amountCents) {
          return fail('insufficient_funds');
        }

        const balanceAfter = balance - request.amountCents + payout;
        if (!Number.isSafeInteger(balanceAfter)) throw new Error('balance overflow');
        this.#store.setBalance(playerId, balanceAfter);
        this.#store.incrementNonce(seed.id);
        this.#store.insertBet({
          playerId,
          seedId: seed.id,
          nonce: seed.nextNonce,
          idempotencyKey,
          amountCents: request.amountCents,
          rows: request.rows,
          risk: request.risk,
          path: round.path,
          bucket: round.bucket,
          multiplierHundredths: round.multiplierHundredths,
          payoutCents: payout,
          balanceAfterCents: balanceAfter,
          createdAt: this.#now(),
        });
        const bet = this.#store.betByKey(playerId, idempotencyKey);
        if (!bet) throw new Error('bet row missing after insert');
        return ok({ bet: toBet(bet), state: this.#requireStateSync(playerId), replayed: false });
      });
    });
  }

  rotateSeed(playerId: string, clientSeed: string): Promise<LedgerResult<SeedRotation>> {
    return this.#serialized(playerId, async () => {
      const next = await this.#freshServerSeed();
      return this.#store.transaction((): LedgerResult<SeedRotation> => {
        const active = this.#store.activeSeed(playerId);
        if (!active) return fail('not_found');
        const now = this.#now();
        this.#store.revealSeed(active.id, now);
        this.#store.insertSeed({ playerId, ...next, clientSeed, createdAt: now });
        return ok({
          revealed: {
            serverSeed: active.serverSeed,
            serverSeedHash: active.serverSeedHash,
            clientSeed: active.clientSeed,
            betCount: active.nextNonce,
            revealedAt: now,
          },
          state: this.#requireStateSync(playerId),
        });
      });
    });
  }

  history(playerId: string, before?: number): Promise<BetPage> {
    const rows = this.#store.bets(playerId, before ?? Number.MAX_SAFE_INTEGER, HISTORY_PAGE_SIZE);
    const last = rows.at(-1);
    return Promise.resolve({
      bets: rows.map(toBet),
      nextBefore: rows.length === HISTORY_PAGE_SIZE && last ? String(last.id) : null,
    });
  }

  refill(playerId: string): Promise<LedgerResult<PlayerState>> {
    return this.#serialized(playerId, () =>
      this.#store.transaction((): LedgerResult<PlayerState> => {
        const player = this.#store.player(playerId);
        if (!player) return fail('not_found');
        if (player.balanceCents >= MIN_BET_CENTS) return fail('refill_not_allowed');
        this.#store.setBalance(playerId, STARTING_BALANCE_CENTS);
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
    const existing = this.#store.betByKey(playerId, idempotencyKey);
    if (!existing) return undefined;
    const same =
      existing.amountCents === request.amountCents &&
      existing.rows === request.rows &&
      existing.risk === request.risk;
    if (!same) return fail('idempotency_conflict');
    return ok({ bet: toBet(existing), state: this.#requireStateSync(playerId), replayed: true });
  }

  async #freshServerSeed(): Promise<Pick<SeedRecord, 'serverSeed' | 'serverSeedHash'>> {
    const serverSeed = this.#randomHex(32);
    return { serverSeed, serverSeedHash: await sha256Hex(serverSeed) };
  }

  #readState(playerId: string): PlayerState | undefined {
    const player = this.#store.player(playerId);
    const seed = this.#store.activeSeed(playerId);
    if (!player || !seed) return undefined;
    return {
      balanceCents: player.balanceCents,
      seed: {
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: seed.nextNonce,
      },
      canRefill: player.balanceCents < MIN_BET_CENTS,
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
