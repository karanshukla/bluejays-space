// Dedup against the seen_posts table so re-runs don't re-surface the same
// Reddit/Bluesky candidate material. `external_id` is the platform fullname
// (Reddit t3_...) or post uri (Bluesky at://...).

// Pure filter — drops posts whose external_id is in the seen set. Testable
// without a DB. Posts with a null external_id are kept (can't dedup them).
export function filterUnseen(posts, seenIds) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds);
  return posts.filter((p) => !p.external_id || !seen.has(p.external_id));
}

// Idempotent — safe to call every run. Matches the ensureBucket() pattern so
// existing dev volumes pick up the table without a `docker compose down -v`.
export async function ensureSeenPostsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seen_posts (
      source       text NOT NULL,
      external_id  text NOT NULL,
      seen_at      timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (source, external_id)
    )
  `);
}

// Load the seen external_ids for one source into a Set.
export async function getSeenIds(pool, source) {
  const { rows } = await pool.query('SELECT external_id FROM seen_posts WHERE source = $1', [
    source,
  ]);
  return new Set(rows.map((r) => r.external_id));
}

// Record newly-seen ids. Ignores conflicts (idempotent re-marking).
export async function markSeen(pool, source, externalIds) {
  if (externalIds.length === 0) return;
  // Batch-insert with UNNEST to avoid a per-id round trip.
  await pool.query(
    `INSERT INTO seen_posts (source, external_id)
     SELECT $1, * FROM UNNEST($2::text[])
     ON CONFLICT DO NOTHING`,
    [source, externalIds]
  );
}
