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
  status: 'draft' | 'published';
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
