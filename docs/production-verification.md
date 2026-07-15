# Production configuration — Railway + Cloudflare reference

**The site is live on Railway.** This doc is no longer a "how to launch" checklist — it's a reference for how the production setup is *supposed* to be wired (derived from `README.md` → Production (Railway) and `SPEC.md` → Architecture), worth checking against the real Railway/Cloudflare dashboards any time something in prod seems off, a new service gets added, or a secret needs rotating. With deployment done, the actual priority is application code — see `docs/README.md` → Roadmap; this doc is reference material, not the current focus.

## Order of operations (reference — services are already live in this order)

1. **Postgres** — Railway managed Postgres plugin. Grab its private `DATABASE_URL` (used by `web` and `ingest` only — `handles` doesn't touch it yet, see `docs/backend-api-plan.md` for why). Run `db/schema.sql` against it once (there's no migration runner — see "Schema application" below).
2. **MinIO** — deploy from the `minio/minio` image directly (Railway "Deploy from Docker Image", not a repo subfolder). Attach a volume for `/data`. Set `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` to real (non-`bluejays-dev-only`) values. **Do not give it a public domain** — `web`'s `/api/images/*` proxy is the only intended public path to its contents.
3. **`mlb-api-mcp`** — deploy the [karanshukla fork](https://github.com/karanshukla/mlb-api-mcp) as its own Railway service with a **public** domain (see `docs/archive/ingestion-pipeline.md` for why this one can't be private-networked — the MCP connector call is made by Anthropic's infrastructure, not by `ingest`). If it's already deployed from earlier work, just confirm the URL is still live and reuse it; don't stand up a second instance.
4. **`bluejays-handles`** — deploy from `handles/`, root directory set to `handles/` in Railway. Set `GITHUB_TOKEN` (fine-grained PAT, Contents: Read/Write + Pull requests: Write on this repo only — see `handles/README.md`), `BASE_DOMAIN=bluejays.space`. Point the wildcard `*.bluejays.space` CNAME at it.
5. **`bluejays-web`** — deploy from `web/`, root directory `web/`. Needs `DATABASE_URL` (private ref to step 1), `S3_ENDPOINT` (private ref to step 2, `http://<minio-service>.railway.internal:9000`), `S3_BUCKET`, MinIO credentials, and `CF_ACCESS_TEAM`/`CF_ACCESS_AUD` (from step 7 — deploy once without them to get a URL, then redeploy once the Access app exists). Point the apex `bluejays.space` at it.
6. **`bluejays-ingest`** — deploy from `ingest/`, root directory `ingest/`, as a **Railway cron trigger** (not always-on) — pick a schedule matching the spec's "every 4-6h" cadence. Needs `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GENERATION_MODEL`, `REDDIT_CLIENT_ID`/`SECRET`, `BLUESKY_IDENTIFIER`/`APP_PASSWORD`, `S3_*`, `MLB_MCP_URL` (public URL from step 3), `MLB_MCP_AUTH_TOKEN` if that deployment is gated.
7. **Cloudflare**: proxy `bluejays.space` (orange-cloud) through Cloudflare, pointed at `bluejays-web`'s Railway domain. In Zero Trust → Access → Applications, create an app scoped to `bluejays.space/admin*` with an email-allowlist policy (see `docs/archive/admin-security.md`). Grab the Application Audience (AUD) tag and the team name, feed them back into `bluejays-web` as `CF_ACCESS_TEAM`/`CF_ACCESS_AUD`, redeploy.
8. **Disable or ignore `bluejays-web`'s Railway-generated fallback domain** (`*.up.railway.app`) once the custom domain is confirmed working — or confirm the in-app JWT check (`web/src/middleware.ts`) is actually enforced (`CF_ACCESS_TEAM`/`CF_ACCESS_AUD` both set) so that fallback domain isn't a bypass. This is the one item from `docs/archive/admin-security.md` that's easy to forget because nothing in CI catches it.

## Schema application — no migration runner yet

`db/schema.sql` is auto-loaded by Postgres only on **first volume init** via `docker-entrypoint-initdb.d` locally — that mechanism doesn't exist against a Railway-managed Postgres plugin. Before `web`/`ingest` can do anything useful in production, and after *every* future change to `db/schema.sql`, it needs to be run by hand against the production DB. Two ways to do that against Railway specifically:

- **Dashboard**: open the Postgres service → **Data** tab → paste `db/schema.sql`'s contents into the query editor → run.
- **CLI**: `railway link` (once, picks the project) then `railway connect postgres` opens an interactive `psql` session over Railway's network with no public exposure needed; paste the file's contents or `\i db/schema.sql` if your shell's cwd is the repo root.

It's idempotent (`CREATE TABLE IF NOT EXISTS`, and any `ALTER` in the file drops-then-recreates the constraint it's touching) so re-running the whole file is always safe — but there's no tracking of *which* statements have already run against a given environment, so a genuine migration (a new `ALTER TABLE`, a backfill) still needs to be written by hand and the file re-applied in full, same as today. **A missing migration fails loudly and specifically**: a query touching the changed column throws a Postgres `violates check constraint`/`column does not exist` error, which an unguarded API route (all of them, today — see `docs/backend-api-plan.md`) surfaces as a bare 500. If a route starts 500ing right after a schema-touching PR merges, check this before anything else. If the schema grows past a couple of ad-hoc `ALTER`s, revisit the "no ORM/migration tool" decision in `docs/README.md` — it was made when there were two tables; there are three now (`seen_posts` since shipped).

## Smoke test — worth re-running after any prod-affecting change

Not a full test suite — just enough to confirm the pieces are still wired correctly, since nothing in CI exercises the actual Railway network. Re-run this after touching any env var, redeploying a service, or rotating a secret — not just once at launch:

- [ ] `bluejays.space/` loads and shows "No headlines published yet" (or real content, if ingest has already run)
- [ ] `bluejays.space/admin` prompts a Cloudflare Access login; a non-allowlisted email is rejected
- [ ] The Railway-generated fallback domain for `bluejays-web`, hit directly, either 404s (domain disabled) or the admin path still 403s without a valid JWT
- [ ] Trigger `bluejays-ingest` manually once (Railway lets you run a cron job on demand) and confirm a draft row appears in `/admin` with a real (non-stub) headline and a stored `photo_ref` if register 1 credited an image
- [ ] `alice.bluejays.space/.well-known/atproto-did` (any handle already in `handles.json`) returns the DID as plain text
- [ ] Publish one draft from `/admin`, confirm it appears on `/`

## Secrets checklist (confirm these stay set, not blank, across redeploys)

`ANTHROPIC_API_KEY`, `REDDIT_CLIENT_ID`/`SECRET`, `BLUESKY_IDENTIFIER`/`APP_PASSWORD`, `GITHUB_TOKEN` (handles), MinIO credentials (non-default), `CF_ACCESS_TEAM`/`CF_ACCESS_AUD`. `.env.example` documents every one of these; treat a blank value in the Railway dashboard the same as a missing one — several of them (`GITHUB_TOKEN`, `CF_ACCESS_*`) fail *open* to a degraded-but-running state (handle requests silently disabled, admin auth silently skipped) rather than a startup crash, which makes them easy to forget.

## Out of scope here

- Custom domain / DNS purchase — assumed already owned, per the existing README references to `bluejays.space`.
- Load testing / scaling beyond a single Railway instance per service — not warranted at launch traffic.
