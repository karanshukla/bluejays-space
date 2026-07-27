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
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
  status: 'draft' | 'published' | 'discarded';
  // Who authored the draft. 'submission' rows came in through the public
  // /submit form and carry unverified text/photo, so the admin queue treats
  // them as needing extra scrutiny.
  source: 'admin' | 'submission';
  submitter_name: string | null;
  // Auto-classification output written by the classify job.
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
// discarded row. A permalink to an unpublished headline must 404, never leak
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

// Capped window for the admin unpublish UI, not the full publish history. Also
// backs the RSS feed (feed.xml.ts). Kept as a simple capped query — sitemap.xml
// needs the full unpaginated set and uses getPublishedHeadlines for that.
export async function getRecentPublishedHeadlines(limit = 20): Promise<Headline[]> {
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines WHERE status = 'published' ORDER BY published_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

// Page sizes for the two paginated views.
export const FEED_PAGE_SIZE = 12;
export const ADMIN_PAGE_SIZE = 12;

// Keyset (cursor) pagination for the public feed's infinite scroll (issue #123).
// The cursor is the (published_at, id) of the oldest row already shown; the next
// page is everything strictly older, with id as a tiebreaker so rows sharing a
// timestamp are never skipped or repeated at the page boundary. Keyset over
// OFFSET because the feed is ordered by published_at DESC and new headlines
// publish between page loads — OFFSET would skip or repeat rows as the set
// shifts, while the compound cursor stays stable. Omit the cursor for page one.
//
// The cursor clause is built dynamically (rather than `WHERE $1 IS NULL OR …`)
// because Postgres does not guarantee OR short-circuits: if it evaluated the
// ROW comparison with a NULL cursor, every row would test NULL and drop out.
export async function getPublishedHeadlinesPage({
  before,
  beforeId,
  limit = FEED_PAGE_SIZE,
}: {
  before?: string | null;
  beforeId?: number | null;
  limit?: number;
} = {}): Promise<Headline[]> {
  const params: (string | number)[] = [];
  let cursorClause = '';
  if (before && beforeId != null) {
    params.push(before, beforeId);
    cursorClause = `AND (published_at < $1::timestamptz
                        OR (published_at = $1::timestamptz AND id < $2::int))`;
  }
  params.push(limit);
  const { rows } = await getPool().query<Headline>(
    `SELECT * FROM headlines
     WHERE status = 'published' ${cursorClause}
     ORDER BY published_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

export interface PublishedHeadlinesPage {
  rows: Headline[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// OFFSET pagination for the admin Published tab (issue #122). Keyset is a poor
// fit there because the admin browses the history in both directions with page
// numbers; OFFSET's drift under inserts is a non-issue at admin traffic volumes.
export async function getPublishedHeadlinesPaged({
  page = 1,
  pageSize = ADMIN_PAGE_SIZE,
}: {
  page?: number;
  pageSize?: number;
} = {}): Promise<PublishedHeadlinesPage> {
  const safePage = Math.max(1, Math.floor(page));
  const offset = (safePage - 1) * pageSize;
  const [data, count] = await Promise.all([
    getPool().query<Headline>(
      `SELECT * FROM headlines
       WHERE status = 'published'
       ORDER BY published_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    ),
    // COUNT(*) returns bigint, which pg serializes as a string.
    getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM headlines WHERE status = 'published'`
    ),
  ]);
  const total = Number(count.rows[0]?.count ?? 0);
  return {
    rows: data.rows,
    page: safePage,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface HeadlineEdit {
  headline: string;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
}

export async function updateHeadline(id: number, edit: HeadlineEdit): Promise<void> {
  await getPool().query(
    `UPDATE headlines
     SET headline = $2, stat_block = $3, photo_ref = $4, source_post_url = $5, source_note = $6,
         -- Content changed, so the previous classification is stale. Clear all
         -- four fields (not just classified_at) so no stale badge lingers before
         -- the job re-runs; classified_at NULL makes the classifier pick it up.
         category = NULL, safety_status = NULL, safety_reason = NULL, classified_at = NULL
     WHERE id = $1`,
    [id, edit.headline, edit.stat_block, edit.photo_ref, edit.source_post_url, edit.source_note]
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

// Soft-deletes (kept, not hard-deleted). Discarded generations are useful
// signal for prompt tuning later.
export async function discardHeadline(id: number): Promise<void> {
  await getPool().query(
    `UPDATE headlines SET status = 'discarded' WHERE id = $1 AND status != 'discarded'`,
    [id]
  );
}

export interface HeadlineCreate {
  headline: string;
  stat_block: string | null;
  photo_ref: string | null;
  source_post_url: string | null;
  source_note: string | null;
}

export async function createHeadline(input: HeadlineCreate): Promise<void> {
  await getPool().query(
    `INSERT INTO headlines (headline, stat_block, photo_ref, source_post_url, source_note)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.headline, input.stat_block, input.photo_ref, input.source_post_url, input.source_note]
  );
}

export interface HeadlineSubmission {
  headline: string;
  stat_block: string | null;
  photo_ref: string | null;
  source_note: string | null;
  submitter_name: string | null;
}

// Public /submit intake (issue #82). Just the fields the classifier and the
// public card actually use: headline, stat_block, photo_ref (the classifier
// reads all three, see classify/src/classify.js), and source_note (extra
// context for the classifier, also shown on the card). Lands as a normal
// draft row so the existing classifier + admin review + publish gate apply
// unchanged; `source`/`submitter_name` just mark where it came from.
export async function createSubmittedHeadline(input: HeadlineSubmission): Promise<void> {
  await getPool().query(
    `INSERT INTO headlines (headline, stat_block, photo_ref, source_note, submitter_name, source)
     VALUES ($1, $2, $3, $4, $5, 'submission')`,
    [input.headline, input.stat_block, input.photo_ref, input.source_note, input.submitter_name]
  );
}
