# Backend / CRUD API follow-up

What exists today, and what's still missing, across the two data-owning services (`web`'s API routes over the `headlines` table, and `handles`' JSON-file + GitHub-PR flow). Read `db/schema.sql` alongside this — it's short enough to just read directly rather than restate here.

## `headlines` API — current surface

| Route | Method | Does |
|---|---|---|
| `/admin/api/headlines/[id]/update` | POST (form) | Updates all editable fields on a draft or published row — no field-level diffing, always overwrites headline/register/stat_block/photo_ref/source_post_url/source_note. See `web/src/lib/db.ts` `updateHeadline`. |
| `/admin/api/headlines/[id]/publish` | POST | Flips `status` to `published`, sets `published_at = now()`. From `draft` only. |
| `/admin/api/headlines/[id]/unpublish` | POST | Flips `status` back to `draft`, clears `published_at`. From `published` only. |
| `/admin/api/headlines/[id]/discard` | POST | Soft-deletes: sets `status = 'discarded'`. From any non-discarded status — works directly on a published row too, not just drafts. |
| `/admin/api/headlines/create` | POST (form) | Inserts a new `draft` row by hand, bypassing `ingest` entirely — for a headline written from scratch rather than generated. See `web/src/lib/db.ts` `createHeadline`. |
| `/api/images/[...key]` | GET | Proxies a MinIO object by key. Public, unauthenticated (by design — published photos are public content). |

Both mutating routes live under `/admin/*` specifically so one Cloudflare Access app + one middleware matcher covers them — see `docs/archive/admin-security.md`. Keep that invariant for anything added below: **new mutating routes go under `/admin/api/...`, not `/api/...`.**

## Gaps worth closing

### 1. No unpublish / undo — shipped

`unpublishHeadline` (`web/src/lib/db.ts`) + `/admin/api/headlines/[id]/unpublish` flip a `published` row back to `draft` and clear `published_at`. `/admin` now renders a capped "Recently published" section (`getRecentPublishedHeadlines`, last 20) alongside the drafts list, with an Unpublish button per row in `DraftCard.svelte`. One caveat found during verification: publish/unpublish both do a full `location.reload()` on success rather than an optimistic DOM removal, because the row needs to move *between* the two server-rendered sections — an in-place removal would just make the card vanish with no indication it reappeared in the other list. Save (in-place edit) and discard (pure removal) stay optimistic; only publish/unpublish reload.

### 2. No delete / discard — shipped

`discardHeadline` (`web/src/lib/db.ts`) + `/admin/api/headlines/[id]/discard` do exactly the soft-delete this section recommended: `status = 'discarded'`, guarded by `status != 'discarded'` so it's idempotent, callable from either `draft` or `published` (a bad headline doesn't need to be unpublished first). `db/schema.sql`'s `headlines_status_check` CHECK constraint was widened to allow it, with an idempotent `ALTER TABLE ... DROP/ADD CONSTRAINT` migration below the `CREATE TABLE IF NOT EXISTS` so it also applies to the already-initialized production DB (re-run `schema.sql` by hand — see `docs/production-verification.md`). Both `getPublishedHeadlines` and `getDraftHeadlines`'s status filters already exclude `discarded` rows without any query change, since they filter on exact status rather than `!= 'published'`/`!= 'draft'`.

### 2b. Create-from-scratch — shipped

