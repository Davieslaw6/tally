import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config';
import { MIGRATIONS } from './migrations';
import { createPostgresEngine } from './postgres';
import { SqlClient } from './sql';

export interface DbContext {
  client: SqlClient;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

interface MigrationLogger {
  info: (message: string) => void;
}

const MIGRATION_LOCK_KEY = 0x7a11;

async function applyMigrations(client: SqlClient, logger?: MigrationLogger): Promise<void> {
  const migrate = async (): Promise<void> => {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const applied = new Set(
      (await client.prepare('SELECT version FROM schema_migrations').all<{ version: string }>()).map(
        (row) => row.version,
      ),
    );

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      await client.exec(migration.sql);
      await client
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
      logger?.info(`Applied migration ${migration.version}`);
    }
  };

  if (client.kind === 'postgres') {
    // Fast path for warm databases: when every migration is already recorded,
    // skip the lock transaction entirely (saves several round trips per cold start).
    try {
      const done = new Set(
        (await client.prepare('SELECT version FROM schema_migrations').all<{ version: string }>()).map(
          (row) => row.version,
        ),
      );
      if (MIGRATIONS.every((migration) => done.has(migration.version))) return;
    } catch {
      // Table does not exist yet: fall through to the locked migration below.
    }
    // Serverless platforms can start several instances at once. The advisory
    // xact lock serialises the first migration across all of them, and the
    // version check inside the transaction makes the second instance a no-op.
    await client.transaction(async () => {
      await client.prepare('SELECT pg_advisory_xact_lock(?)').get(MIGRATION_LOCK_KEY);
      await migrate();
    });
  } else {
    await migrate();
  }
}

export async function createDatabase(config: AppConfig, logger?: MigrationLogger): Promise<DbContext> {
  let client: SqlClient;
  try {
    if (config.databaseUrl) {
      client = new SqlClient(createPostgresEngine(config), 'postgres');
      await client.prepare('SELECT 1').get();
    } else {
      if (config.pgliteDir !== 'memory://') {
        fs.mkdirSync(path.dirname(config.pgliteDir), { recursive: true, mode: 0o700 });
      }
      // Keep the embedded database out of the serverless bundle. Production
      // always uses PostgreSQL; PGlite is a local development convenience.
      const { createPgliteEngine } = await import('./pglite');
      client = new SqlClient(await createPgliteEngine(config), 'pglite');
    }
  } catch (error) {
    throw new Error(
      `Cannot connect to the TALLY database. ${
        config.databaseUrl
          ? 'Check DATABASE_URL and that PostgreSQL accepts connections.'
          : 'Check that the embedded database directory is writable.'
      } ${(error as Error).message}`,
      { cause: error },
    );
  }

  try {
    await applyMigrations(client, logger);
  } catch (error) {
    try {
      await client.close();
    } catch {
      // Preserve the migration error.
    }
    throw new Error(`TALLY database migration failed: ${(error as Error).message}`, { cause: error });
  }

  return {
    client,
    kind: client.kind,
    close: () => client.close(),
  };
}
