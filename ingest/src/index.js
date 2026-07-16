// bluejays-ingest — draft classifier job. Runs once and exits.
// Dev: `docker compose run --rm ingest`. Selects draft rows the classifier
// hasn't seen yet (classified_at IS NULL), assigns each a topic category and a
// safety verdict via Claude (text + attached image, vision), and writes the
// result back. Blocked (illegal/doxxing) drafts are auto-discarded; everything
// else is flagged for admin review. Requires ANTHROPIC_API_KEY.

import pg from 'pg';
import { classify } from './classify.js';
import { getImageBytes } from './storage.js';

const { Pool } = pg;

export function configSummary() {
  const present = (name) => (process.env[name] ? 'set' : 'NOT SET');
  return {
    DATABASE_URL: present('DATABASE_URL'),
    ANTHROPIC_API_KEY: present('ANTHROPIC_API_KEY'),
    CLASSIFIER_MODEL: process.env.CLASSIFIER_MODEL || 'claude-haiku-4-5',
    S3_ENDPOINT: present('S3_ENDPOINT'),
  };
}

// Pure verdict applicator — the job's only rule, extracted so it's testable
// without a DB. Returns the set of headline columns to write for a given
// classification result. Blocked (illegal/doxxing) rows are auto-discarded;
// safe/review keep their status and just get flagged.
export function applyVerdict(result) {
  const base = {
    category: result.category,
    safety_status: result.safety_status,
    safety_reason: result.safety_reason,
    classified_at: 'now()',
  };
  if (result.safety_status === 'blocked') {
    return { ...base, status: "'discarded'" };
  }
  return base;
}

async function getUnclassifiedDrafts(pool) {
  const { rows } = await pool.query(
    `SELECT id, headline, stat_block, source_note, photo_ref
     FROM headlines
     WHERE status = 'draft' AND classified_at IS NULL
     ORDER BY created_at`
  );
  return rows;
}

async function saveClassification(pool, id, result) {
  const cols = applyVerdict(result);
  // classified_at uses now() literally; safety_status/category/reason are
  // parameters. status is only present for the blocked branch.
  if (cols.status) {
    await pool.query(
      `UPDATE headlines
       SET category = $2, safety_status = $3, safety_reason = $4,
           classified_at = now(), status = 'discarded'
       WHERE id = $1`,
      [id, cols.category, cols.safety_status, cols.safety_reason]
    );
  } else {
    await pool.query(
      `UPDATE headlines
       SET category = $2, safety_status = $3, safety_reason = $4, classified_at = now()
       WHERE id = $1`,
      [id, cols.category, cols.safety_status, cols.safety_reason]
    );
  }
}

async function runClassification(pool) {
  const drafts = await getUnclassifiedDrafts(pool);
  console.log(`[ingest] ${drafts.length} unclassified draft(s) to process`);
  if (drafts.length === 0) return;

  let processed = 0;
  let blocked = 0;
  for (const draft of drafts) {
    // Best-effort image fetch: a missing/unreadable photo must not block text
    // classification. The classifier degrades to text-only in that case.
    let image = null;
    if (draft.photo_ref) {
      const img = await getImageBytes(draft.photo_ref);
      if (img) {
        image = { base64: img.buffer.toString('base64'), mediaType: img.contentType };
      }
    }

    try {
      const result = await classify({
        headline: draft.headline,
        statBlock: draft.stat_block,
        sourceNote: draft.source_note,
        image,
      });
      await saveClassification(pool, draft.id, result);
      processed += 1;
      if (result.safety_status === 'blocked') blocked += 1;
    } catch (err) {
      // One draft failing must not abort the run; leave it unclassified so the
      // next run retries it.
      console.error(`[ingest] draft #${draft.id} failed: ${err.message}`);
    }
  }

  console.log(`[ingest] classified ${processed}/${drafts.length} (${blocked} auto-discarded)`);
}

async function main() {
  console.log('[ingest] starting classification run');
  console.log('[ingest] config:', configSummary());

  if (!process.env.DATABASE_URL) {
    console.log('[ingest] DATABASE_URL not set, nothing to do');
    console.log('[ingest] done');
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[ingest] ANTHROPIC_API_KEY not set — cannot classify, exiting');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await runClassification(pool);
  } finally {
    await pool.end();
  }

  console.log('[ingest] done');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[ingest] failed:', err);
    process.exitCode = 1;
  });
}
