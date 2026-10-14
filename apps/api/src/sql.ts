export type SqlValue = string | number | null;

/**
 * The few synchronous operations the ledger needs. Both node:sqlite and a
 * Durable Object's SQLite storage are synchronous, so a transaction is a plain
 * function call that nothing else can interleave with.
 */
export interface SqlDriver {
  all<T>(sql: string, ...params: SqlValue[]): T[];
  run(sql: string, ...params: SqlValue[]): void;
  transaction<T>(fn: () => T): T;
}
