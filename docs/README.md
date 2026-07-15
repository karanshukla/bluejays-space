# bluejays.space — follow-up work

Planning docs for what's left after the MVP. Each doc is a spec for one area — read the relevant one before starting that work, since they carry the concrete decisions (env vars, field names, request shapes, deploy steps) rather than just a task list.

These docs assume you've already read [`../SPEC.md`](../SPEC.md) — the canonical product spec. This directory is the *implementation* roadmap derived from it, not a replacement for it.

## MVP status: shipped

The three areas this directory used to track as the roadmap are done and now live under [`archive/`](./archive/):

- **[archive/ingestion-pipeline.md](./archive/ingestion-pipeline.md)** — real generation flow (Reddit/Bluesky/FAX fetch, MLB Stats via the mlb-api-mcp MCP connector, two-register Claude generation, image download into MinIO). `ingest/src/index.js` runs this whenever `ANTHROPIC_API_KEY` is set.
- **[archive/admin-security.md](./archive/admin-security.md)** — `/admin` gated by Cloudflare Access, with in-app JWT verification (`web/src/middleware.ts`) as defense-in-depth against the Railway fallback domain. The Cloudflare-side Access application itself still needs to be created against a live production domain — tracked in `launch-checklist.md`, not here.
- **[archive/ui-plan.md](./archive/ui-plan.md)** — the admin inline-edit Svelte island, self-hosted display font, real alt text on public photos. A few visual/a11y items from this doc are still open — carried forward into `frontend-roadmap.md` rather than left stranded in the archive.

Each archived doc has a banner at the top pointing at the actual shipped code, and at whichever new doc picks up its remaining open items.

## Roadmap, roughly in priority order

1. **[launch-checklist.md](./launch-checklist.md)** — the actual "make it live" checklist: Railway service order, schema application against production Postgres (no migration runner yet), the Cloudflare Access application setup, a post-deploy smoke test, and the secrets that fail *silently* if left blank. Do this before anything else below matters — there's no point polishing a feed nobody can reach yet.
2. **[backend-api-plan.md](./backend-api-plan.md)** — CRUD gaps against the `headlines` table (no unpublish, no discard, no image cleanup for orphaned MinIO objects), a health-check endpoint, hardening `ingest`'s external fetches against transient failures, and — the one real open *decision*, not just a gap — whether the handles service's JSON-file + GitHub-PR flow (which shipped, and works well) should stay as-is or migrate to the Postgres design `SPEC.md` originally called for.
3. **[frontend-roadmap.md](./frontend-roadmap.md)** — the biggest product gap: no per-headline permalinks, no Open Graph/social preview cards, no RSS, no sitemap — meaning there's currently no way to actually *share* an individual headline, which is the whole point of a FAX-Sports-style site. Also covers feed pagination and the visual/a11y items `ui-plan.md` left open.
4. **[observability-and-ops.md](./observability-and-ops.md)** — running the scheduled `ingest` cron without anyone watching it is a silent-failure risk; covers run-visibility, Postgres backup verification, secrets rotation, and cost-checking the MCP-connector generation path against real usage.
5. **[testing-strategy.md](./testing-strategy.md)** — solid unit coverage exists; the gaps are at the seams (an E2E admin-flow test, an integration test of the real Claude/MCP generation call, a test of the Cloudflare Access middleware's actual request handling rather than just its JWT-verification logic in isolation).

## Cross-cutting decisions already made (don't relitigate)

- **Object storage**: self-hosted MinIO (S3-compatible), not Cloudflare R2 — see [README.md](../README.md#production-railway). `ingest` writes, `web` proxies reads at `/api/images/*`; MinIO gets no public domain.
- **Runtime/package manager**: staying on Node + npm for `web` (Astro's officially-supported adapter). `ingest` is a good candidate to move to Bun for faster cold starts on each cron invocation — not done yet, small follow-up, not a blocker.
- **DB access**: plain `pg` (node-postgres), no ORM. Revisit only if the schema grows past a couple of ad-hoc `ALTER`s post-launch (see `launch-checklist.md` → Schema application) — it's at three tables now (`handles`, `headlines`, `seen_posts`), still not there yet.
- **Quality tooling**: Prettier + oxlint + per-service test runners (Vitest for `web`, `node --test` for `ingest`, Go `testing` for `handles`) + a root `husky` pre-commit hook + a consolidated `ci.yml` (lint/typecheck/test/build per service, plus a `docker-build` job) — see [README.md](../README.md#quality--ci).
- **Handles service architecture**: JSON file + GitHub-PR review flow, not a live DB write — this shipped as a deliberate design, not a stub. Whether it stays that way is the one open decision, tracked in `backend-api-plan.md` item 6, not something to silently "fix" toward the original spec.

## Not planned here

- Instagram, native mobile app, user accounts/voting — explicitly out of scope per `SPEC.md` → Out of Scope (v1).
- Vision-model meme classification, AI-generated player images — hard "never" per `SPEC.md` (see also `CLAUDE.md` → Non-negotiable), not just deferred.
