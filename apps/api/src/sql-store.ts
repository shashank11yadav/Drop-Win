import type {
  BetView,
  LedgerStore,
  NewBet,
  NewSeed,
  PlayerRecord,
  SeedRecord,
} from '@drop-win/ledger';
import { migrate } from './schema.ts';
import type { SqlDriver } from './sql.ts';

const SEED_COLUMNS = `id, player_id AS playerId, server_seed AS serverSeed,
  server_seed_hash AS serverSeedHash, client_seed AS clientSeed, next_nonce AS nextNonce,
  created_at AS createdAt, revealed_at AS revealedAt`;

const BET_COLUMNS = `b.id, b.player_id AS playerId, b.seed_id AS seedId, b.nonce,
  b.idempotency_key AS idempotencyKey, b.amount_cents AS amountCents, b.row_count AS rows,
  b.risk, b.path, b.bucket, b.multiplier_hundredths AS multiplierHundredths,
  b.payout_cents AS payoutCents, b.balance_after_cents AS balanceAfterCents,
  b.created_at AS createdAt, s.client_seed AS clientSeed, s.server_seed_hash AS serverSeedHash,
  s.server_seed AS serverSeed, s.revealed_at AS revealedAt`;

/**
 * The ledger's storage on SQLite, used by both node:sqlite and Durable
 * Objects. The schema's CHECK and UNIQUE constraints back up the ledger's own
 * checks.
 */
export class SqlStore implements LedgerStore {
  readonly #db: SqlDriver;

  constructor(db: SqlDriver) {
    this.#db = db;
    migrate(db);
  }

  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn);
  }

  player(playerId: string): PlayerRecord | undefined {
    return this.#db.all<PlayerRecord>(
      'SELECT id, balance_cents AS balanceCents, created_at AS createdAt FROM players WHERE id = ?',
      playerId,
    )[0];
  }

  insertPlayer(player: PlayerRecord): void {
    this.#db.run(
      'INSERT INTO players (id, balance_cents, created_at) VALUES (?, ?, ?)',
      player.id,
      player.balanceCents,
      player.createdAt,
    );
  }

  setBalance(playerId: string, balanceCents: number): void {
    this.#db.run('UPDATE players SET balance_cents = ? WHERE id = ?', balanceCents, playerId);
  }

  activeSeed(playerId: string): SeedRecord | undefined {
    return this.#db.all<SeedRecord>(
      `SELECT ${SEED_COLUMNS} FROM seeds WHERE player_id = ? AND revealed_at IS NULL`,
      playerId,
    )[0];
  }

  insertSeed(seed: NewSeed): void {
    this.#db.run(
      `INSERT INTO seeds (player_id, server_seed, server_seed_hash, client_seed, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      seed.playerId,
      seed.serverSeed,
      seed.serverSeedHash,
      seed.clientSeed,
      seed.createdAt,
    );
  }

  revealSeed(seedId: number, revealedAt: number): void {
    this.#db.run('UPDATE seeds SET revealed_at = ? WHERE id = ?', revealedAt, seedId);
  }

  incrementNonce(seedId: number): void {
    this.#db.run('UPDATE seeds SET next_nonce = next_nonce + 1 WHERE id = ?', seedId);
  }

  insertBet(bet: NewBet): void {
    this.#db.run(
      `INSERT INTO bets (player_id, seed_id, nonce, idempotency_key, amount_cents, row_count,
         risk, path, bucket, multiplier_hundredths, payout_cents, balance_after_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bet.playerId,
      bet.seedId,
      bet.nonce,
      bet.idempotencyKey,
      bet.amountCents,
      bet.rows,
      bet.risk,
      bet.path,
      bet.bucket,
      bet.multiplierHundredths,
      bet.payoutCents,
      bet.balanceAfterCents,
      bet.createdAt,
    );
  }

  betByKey(playerId: string, idempotencyKey: string): BetView | undefined {
    return this.#db.all<BetView>(
      `SELECT ${BET_COLUMNS} FROM bets b JOIN seeds s ON s.id = b.seed_id
       WHERE b.player_id = ? AND b.idempotency_key = ?`,
      playerId,
      idempotencyKey,
    )[0];
  }

  bets(playerId: string, beforeId: number, limit: number): BetView[] {
    return this.#db.all<BetView>(
      `SELECT ${BET_COLUMNS} FROM bets b JOIN seeds s ON s.id = b.seed_id
       WHERE b.player_id = ? AND b.id < ? ORDER BY b.id DESC LIMIT ?`,
      playerId,
      beforeId,
      limit,
    );
  }
}
