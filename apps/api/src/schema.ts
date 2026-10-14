import type { SqlDriver } from './sql.ts';

// Each statement runs on its own because the Durable Object driver binds
// parameters to the last statement of a batch only.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
    created_at INTEGER NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS seeds (
    id INTEGER PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players (id),
    server_seed TEXT NOT NULL,
    server_seed_hash TEXT NOT NULL,
    client_seed TEXT NOT NULL,
    next_nonce INTEGER NOT NULL DEFAULT 0 CHECK (next_nonce >= 0),
    created_at INTEGER NOT NULL,
    revealed_at INTEGER
  ) STRICT`,
  // At most one unrevealed seed per player.
  `CREATE UNIQUE INDEX IF NOT EXISTS seeds_active ON seeds (player_id) WHERE revealed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players (id),
    seed_id INTEGER NOT NULL REFERENCES seeds (id),
    nonce INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    row_count INTEGER NOT NULL,
    risk TEXT NOT NULL,
    path TEXT NOT NULL,
    bucket INTEGER NOT NULL,
    multiplier_hundredths INTEGER NOT NULL,
    payout_cents INTEGER NOT NULL CHECK (payout_cents >= 0),
    balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0),
    created_at INTEGER NOT NULL,
    UNIQUE (seed_id, nonce),
    UNIQUE (player_id, idempotency_key)
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS bets_by_player ON bets (player_id, id)`,
];

export function migrate(db: SqlDriver): void {
  db.transaction(() => {
    for (const statement of STATEMENTS) db.run(statement);
  });
}
