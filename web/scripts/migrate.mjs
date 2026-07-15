// Applies web/db/schema.sql against DATABASE_URL on every boot, before the
// server accepts traffic. schema.sql is idempotent (CREATE/IF NOT EXISTS), so
// re-running the whole file is safe — until a non-repeatable migration (data
// backfill, destructive rename) is needed, at which point adopt a real tool.
// Guarded by a Postgres advisory lock so overlapping instances can't run it
// concurrently.
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

const ADVISORY_LOCK_KEY = 729_130_001;

export async function runMigration(pool, sql) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    try {
      await client.query(sql);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('[migrate] DATABASE_URL not set, skipping schema migration');
    return;
  }

  const sql = await readFile(SCHEMA_PATH, 'utf8');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('[migrate] applying web/db/schema.sql...');
    await runMigration(pool, sql);
    console.log('[migrate] done');
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  });
}
