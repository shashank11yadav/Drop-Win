export interface PlayerRecord {
  id: string;
  balanceCents: number;
  createdAt: number;
}

export interface SeedRecord {
  id: number;
  playerId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nextNonce: number;
  createdAt: number;
  revealedAt: number | null;
}

export interface BetRecord {
  id: number;
  playerId: string;
  seedId: number;
  nonce: number;
  idempotencyKey: string;
  amountCents: number;
  /** Typed loosely because storage can hold anything; the ledger checks it on read. */
  rows: number;
  risk: string;
  path: string;
  bucket: number;
  multiplierHundredths: number;
  payoutCents: number;
  balanceAfterCents: number;
  createdAt: number;
}

export type NewSeed = Pick<
  SeedRecord,
  'playerId' | 'serverSeed' | 'serverSeedHash' | 'clientSeed' | 'createdAt'
>;
export type NewBet = Omit<BetRecord, 'id'>;

/** A bet joined with the seed it was played on, which is what history shows. */
export interface BetView extends BetRecord {
  clientSeed: string;
  serverSeedHash: string;
  serverSeed: string;
  revealedAt: number | null;
}

/**
 * Synchronous storage under the ledger. SQLite (node:sqlite or a Durable
 * Object) and the in-memory store used in the browser both implement it, so
 * the betting rules exist once. Implementations must enforce the same
 * invariants the SQLite schema does: balances and payouts never negative, one
 * unrevealed seed per player, and unique (seed, nonce) and (player, key) pairs.
 */
export interface LedgerStore {
  /** Runs fn atomically. Nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T;
  player(playerId: string): PlayerRecord | undefined;
  insertPlayer(player: PlayerRecord): void;
  setBalance(playerId: string, balanceCents: number): void;
  activeSeed(playerId: string): SeedRecord | undefined;
  insertSeed(seed: NewSeed): void;
  revealSeed(seedId: number, revealedAt: number): void;
  incrementNonce(seedId: number): void;
  insertBet(bet: NewBet): void;
  betByKey(playerId: string, idempotencyKey: string): BetView | undefined;
  /** Newest first, ids strictly below beforeId. */
  bets(playerId: string, beforeId: number, limit: number): BetView[];
}
