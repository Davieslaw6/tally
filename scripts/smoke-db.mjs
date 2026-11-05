// Database smoke test. Applies the embedded migrations to DATABASE_URL when it
// is set, otherwise to an in-memory PGlite database, then prints the resulting
// tables and the reporting view.
//
//   npx tsx scripts/smoke-db.mjs
//   DATABASE_URL=postgresql://... npx tsx scripts/smoke-db.mjs
import { loadConfig } from '../src/server/config.ts';
import { createDatabase } from '../src/server/db/index.ts';

const config = loadConfig({
  env: 'development',
  isProduction: false,
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  pgliteDir: 'memory://',
  logLevel: 'silent',
});

const db = await createDatabase(config, { info: (message) => console.log(message) });
try {
  const tables = await db.client
    .prepare(
      `SELECT table_name, table_type FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_type, table_name`,
    )
    .all();
  console.log(`Database kind: ${db.kind}`);
  console.table(tables);
} finally {
  await db.close();
}
