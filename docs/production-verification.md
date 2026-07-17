# Production configuration — Railway + Cloudflare reference

**The site is live on Railway.** This doc is no longer a "how to launch" checklist — it's a reference for how the production setup is *supposed* to be wired (derived from `README.md` → Production (Railway) and `SPEC.md` → Architecture), worth checking against the real Railway/Cloudflare dashboards any time something in prod seems off, a new service gets added, or a secret needs rotating. With deployment done, the actual priority is application code — see `docs/README.md` → Roadmap; this doc is reference material, not the current focus.

## Order of operations (reference — services are already live in this order)

1. **Postgres** — Railway managed Postgres plugin. Grab its private `DATABASE_URL` (used by `web` and `classify` only — `handles`' DID storage stays on `handles.json` + GitHub-PR review, a final decision, not a stub; see `docs/backend-api-plan.md` item 6 for why). Schema is applied automatically by `bluejays-web` on every boot — see "Schema application" below, nothing to do here by hand.
2. **MinIO** — deploy from the `minio/minio` image directly (Railway "Deploy from Docker Image", not a repo subfolder). Attach a volume for `/data`. Set `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` to real (non-`bluejays-dev-only`) values. **Do not give it a public domain** — `web`'s `/api/images/*` proxy is the only intended public path to its contents.
3. **`mlb-api-mcp`** — deploy the [karanshukla fork](https://github.com/karanshukla/mlb-api-mcp) as its own Railway service with a **public** domain (see `docs/archive/ingestion-pipeline.md` for why this one can't be private-networked — the MCP connector call is made by Anthropic's infrastructure, not by `classify`). If it's already deployed from earlier work, just confirm the URL is still live and reuse it; don't stand up a second instance.
4. **`bluejays-handles`** — deploy from `handles/`, root directory set to `handles/` in Railway. Set `GITHUB_TOKEN` (fine-grained PAT, Contents: Read/Write + Pull requests: Write on this repo only — see `handles/README.md`), `BASE_DOMAIN=bluejays.space`. Point the wildcard `*.bluejays.space` CNAME at it.
5. **`bluejays-web`** — deploy from `web/`, root directory `web/`. Needs `DATABASE_URL` (private ref to step 1), `S3_ENDPOINT` (private ref to step 2, `http://<minio-service>.railway.internal:9000`), `S3_BUCKET`, MinIO credentials, and `CF_ACCESS_TEAM`/`CF_ACCESS_AUD` (from step 7 — deploy once without them to get a URL, then redeploy once the Access app exists). Point the apex `bluejays.space` at it.
6. **`bluejays-classify`** — deploy from `classify/`, root directory `classify/`, as a **Railway cron trigger** (not always-on). The job classifies unclassified draft headlines (text + image via Claude vision) and writes the verdict back; pick a cadence matching how often new drafts land. Needs `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLASSIFIER_MODEL`, `S3_*` (to read attached photos). The social fetchers / FAX ref / `mlb-api-mcp` connector the old generator needed are gone — no `REDDIT_*`, `BLUESKY_*`, or `MLB_MCP_*` required anymore.
7. **Cloudflare**: proxy `bluejays.space` (orange-cloud) through Cloudflare, pointed at `bluejays-web`'s Railway domain. In Zero Trust → Access → Applications, create an app scoped to `bluejays.space/admin*` with an email-allowlist policy (see `docs/archive/admin-security.md`). Grab the Application Audience (AUD) tag and the team name, feed them back into `bluejays-web` as `CF_ACCESS_TEAM`/`CF_ACCESS_AUD`, redeploy.
8. **Disable or ignore `bluejays-web`'s Railway-generated fallback domain** (`*.up.railway.app`) once the custom domain is confirmed working — or confirm the in-app JWT check (`web/src/middleware.ts`) is actually enforced (`CF_ACCESS_TEAM`/`CF_ACCESS_AUD` both set) so that fallback domain isn't a bypass. This is the one item from `docs/archive/admin-security.md` that's easy to forget because nothing in CI catches it.

## Schema application — automatic, as of `web/scripts/migrate.mjs`

`web/db/schema.sql` (moved from the repo-root `db/` — it has to live inside `web/`'s own tree since Railway builds each service from an isolated per-directory context, so a `web`-owned script can't reach a file outside `web/` at build time) is now applied automatically:

- **`bluejays-web`'s Docker image** runs `node scripts/migrate.mjs` before `node dist/server/entry.mjs` on every container start (see the `CMD` in `web/Dockerfile`) — a deploy, restart, or scale event all re-apply the schema, guarded by a Postgres advisory lock so two overlapping instances can't race applying it concurrently.
- **Local dev** (`docker-entrypoint-dev.sh`) does the same before `astro dev` starts, so an existing dev Postgres volume (which only gets Postgres's own first-init `docker-entrypoint-initdb.d` hook once, same limitation Railway always had) picks up schema changes without a `docker compose down -v` reset.

This closes the exact gap that caused the `discard` route's first production 500: a schema change (the `status` CHECK widening for `'discarded'`) had merged into the repo but nothing had applied it to the real database yet. That manual step is gone now — **redeploying `bluejays-web` is enough**, nothing needs to be run by hand against Railway's Postgres separately.

Still true, and worth knowing: the script re-applies the *entire* file every boot (it's written to be idempotent — `CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before re-adding), and doesn't track which statements already ran anywhere. That stops working the day a migration needs to do something that can't be safely repeated on every boot (a data backfill, a destructive rename) — see `docs/backend-api-plan.md`'s roadmap item for adopting a real migration tool (tracked applied-migrations table, forward-only migration files) once that need shows up. If a route still 500s right after a schema-touching PR merges, the first thing to check now is whether `bluejays-web` actually redeployed (and its logs show `[migrate] done`) — not whether someone remembered a manual step.

## Smoke test — worth re-running after any prod-affecting change

Not a full test suite — just enough to confirm the pieces are still wired correctly, since nothing in CI exercises the actual Railway network. Re-run this after touching any env var, redeploying a service, or rotating a secret — not just once at launch:

- [ ] `bluejays.space/` loads and shows "No headlines published yet" (or real content, if classify has already run)
- [ ] `bluejays.space/admin` prompts a Cloudflare Access login; a non-allowlisted email is rejected
- [ ] The Railway-generated fallback domain for `bluejays-web`, hit directly, either 404s (domain disabled) or the admin path still 403s without a valid JWT
- [ ] Trigger `bluejays-classify` manually once (Railway lets you run a cron job on demand): create a draft from `/admin` first, then confirm the run classifies it — the draft's category/safety badges appear in `/admin`, and any blocked draft is auto-discarded
- [ ] `alice.bluejays.space/.well-known/atproto-did` (any handle already in `handles.json`) returns the DID as plain text
- [ ] Publish one draft from `/admin`, confirm it appears on `/`

## Secrets checklist (confirm these stay set, not blank, across redeploys)

`ANTHROPIC_API_KEY`, `REDDIT_CLIENT_ID`/`SECRET`, `BLUESKY_IDENTIFIER`/`APP_PASSWORD`, `GITHUB_TOKEN` (handles), MinIO credentials (non-default), `CF_ACCESS_TEAM`/`CF_ACCESS_AUD`. `.env.example` documents every one of these; treat a blank value in the Railway dashboard the same as a missing one — several of them (`GITHUB_TOKEN`, `CF_ACCESS_*`) fail *open* to a degraded-but-running state (handle requests silently disabled, admin auth silently skipped) rather than a startup crash, which makes them easy to forget.

## Out of scope here

- Custom domain / DNS purchase — assumed already owned, per the existing README references to `bluejays.space`.
- Load testing / scaling beyond a single Railway instance per service — not warranted at launch traffic.
