CREATE TABLE
    IF NOT EXISTS handles (
        handle text PRIMARY KEY,
        did text UNIQUE NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now ()
    );

CREATE TABLE
    IF NOT EXISTS headlines (
        id serial PRIMARY KEY,
        headline text NOT NULL,
        subtitle text,
        photo_ref text,
        source_post_url text,
        source_note text,
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'discarded')),
        category text, -- topic tag: game-recap | trade-rumor | ...
        safety_status text CHECK (safety_status IN ('safe', 'review', 'blocked')),
        safety_reason text,
        classified_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now (),
        published_at timestamptz
    );

CREATE INDEX IF NOT EXISTS headlines_published_idx ON headlines (published_at DESC)
WHERE
    status = 'published';

ALTER TABLE headlines
DROP CONSTRAINT IF EXISTS headlines_status_check;

ALTER TABLE headlines ADD CONSTRAINT headlines_status_check CHECK (status IN ('draft', 'published', 'discarded'));

ALTER TABLE headlines
ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE headlines
ADD COLUMN IF NOT EXISTS safety_status text;

ALTER TABLE headlines
ADD COLUMN IF NOT EXISTS safety_reason text;

ALTER TABLE headlines
ADD COLUMN IF NOT EXISTS classified_at timestamptz;

ALTER TABLE headlines
DROP CONSTRAINT IF EXISTS headlines_safety_status_check;

ALTER TABLE headlines ADD CONSTRAINT headlines_safety_status_check CHECK (safety_status IN ('safe', 'review', 'blocked'));

DROP TABLE IF EXISTS seen_posts;

CREATE INDEX IF NOT EXISTS headlines_unclassified_idx ON headlines (created_at)
WHERE
    status = 'draft'
    AND classified_at IS NULL;

ALTER TABLE headlines
DROP COLUMN IF EXISTS register;

ALTER TABLE headlines
DROP COLUMN IF EXISTS player_ids;

ALTER TABLE headlines
ADD COLUMN IF NOT EXISTS submitter_name text;

ALTER TABLE headlines
ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin';

ALTER TABLE headlines
DROP CONSTRAINT IF EXISTS headlines_source_check;

ALTER TABLE headlines ADD CONSTRAINT headlines_source_check CHECK (source IN ('admin', 'submission'));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'headlines' AND column_name = 'stat_block'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'headlines' AND column_name = 'subtitle'
    ) THEN
        ALTER TABLE headlines RENAME COLUMN stat_block TO subtitle;
    END IF;
END $$;
