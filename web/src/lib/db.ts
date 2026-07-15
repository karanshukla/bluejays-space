// Shared Postgres access for the web app (public feed + /admin).
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export interface Headline {
  id: number;
  headline: string;
  register: 1 | 2;
  player_ids: string[] | null;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
  status: 'draft' | 'published' | 'discarded';
  created_at: string;
  published_at: string | null;
}

export async function getPublishedHeadlines(): Promise<Headline[]> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE status = 'published' ORDER BY published_at DESC`
  );
  return rows;
}

export async function getDraftHeadlines(): Promise<Headline[]> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE status = 'draft' ORDER BY created_at DESC`
  );
  return rows;
}

// Recently published rows, for the admin "unpublish" UI. Deliberately capped
// and separate from getPublishedHeadlines() (the public feed's unbounded
// query) — admin only needs a recent window to catch/undo a mistake, not the
// full history. See docs/backend-api-plan.md item 7 for the broader
// pagination gap this doesn't attempt to solve.
export async function getRecentPublishedHeadlines(limit = 20): Promise<Headline[]> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE status = 'published' ORDER BY published_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export interface HeadlineEdit {
  headline: string;
  register: 1 | 2;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
}

export async function updateHeadline(id: number, edit: HeadlineEdit): Promise<void> {
  await getPool().query(
    `UPDATE headlines
     SET headline = $2, register = $3, stat_block = $4, photo_ref = $5, source_post_url = $6, source_note = $7
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

// Undoes a publish — flips back to draft and clears published_at so a
// mistake made it to the public feed doesn't need a database console to fix.
// Only applies from 'published' (a no-op on an already-draft/discarded row).
export async function unpublishHeadline(id: number): Promise<void> {
  await getPool().query(
    `UPDATE headlines SET status = 'draft', published_at = NULL WHERE id = $1 AND status = 'published'`,
    [id]
  );
}

// Soft-deletes a draft or published row. Kept (not hard-deleted) rather than
// removed outright — a discarded register-2 generation is useful signal for
// prompt tuning later, per docs/backend-api-plan.md item 2 — but excluded
// from both the public feed and the admin draft/published lists via the
// status filter already on those queries.
export async function discardHeadline(id: number): Promise<void> {
  await getPool().query(
    `UPDATE headlines SET status = 'discarded' WHERE id = $1 AND status != 'discarded'`,
    [id]
  );
}

export interface HeadlineCreate {
  headline: string;
  register: 1 | 2;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
}

// Inserts a new draft row directly from the admin UI, bypassing the ingest
// generation pipeline entirely — for a headline written by hand rather than
// drafted by Claude. Lands as an ordinary draft; goes through the same
// review/publish flow as a generated one.
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