`createHeadline` + `/admin/api/headlines/create` insert a hand-written `draft` row directly — a collapsible `<details>` form at the top of `/admin` (plain form POST, not a Svelte island — this is a low-frequency action, so the "optimistic, no reload" treatment given to inline editing wasn't worth the added complexity here). Goes through the same review/publish flow as a generated draft; `player_ids` defaults to an empty array since there's no generation step to populate it.

### 3. Orphaned MinIO images

Nothing cleans up a stored image when an admin edit replaces `photo_ref` with a different key, or blanks it outright. MinIO will accumulate objects with no `headlines` row pointing at them. Discarding a row (item 2, now shipped) does *not* itself orphan an image — `discardHeadline` only flips `status`, it doesn't touch `photo_ref`, so the reference to the stored object survives on the now-hidden row. Not urgent at current volume (a few drafts/day), but worth a plan before it's a "why is the bucket 4GB" surprise:
- Simplest fix: a scheduled Railway job (or a step tacked onto `bluejays-ingest`'s run) that lists MinIO keys, diffs against `SELECT DISTINCT photo_ref FROM headlines WHERE photo_ref IS NOT NULL` (this correctly still counts discarded rows' photos as referenced, matching the point above), and deletes anything not referenced and older than some grace period (a few days, so mid-edit races don't delete something about to be re-referenced).

### 4. Health checks

Railway can health-check a service, but nothing in `web` or `handles` exposes a dedicated endpoint — Railway would be hitting `/` (which now does a real DB query via `getPublishedHeadlines`) as its liveness signal, which means a slow/hung DB pool shows up as the *public feed* looking down, not a clean health-check failure. Add a trivial `/healthz` route in `web` (checks `pool.query('SELECT 1')`, nothing else) and point Railway's health check at that instead of `/`. `handles` doesn't hit any external dependency per-request (it's an in-memory map + async GitHub calls), so `/` is already a fine health check there.

### 5. `ingest` has no retry/backoff on external fetch failures

`claude.js` has a specific, well-reasoned retry for the temperature-param 400 (see the archived ingestion-pipeline doc). Nothing equivalent exists for a Reddit/Bluesky/FAX-fetch transient failure (`reddit.js`, `bluesky.js`, `fax.js`) — a single failed `fetch` currently either throws (killing the whole run, including the unrelated register-2 draft that didn't need that source) or is swallowed silently depending on the call site. Worth an audit pass: each fetch source failing should degrade gracefully (log + return an empty list, same as "no new candidate posts" already does) rather than take down the run, since register 2 doesn't need Reddit/Bluesky at all and shouldn't fail because of them.

### 6. Handles: JSON file + GitHub PR, not Postgres — a decision to *make*, not a bug to fix

`SPEC.md` says "DID stored in Postgres (same `bluejays-db` instance as the headlines table)." What's actually built (`handles/handles.go`, `handles/add-handle.go`) is meaningfully different and, arguably, better for a low-volume single-operator site: a submitted request opens a **GitHub PR** against `handles.json` (with rate limiting, dupe-DID warnings, and an async job-status spinner on the request page) rather than writing straight to a DB. Merging the PR *is* the human review gate — same philosophy as "no autonomous publishing" for headlines, just implemented as git review instead of an admin UI.

This needs an explicit decision, not silent drift from the spec:
- **Keep the PR-flow design** (recommended, given it already ships, works, and gives a free audit trail + rollback via git history) and update `SPEC.md`'s Handle Directory section to describe reality instead of the original Postgres plan. Downsides to accept: `handles.json` lives in the same repo as the code, so a handle request requires `GITHUB_TOKEN` write access to this repo, and every deploy of `handles` re-reads the file at boot — no live update without a redeploy or Railway's git-based auto-redeploy on merge (confirm this is actually wired up — note the answer in `docs/production-verification.md`).
- **Or migrate to Postgres** as the spec originally called for, dropping the GitHub-PR mechanic entirely in favor of a `/admin`-reviewed queue matching the headlines flow (a `handle_requests` table with the same draft/approved shape). This is a bigger lift than it looks: loses the git-audit-trail property, needs its own admin UI section, and duplicates the Cloudflare Access gating work for a second surface.

Whichever way this goes, `README.md`'s line "once its DID storage moves off `handles.json`" (in the Production section) should be resolved one way or the other rather than left as a standing "eventually" — it currently implies the migration is assumed, which may not be the right call given how well the PR flow works.

### 7. No pagination / filtering on `getPublishedHeadlines` or `getDraftHeadlines`

Both currently `SELECT *` with no `LIMIT`. Fine at today's volume; becomes a real problem once ingest has been running for months (one register-2 + occasionally one register-1 draft per cron tick, times however many ticks/day, accumulates fast on the admin side even after publish/discard workflows exist). See `docs/frontend-roadmap.md` for the public-feed side of this — the DB query and the page rendering it should be sized together, not as two separate problems.

## Out of scope here

- A general-purpose CRUD framework or ORM — two/three tables, per `docs/README.md`'s existing "don't introduce one" call. Everything above is additive routes against the existing `pg` client, not a rearchitecture.
- Multi-operator roles/permissions on `/admin` — still single-operator (`docs/archive/admin-security.md`'s call stands).
