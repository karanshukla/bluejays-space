// bluejays-ingest — headline generation job (stub).
//
// Runs once and exits, matching Railway cron semantics. In dev it's triggered
// manually:  docker compose run --rm ingest
//
// The real generation flow (fetch Reddit/Bluesky/MLB/FAX Sports -> draft with
// Claude -> write draft rows to Postgres) lands in a later task. This stub
// wires up the DB write path so the admin review UI has real rows to work
// with: it inserts one placeholder draft per register on every run.

import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureBucket, uploadImage } from './storage.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function configSummary() {
  const present = (name) => (process.env[name] ? 'set' : 'NOT SET');
  return {
    DATABASE_URL: present('DATABASE_URL'),
    ANTHROPIC_API_KEY: present('ANTHROPIC_API_KEY'),
    GENERATION_MODEL: process.env.GENERATION_MODEL || 'claude-haiku-4-5',
    REDDIT_CLIENT_ID: present('REDDIT_CLIENT_ID'),
    BLUESKY_APP_PASSWORD: present('BLUESKY_APP_PASSWORD'),
  };
}

// Placeholder drafts standing in for the real generation step. Register 1
// stays low-temperature/grounded, register 2 is the fabricated-scenario bit —
// see the project spec for the full register definitions. photo_ref for the
// first draft is filled in at runtime once the demo image upload completes
// (see uploadDemoImage below) — it's not a real player photo, just proof
// the object-storage path works end to end.
export function stubDrafts(demoPhotoRef) {
  return [
    {
      headline: 'Home Run Dragon found as lifeless as Trey Yesavage’s pitching',
      register: 1,
      player_ids: [],
      stat_block: '(stub) placeholder stat line',
      photo_ref: demoPhotoRef,
      source_post_url: null,
      source_note: '(stub) placeholder — real fetch/generation pending',
    },
    {
      headline: '(stub) fabricated-scenario placeholder headline',
      register: 2,
      player_ids: [],
      stat_block: '(stub) placeholder stat line',
      photo_ref: null,
      source_post_url: null,
      source_note: null,
    },
  ];
}

async function insertDrafts(pool, drafts) {
  for (const draft of drafts) {
    await pool.query(
      `INSERT INTO headlines (headline, register, player_ids, stat_block, photo_ref, source_post_url, source_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        draft.headline,
        draft.register,
        draft.player_ids,
        draft.stat_block,
        draft.photo_ref,
        draft.source_post_url,
        draft.source_note,
      ]
    );
  }
}

// Uploads the repo's placeholder image as a stand-in for real sourced player
// photos, proving the storage write path works. Returns the object key, or
// null if S3 isn't configured (e.g. running without MinIO).
async function uploadDemoImage() {
  if (!process.env.S3_ENDPOINT) {
    console.log('[ingest] S3_ENDPOINT not set, skipping demo image upload');
    return null;
  }
  await ensureBucket();
  const bytes = await readFile(path.join(__dirname, '..', 'assets', 'demo.jpg'));
  const key = 'stub/demo.jpg';
  await uploadImage(key, bytes, 'image/jpeg');
  return key;
}

async function main() {
  console.log('[ingest] starting generation run');
  console.log('[ingest] config:', configSummary());

  if (!process.env.DATABASE_URL) {
    console.log('[ingest] DATABASE_URL not set, skipping DB write');
    console.log('[ingest] done');
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('[ingest] stub: fetch + generate would run here; inserting placeholder drafts');
    const demoPhotoRef = await uploadDemoImage();
    const drafts = stubDrafts(demoPhotoRef);
    await insertDrafts(pool, drafts);
    console.log(`[ingest] inserted ${drafts.length} draft row(s)`);
  } finally {
    await pool.end();
  }

  console.log('[ingest] done');
}

// Only run when executed directly (`node src/index.js`), not when imported
// by tests (`import { stubDrafts } from './index.js'`).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[ingest] failed:', err);
    process.exitCode = 1;
  });
}
