import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface Headline {
  id: number;
  headline: string;
  register: 1 | 2 | null;
  player_ids: string[] | null;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
  status: 'draft' | 'published' | 'discarded';
  // Who authored the draft — 'submission' rows came in through the public
  // /submit form and carry unverified text (and no photo yet), so the admin
  // queue treats them as needing extra scrutiny.
  source: 'admin' | 'submission';
  submitter_name: string | null;
  // Auto-classification output written by the ingest classifier job.
  // category is plain text (taxonomy defined in the classifier prompt), not an
  // enum, so adding a tag needs no migration; safety_status mirrors the DB CHECK.
  category: string | null;
  safety_status: 'safe' | 'review' | 'blocked' | null;
  safety_reason: string | null;
  classified_at: string | null;
  created_at: string;
  published_at: string | null;
}

export async function getPublishedHeadlines(): Promise<Headline[]> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE status = 'published' ORDER BY published_at DESC`
  );
  return rows;
}

// Single published headline for a permalink page. Returns null for a draft or
// discarded row — a permalink to an unpublished headline must 404, never leak
// the unreviewed row.
export async function getHeadlineById(id: number): Promise<Headline | null> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE id = $1 AND status = 'published'`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getDraftHeadlines(): Promise<Headline[]> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE status = 'draft' ORDER BY created_at DESC`
  );
  return rows;
}

// Capped window for the admin unpublish UI — not the full publish history.
export async function getRecentPublishedHeadlines(limit = 20): Promise<Headline[]> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE status = 'published' ORDER BY published_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export interface HeadlineEdit {
  headline: string;
  register: 1 | 2 | null;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
}

export async function updateHeadline(id: number, edit: HeadlineEdit): Promise<void> {
  await getPool().query(
    `UPDATE headlines
     SET headline = $2, register = $3, stat_block = $4, photo_ref = $5, source_post_url = $6, source_note = $7,
         -- Content changed, so the previous classification is stale. Clear all
         -- four fields (not just classified_at) so no stale badge lingers before
         -- the job re-runs; classified_at NULL makes the classifier pick it up.
         category = NULL, safety_status = NULL, safety_reason = NULL, classified_at = NULL
     WHERE id = $1`,
    [
      id,
      edit.headline,
      edit.register,
      edit.stat_block,
      edit.photo_ref,
      edit.source_post_url,
      edit.source_note,
    ]
  );
}

export async function publishHeadline(id: number): Promise<void> {
  await getPool().query(
    `UPDATE headlines SET status = 'published', published_at = now() WHERE id = $1 AND status = 'draft'`,
    [id]
  );
}

export async function unpublishHeadline(id: number): Promise<void> {
  await getPool().query(
    `UPDATE headlines SET status = 'draft', published_at = NULL WHERE id = $1 AND status = 'published'`,
    [id]
  );
}

// Soft-deletes (kept, not hard-deleted) — discarded register-2 generations are
// useful signal for prompt tuning later.
export async function discardHeadline(id: number): Promise<void> {
  await getPool().query(
    `UPDATE headlines SET status = 'discarded' WHERE id = $1 AND status != 'discarded'`,
    [id]
  );
}

export interface HeadlineCreate {
  headline: string;
  register: 1 | 2 | null;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
}

export async function createHeadline(input: HeadlineCreate): Promise<void> {
  await getPool().query(
    `INSERT INTO headlines (headline, register, player_ids, stat_block, photo_ref, source_post_url, source_note)
     VALUES ($1, $2, '{}', $3, $4, $5, $6)`,
    [
      input.headline,
      input.register,
      input.stat_block,
      input.photo_ref,
      input.source_post_url,
      input.source_note,
    ]
  );
}

export interface HeadlineSubmission {
  headline: string;
  submitter_name: string | null;
  context_note: string | null;
}

// Public /submit intake (issue #82). Deliberately narrower than
// HeadlineCreate — no register, no photo (that hard rule needs a human's
// judgment call on photo provenance, see photoImport.ts / CLAUDE.md), no
// player tagging. Lands as a normal draft row so the existing classifier +
// admin review + publish gate apply unchanged; only `source`/`submitter_name`
// mark where it came from.
export async function createSubmittedHeadline(input: HeadlineSubmission): Promise<void> {
  await getPool().query(
    `INSERT INTO headlines (headline, player_ids, source_note, submitter_name, source)
     VALUES ($1, '{}', $2, $3, 'submission')`,
    [input.headline, input.context_note, input.submitter_name]
  );
}
