import pg from 'pg';
import type { Pool as PgPool, PoolClient } from 'pg';
import type { AppConfig } from '../config';
import type { SqlEngine, SqlExecutor, SqlParam, SqlQueryResult } from './sql';

const { Pool, types } = pg;

// PostgreSQL returns int8/numeric aggregates as strings to avoid precision
// loss. TALLY's money values and counters fit comfortably in a JS number, and
// the rest of the application expects numbers, so parse those OIDs once.
types.setTypeParser(20, (value: string) => Number(value));
types.setTypeParser(1700, (value: string) => Number(value));

function toResult(result: pg.QueryResult): SqlQueryResult {
  return {
    rows: result.rows as Record<string, unknown>[],
    rowCount: result.rowCount ?? 0,
  };
}

export function createPostgresEngine(config: AppConfig): SqlEngine {
  const pool = new Pool({
    connectionString: config.databaseUrl ?? undefined,
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    application_name: 'tally',
  });

  // A pool error must not crash the process; individual requests will surface
  // connection errors through their normal error path.
  pool.on('error', () => undefined);

  const executor = (client: PgPool | PoolClient): SqlExecutor => ({
    query: async (sql, params) => toResult(await client.query(sql, params as unknown[])),
    exec: async (sql) => {
      await client.query(sql);
    },
  });

  return {
    kind: 'postgres',
    query: async (sql: string, params: SqlParam[]) => toResult(await pool.query(sql, params as unknown[])),
    exec: async (sql: string) => {
      await pool.query(sql);
    },
    transaction: async <T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(executor(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The original error is more useful than a rollback failure.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
