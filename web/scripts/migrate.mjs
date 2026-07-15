// Applies web/db/schema.sql against DATABASE_URL, then exits. Run once at
// container startup, before the server starts accepting traffic — see the
// Dockerfile CMD and docker-entrypoint-dev.sh. Closes the gap where a schema
// change (e.g. the headlines.status CHECK widening for 'discarded') sat
// applied in the repo but not in a real database until someone remembered to
// run it by hand; see docs/production-verification.md for the history.
//
// Guarded by a Postgres advisory lock so two overlapping instances (a
// rolling deploy, a dev container restarting while another is still mid-way
// through) can't apply the schema concurrently — CREATE TABLE IF NOT EXISTS
// and DROP CONSTRAINT IF EXISTS/ADD CONSTRAINT are idempotent individually,
// but two connections running them at the same moment can still deadlock
// against each other on the same catalog rows.
//
// schema.sql is written to be safely re-run in full every time. This script
// deliberately doesn't track *which* statements already ran anywhere — it
// just re-applies the whole file. That stops working the day a migration
// needs to do something that can't be safely repeated on every boot (a data
// backfill, a destructive column rename) — see docs/backend-api-plan.md for
// the plan to adopt a real migration tool at that point.

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

// Arbitrary fixed key for the advisory lock. Any two sessions calling
// pg_advisory_lock with the same bigint key serialize against each other;
// the number itself carries no meaning beyond "the schema migration lock".
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

// Only run when executed directly (`node scripts/migrate.mjs`), not when
// imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exitCode = 1;
  });
}
