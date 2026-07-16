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
-- Drafts originate from the admin create-form (user-submission intake is a
-- planned follow-up) and are classified by bluejays-ingest: it assigns a topic
-- category and a safety verdict (text + image, via Claude vision), auto-
-- discarding only illegal/doxxing content and flagging the rest for review.
-- Karan reviews/edits in /admin and flips status to 'published'. The public
-- feed only reads published rows.
CREATE TABLE IF NOT EXISTS headlines (
    id               serial PRIMARY KEY,
    headline         text NOT NULL,
    register         smallint NOT NULL CHECK (register IN (1, 2)),
    player_ids       text[],
    stat_block       text,
    photo_ref        text,
    source_post_url  text,          -- register 1 only
    source_note      text,          -- register 1 only
    status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'discarded')),
    -- Auto-classification output (written by the ingest classifier job).
    -- NULL until first classified; re-set to NULL by web if a draft is edited
    -- so the job re-runs on the new content.
    category         text,          -- topic tag: game-recap | trade-rumor | ...
    safety_status    text CHECK (safety_status IN ('safe', 'review', 'blocked')),
    safety_reason    text,
    classified_at    timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    published_at     timestamptz
);

-- Only published rows matter for the public feed; index that subset.
CREATE INDEX IF NOT EXISTS headlines_published_idx
    ON headlines (published_at DESC)
    WHERE status = 'published';

-- Ingest classifier selects draft rows it hasn't seen yet (classified_at NULL).
CREATE INDEX IF NOT EXISTS headlines_unclassified_idx
    ON headlines (created_at)
    WHERE status = 'draft' AND classified_at IS NULL;

-- Migration: widen headlines.status to allow 'discarded' (soft-delete for a
-- draft/published row an admin has rejected — see web/src/lib/db.ts
-- discardHeadline()). CREATE TABLE IF NOT EXISTS above only applies the wider
-- CHECK on a fresh init; this ALTER re-applies it against an
-- already-initialized dev volume or the live production DB. Safe to re-run —
-- DROP CONSTRAINT IF EXISTS makes it idempotent, per docs/production-verification.md's
-- "no migration runner yet, re-run schema.sql by hand" pattern.
ALTER TABLE headlines DROP CONSTRAINT IF EXISTS headlines_status_check;
ALTER TABLE headlines ADD CONSTRAINT headlines_status_check
    CHECK (status IN ('draft', 'published', 'discarded'));

-- Migration: add the auto-classification columns + safety_status CHECK to
-- headlines tables created before the classifier existed (CREATE TABLE IF NOT
-- EXISTS above only adds them on a fresh init). Same idempotent ADD COLUMN IF
-- NOT EXISTS / DROP+ADD CONSTRAINT pattern as the status migration above.
ALTER TABLE headlines ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE headlines ADD COLUMN IF NOT EXISTS safety_status text;
ALTER TABLE headlines ADD COLUMN IF NOT EXISTS safety_reason text;
ALTER TABLE headlines ADD COLUMN IF NOT EXISTS classified_at timestamptz;
ALTER TABLE headlines DROP CONSTRAINT IF EXISTS headlines_safety_status_check;
ALTER TABLE headlines ADD CONSTRAINT headlines_safety_status_check
    CHECK (safety_status IN ('safe', 'review', 'blocked'));

-- Drop the legacy seen_posts dedup table. The classifier reads drafts back
-- from headlines (classified_at IS NULL), so the per-source post dedup the
-- old generator relied on is dead. Safe to re-run.
DROP TABLE IF EXISTS seen_posts;
