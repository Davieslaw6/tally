import { PGlite } from '@electric-sql/pglite';
import type { AppConfig } from '../config';
import type { SqlEngine, SqlExecutor, SqlParam, SqlQueryResult } from './sql';

function toResult(result: { rows: unknown[]; affectedRows?: number }): SqlQueryResult {
  return {
    rows: result.rows as Record<string, unknown>[],
    rowCount: result.affectedRows ?? result.rows.length,
  };
}

/**
 * Embedded PostgreSQL fallback. PGlite gives local development and the test
 * suite a real PostgreSQL parser/planner without requiring an external service
 * or an inbound database port. It is not a replacement for a managed database
 * in production, but it keeps the app runnable offline.
 */
export async function createPgliteEngine(config: AppConfig): Promise<SqlEngine> {
  // Match the `pg` type parsers used for production: PostgreSQL returns
  // int8/numeric aggregates as text, while the application expects numbers.
  const db = new PGlite(config.pgliteDir, {
    parsers: {
      20: (value: string) => Number(value),
      1700: (value: string) => Number(value),
    },
  });
  await db.waitReady;

  const executor = (tx: {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }>;
    exec: (sql: string) => Promise<unknown>;
  }): SqlExecutor => ({
    query: async (sql, params) => toResult(await tx.query(sql, params as unknown[])),
    exec: async (sql) => {
      await tx.exec(sql);
    },
  });

  return {
    kind: 'pglite',
    query: async (sql: string, params: SqlParam[]) => toResult(await db.query(sql, params as unknown[])),
    exec: async (sql: string) => {
      await db.exec(sql);
    },
    transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => {
      return db.transaction(async (tx) => fn(executor(tx)));
    },
    close: async () => {
      await db.close();
    },
  };
}
