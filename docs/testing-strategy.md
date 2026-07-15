# Testing follow-up — coverage gaps beyond the existing unit tests

Current state (see `CLAUDE.md` → Quality gates): Vitest for `web` (`web/src/lib/*.test.ts`), `node --test` for `ingest` (`ingest/src/*.test.js`, one per fetch/generation module), Go's `testing` for `handles` (`handles/handles_test.go`). All wired into CI (`.github/workflows/ci.yml`). This is solid unit coverage of pure logic (URL parsing, schema shapes, JWT verification against a locally-generated JWKS, handle validation). What's missing is coverage of the *integrations between* those units — the stuff that only breaks when the pieces are wired together.

## 1. No end-to-end test of the admin flow

Nothing drives an actual browser against `/admin`: load the page, edit a draft via `DraftCard.svelte`, hit save, confirm the DB row changed, hit publish, confirm it now appears on `/`. This is exactly the kind of flow that unit tests can't catch a regression in — e.g. the island's `fetch` call target drifting out of sync with the route path after a refactor, or a Svelte 5 runes API change silently breaking reactivity. This environment has Playwright pre-configured (see the `run` skill / environment notes) — worth a small `web/e2e/admin.spec.ts` covering: load `/admin` with a seeded draft row, edit the headline field, save, assert the API call succeeded, publish, assert the card disappears from the list. Needs a way to seed/reset a test DB row without depending on real ingest output — a small test-only insert helper, or point Playwright at a docker-compose Postgres seeded via `db/schema.sql` plus a fixture row.

## 2. No integration test of the real generation path

`ingest/src/claude.test.js` (check current test file for what it actually covers) tests the pure functions (`buildSystemPrompt`, `buildUserMessage`, `parseHeadlineResponse`, `isTemperatureError`) but nothing exercises `generateHeadline` against a real (or recorded) Anthropic API response — meaning the MCP-connector wiring (`mcp_toolset.mcp_server_name`, the `betas` array, the temperature-retry branch) is only actually verified by the comments in `claude.js` referencing "confirmed against a live 400," i.e. by hand, once, during development. Two options, not mutually exclusive:
- **Record/replay**: capture one real response (with secrets scrubbed) from each of the "with MCP" and "without MCP" call shapes, replay them in a test via a mocked `fetch`/SDK client, to at least pin the response-parsing path (`toolUseBlocks`/`toolResultBlocks` extraction, `parseHeadlineResponse`) against a real shape rather than a hand-constructed fixture.
- **A manual smoke-run checklist**: cheaper, and probably the right near-term answer — a documented "run `docker compose run --rm ingest` with real `ANTHROPIC_API_KEY`/`MLB_MCP_URL` set, confirm a non-stub draft with a populated `stat_block` appears" step, run once per meaningful change to `claude.js` or before any `GENERATION_MODEL` swap (since that's specifically what the temperature-retry branch exists to survive — see `docs/archive/ingestion-pipeline.md`).

## 3. No test of the Cloudflare Access bypass scenario

`cfAccess.test.ts` covers JWT verification logic in isolation. Nothing tests the actual `middleware.ts` behavior end-to-end: a request to `/admin` with no `Cf-Access-Jwt-Assertion` header gets a 403, a request to `/` (unprotected) passes through regardless, a request to `/admin/api/headlines/1/publish` (a nested mutating route) is covered by the same regex as `/admin` itself. This is a security boundary — worth a small integration test (spin up the Astro app, hit a few paths with/without a valid token, assert status codes) rather than trusting the regex is right by inspection. Low effort relative to how bad the failure mode is if the matcher regex ever regresses.

## 4. Docker Compose smoke test isn't automated

CI's `docker-build` job builds each production Dockerfile but never runs the resulting containers together — it catches "the image builds" but not "the services can actually talk to each other" (a `DATABASE_URL` format Railway accepts but the compose setup doesn't, for instance, or vice versa). A `docker compose up -d && curl` smoke check as a CI job (bring up `db` + `minio` + `web`, curl `/`, expect 200) would close this gap cheaply — no `ingest`/`handles` needed for the smoke check since `web` is the one thing that has to serve traffic.

## Out of scope here

- Load/perf testing — not warranted before there's real production traffic to measure against; revisit if `docs/frontend-roadmap.md`'s pagination work lands and there's a reason to suspect the query patterns won't scale.
- Visual regression testing (Percy/Chromatic-style) — disproportionate tooling for a three-page site; a manual pass per `docs/frontend-roadmap.md` item 4 is the right ceiling for now.
