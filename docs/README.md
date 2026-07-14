# bluejays.space — follow-up work

Planning docs for what's left after the initial scaffolding (Postgres-backed feed/admin, MinIO image storage, handles link). Each doc is a spec for one area — read the relevant one before starting that work, since they carry the concrete decisions (env vars, field names, request shapes) rather than just a task list.

These docs assume you've already read [`../SPEC.md`](../SPEC.md) — the canonical product spec. This directory is the *implementation* roadmap derived from it, not a replacement for it.

## Roadmap, roughly in build order

1. **[ingestion-pipeline.md](./ingestion-pipeline.md)** — the real generation flow: MLB Stats via the mlb-api-mcp server (using Claude's MCP connector, not a hand-rolled client), Reddit + Bluesky fetch, FAX Sports style reference, the two-register Claude generation call, image download into MinIO. This is the biggest remaining piece — everything in `ingest/src/index.js` today is a stub.
2. **[admin-security.md](./admin-security.md)** — gating `/admin` behind Cloudflare Access. Currently wide open; must land before any real drafts (with real player photos, unpublished jokes) sit in that table.
3. **[ui-plan.md](./ui-plan.md)** — the admin inline-edit island (Svelte/React), card feed visual polish, WCAG pass, mobile testing. The plain-form admin UI works but isn't the final shape per spec.

## Cross-cutting decisions already made (don't relitigate)

- **Object storage**: self-hosted MinIO (S3-compatible), not Cloudflare R2 — see [README.md](../README.md#production-railway). `ingest` writes, `web` proxies reads at `/api/images/*`; MinIO gets no public domain.
- **Runtime/package manager**: staying on Node + npm for `web` (Astro's officially-supported adapter). `ingest` is a good candidate to move to Bun for faster cold starts on each cron invocation — not done yet, flagged as a small follow-up in ingestion-pipeline.md, not a blocker.
- **DB access**: plain `pg` (node-postgres), no ORM. Keep it that way unless the schema grows enough to justify one — it hasn't yet (two tables).
- **Quality tooling**: Prettier + oxlint + per-service test runners (Vitest for `web`, `node --test` for `ingest`, Go `testing` for `handles`) + a root `husky` pre-commit hook + a consolidated `ci.yml` (lint/typecheck/test/build per service, plus a `docker-build` job) — see [README.md](../README.md#quality--ci). Matches the tooling pattern used across the author's other repos, checked directly against them rather than invented from scratch.

## Not planned here

- Instagram, native mobile app, user accounts/voting — explicitly out of scope per `SPEC.md` → Out of Scope (v1).
- Vision-model meme classification, AI-generated player images — hard "never" per `SPEC.md` (see also `CLAUDE.md` → Non-negotiable), not just deferred.
