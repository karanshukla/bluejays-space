-- bluejays.space — baseline schema
--
-- Auto-loaded by Postgres on first volume init (mounted into
-- /docker-entrypoint-initdb.d/ by docker-compose). Provisional — replaceable
-- by a migration tool (e.g. Drizzle) once the apps adopt one.

-- Handle directory.
-- Mirrors the invariants enforced by handles/handles.go add():
--   * a handle is locked to exactly one DID  (handle PRIMARY KEY)
--   * a DID can only own one handle          (did UNIQUE)
CREATE TABLE IF NOT EXISTS handles (
    handle     text PRIMARY KEY,
    did        text UNIQUE NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Headline feed ("The Scrapbook") — draft/publish workflow.
-- Drafts are written by bluejays-ingest; Karan reviews/edits in /admin and
-- flips status to 'published'. The public feed only reads published rows.
CREATE TABLE IF NOT EXISTS headlines (
    id               serial PRIMARY KEY,
    headline         text NOT NULL,
    register         smallint NOT NULL CHECK (register IN (1, 2)),
    player_ids       text[],
    stat_block       text,
    photo_ref        text,
    source_post_url  text,          -- register 1 only
    source_note      text,          -- register 1 only
    status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    published_at     timestamptz
);

-- Only published rows matter for the public feed; index that subset.
CREATE INDEX IF NOT EXISTS headlines_published_idx
    ON headlines (published_at DESC)
    WHERE status = 'published';

-- Ingest dedup: records which Reddit/Bluesky posts have already been fed to
-- the generator so re-runs don't re-surface the same candidate material.
-- `external_id` is the platform's stable id — Reddit fullname (t3_...) or
-- Bluesky post uri. Created idempotently by ingest at runtime so existing dev
-- volumes pick it up without a `docker compose down -v` reset.
CREATE TABLE IF NOT EXISTS seen_posts (
    source       text NOT NULL,        -- 'reddit' | 'bluesky'
    external_id  text NOT NULL,
    seen_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, external_id)
);
