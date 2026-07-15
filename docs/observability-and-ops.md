# Observability & ops — running this for real, not just standing it up

The three services are live on Railway (see `docs/production-verification.md` for the reference config). This doc is about what happens *day-to-day after that* — a scheduled cron job (`bluejays-ingest`) with no human watching it in real time is exactly the kind of thing that fails silently for weeks unless something is watching it, and this repo doesn't have that yet.

## 1. Ingest run visibility

`bluejays-ingest` runs on a schedule, does its work, and exits (`docs/README.md` / `SPEC.md` Architecture). Right now the only record of a run succeeding or failing is Railway's own build/run logs — nobody gets told if:
- A run throws before inserting any drafts (e.g. `DATABASE_URL` unreachable, or an uncaught error in `runRealGeneration`) — `main()`'s `.catch()` sets `process.exitCode = 1` and logs to stderr, which Railway will show in its dashboard, but nothing pushes that failure anywhere a person would actually see it.
- A run "succeeds" but silently degrades — e.g. Reddit/Bluesky both fail to fetch (see `docs/backend-api-plan.md` item 5) and every run quietly becomes register-2-only for weeks.
- The cron trigger itself stops firing (Railway outage, a misconfigured schedule after an edit) — nothing notices the *absence* of runs, only failures of runs that did fire.

Cheapest fix that doesn't require standing up a monitoring stack for a single-operator site: have `main()` POST a one-line summary (rows inserted, per-register counts, any source that returned zero candidates) to a webhook — a Slack incoming webhook or a Discord webhook are both a single `fetch` call, no new dependency. Land this as its own small change once ingest has run for real in production for a bit and there's a sense of what's actually worth alerting on, rather than guessing upfront.

## 2. Postgres backups

Railway's managed Postgres plugin has its own backup story (check current Railway docs at deploy time — this moves), but nothing in this repo documents whether it's enabled, what the retention window is, or how to restore. Given the `headlines` table is the entire content of the site, this is worth nailing down explicitly (check the Railway dashboard directly, and note the answer in `docs/production-verification.md`) rather than assuming Railway's defaults are sufficient without checking. (`handles`' DID mappings live in `handles.json`, not Postgres — see `docs/backend-api-plan.md` item 6 — so its durability story is git history, not this backup plugin.)

## 3. MinIO image lifecycle

Covered in `docs/backend-api-plan.md` item 3 (orphan cleanup) — the ops side of that is just: whatever cleanup job gets built there needs monitoring too (did it run, how many objects did it delete, did deletion ever hit something a `photo_ref` still pointed at because of a race). Don't build the monitoring before the cleanup job itself exists.

## 4. Secrets rotation

No documented rotation cadence for anything in `.env.example` — `GITHUB_TOKEN` (fine-grained PAT, has an expiry date set at creation and will silently start failing handle-request PRs once it lapses), `ANTHROPIC_API_KEY`, `BLUESKY_APP_PASSWORD`, MinIO credentials. At minimum: set the `GITHUB_TOKEN`'s expiry to something long enough not to be a surprise, and note the expiry date somewhere a future maintainer (including future-you) will actually see it — a calendar reminder is more realistic than expecting anyone to remember to check a fine-grained PAT's expiry proactively.

## 5. Cost visibility

`SPEC.md` calls out LLM cost as a risk, mitigated by "default model is cheap" + human review capping volume. Worth actually checking Anthropic Console usage after the first couple weeks of real (non-stub) ingest runs against `GENERATION_MODEL=claude-haiku-4-5`, since the MCP-connector round-trip (register 2, when `MLB_MCP_URL` is set) does multiple tool calls per generation and the token cost of that loop hasn't been measured against a real run yet — the `docs/archive/ingestion-pipeline.md` note about a ~10-minute first real MCP round-trip is a latency data point, not a cost one.

## Out of scope here

- A full metrics/dashboarding stack (Grafana, Datadog, etc.) — disproportionate for a single-operator site at this traffic level. Revisit only if operating pain actually shows up.
- On-call/paging — no SLA to page against; a webhook notification (item 1) is the right ceiling for this project's scale.
