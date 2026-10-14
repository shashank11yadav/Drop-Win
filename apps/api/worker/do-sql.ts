import type { SqlDriver, SqlValue } from '../src/sql.ts';

export function durableObjectSql(storage: DurableObjectStorage): SqlDriver {
  return {
    all<T>(sql: string, ...params: SqlValue[]): T[] {
      // Consumed immediately: a cursor held across an await has no snapshot guarantee.
      return storage.sql.exec(sql, ...params).toArray() as T[];
    },
    run(sql: string, ...params: SqlValue[]): void {
      storage.sql.exec(sql, ...params).toArray();
    },
    transaction<T>(fn: () => T): T {
      return storage.transactionSync(fn);
    },
  };
}
