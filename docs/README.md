# bluejays.space — follow-up work

Planning docs for what's left after the MVP. Each doc is a spec for one area — read the relevant one before starting that work, since they carry the concrete decisions (env vars, field names, request shapes, deploy steps) rather than just a task list.

These docs assume you've already read [`../SPEC.md`](../SPEC.md) — the canonical product spec. This directory is the *implementation* roadmap derived from it, not a replacement for it.

## MVP status: shipped

The three areas this directory used to track as the roadmap are done and now live under [`archive/`](./archive/):

- **[archive/ingestion-pipeline.md](./archive/ingestion-pipeline.md)** — the original generation flow (Reddit/Bluesky/FAX fetch, MLB Stats via the mlb-api-mcp MCP connector, two-register Claude generation, image download into MinIO). **Superseded** — `ingest/` is now a draft *classifier* (assigns a topic category + safety verdict to existing drafts via Claude, text + image; auto-discards illegal/doxxing content). Kept as historical context for why the now-deleted fetch/MCP/generation code looked the way it did.
- **[archive/admin-security.md](./archive/admin-security.md)** — `/admin` gated by Cloudflare Access, with in-app JWT verification (`web/src/middleware.ts`) as defense-in-depth against the Railway fallback domain. The site is live on Railway with this wired up — see `production-verification.md` for the reference config if something needs checking.
- **[archive/ui-plan.md](./archive/ui-plan.md)** — the admin inline-edit Svelte island, self-hosted display font, real alt text on public photos. A few visual/a11y items from this doc are still open — carried forward into `frontend-roadmap.md` rather than left stranded in the archive.

Each archived doc has a banner at the top pointing at the actual shipped code, and at whichever new doc picks up its remaining open items.

## Roadmap, roughly in priority order

**The site is deployed and live on Railway.** Infra/launch work is done — the priority now is application code: closing product/feature gaps, and getting the codebase to the same level of finish as a mature reference project (see "Benchmark: what 'complete' looks like" in `testing-strategy.md`, modeled on `karanshukla/navyfragen-app`).

1. **[frontend-roadmap.md](./frontend-roadmap.md)** — the entire sharing/discovery section (§ 1) shipped: permalinks (`/h/{id}`), OG/Twitter meta tags, the dynamic per-headline OG image (Satori+resvg, MinIO-cached), RSS feed, sitemap, `robots.txt`, `SITE_URL` config, and favicon are all live. Also covers feed pagination (decided: `?page=N`, 30/page, still open) and the visual/a11y items `ui-plan.md` left open.
2. **[backend-api-plan.md](./backend-api-plan.md)** — unpublish, discard, and create-from-scratch on the `headlines` table have since shipped (see items 1, 2, 2b); what's left is image cleanup for orphaned MinIO objects, a health-check endpoint, and hardening `ingest`'s external fetches against transient failures. Item 6 (handles: JSON+GitHub-PR vs. Postgres) is now decided — keeping the shipped JSON+PR design, `SPEC.md` updated to match — not an open item anymore.
3. **[testing-strategy.md](./testing-strategy.md)** — solid unit coverage exists; the gaps are at the seams (an E2E admin-flow test, an integration test of the real Claude classification call, a test of the Cloudflare Access middleware's actual request handling) and, more broadly, at the bar a "complete" repo should hit — enforced coverage thresholds, an E2E suite, README polish — see the benchmark section against `navyfragen-app`.
4. **[observability-and-ops.md](./observability-and-ops.md)** — running the scheduled `ingest` cron without anyone watching it is a silent-failure risk; covers run-visibility, Postgres backup verification, secrets rotation, and cost-checking the classifier's Claude usage against real usage.
5. **[production-verification.md](./production-verification.md)** — reference material, not active work: how the live Railway/Cloudflare setup is supposed to be wired, for checking against the real dashboards if something in prod seems off.

## Cross-cutting decisions already made (don't relitigate)

- **Object storage**: self-hosted MinIO (S3-compatible), not Cloudflare R2 — see [README.md](../README.md#production-railway). `ingest` writes, `web` proxies reads at `/api/images/*`; MinIO gets no public domain.
- **Runtime/package manager**: staying on Node + npm for `web` (Astro's officially-supported adapter). `ingest` is a good candidate to move to Bun for faster cold starts on each cron invocation — not done yet, small follow-up, not a blocker.
- **DB access**: plain `pg` (node-postgres), no ORM. Revisit only if the schema grows past a couple of ad-hoc `ALTER`s (see `production-verification.md` → Schema application) — it's at three tables now (`handles`, `headlines`, `seen_posts`), still not there yet.
- **Quality tooling**: Prettier + oxlint + per-service test runners (Vitest for `web`, `node --test` for `ingest`, Go `testing` for `handles`) + a root `husky` pre-commit hook + a consolidated `ci.yml` (lint/typecheck/test/build per service, plus a `docker-build` job) — see [README.md](../README.md#quality--ci).
- **Handles service architecture**: JSON file + GitHub-PR review flow, not a live DB write — decided as final (see `backend-api-plan.md` item 6 and `SPEC.md` → Handle Directory). Don't "fix" it toward Postgres without a new explicit decision.

## Not planned here

- Instagram, native mobile app, user accounts/voting — explicitly out of scope per `SPEC.md` → Out of Scope (v1).
- Vision-model meme classification, AI-generated player images — hard "never" per `SPEC.md` (see also `CLAUDE.md` → Non-negotiable), not just deferred.
