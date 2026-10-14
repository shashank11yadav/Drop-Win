import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { SqlDriver, SqlValue } from './sql.ts';

export interface NodeSqlite extends SqlDriver {
  close(): void;
}

export function openNodeSqlite(path: string): NodeSqlite {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');

  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string): StatementSync => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  return {
    all<T>(sql: string, ...params: SqlValue[]): T[] {
      return prepare(sql).all(...params) as T[];
    },
    run(sql: string, ...params: SqlValue[]): void {
      prepare(sql).run(...params);
    },
    transaction<T>(fn: () => T): T {
      if (db.isTransaction) return fn();
      // IMMEDIATE takes the write lock up front, so a second process using the
      // same file waits instead of failing halfway through.
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close(): void {
      db.close();
    },
  };
}
