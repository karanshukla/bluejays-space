# CLAUDE.md

Repo orientation for any coding agent working here (Claude Code, GLM, or otherwise).

## What this is

`bluejays.space` — a parody headline site for Blue Jays fans (FAX Sports style), plus free Bluesky custom-domain handles at `@username.bluejays.space`. Three services: `handles/` (Go), `web/` (Astro SSR), `classify/` (Node cron job), plus Postgres and MinIO.

**Read [`SPEC.md`](./SPEC.md) before making product decisions.** It's the canonical spec — what to build and why, including the safety-critical rules (parody labeling philosophy, no AI-generated player images). `README.md` and `docs/*.md` reference it as "the spec"; they are not a substitute for reading it.

**Read [`docs/README.md`](./docs/README.md) before picking up follow-up work.** It's the implementation roadmap: what's stubbed vs. real today, in build order, with links to per-area specs (`docs/frontend-roadmap.md`, `docs/backend-api-plan.md`, `docs/testing-strategy.md`, `docs/observability-and-ops.md`, `docs/production-verification.md`) that carry the concrete decisions — env var names, request shapes, library choices, gotchas already found. Don't re-derive these from `SPEC.md` alone; the docs exist because turning the spec into working code surfaced things worth getting right the first time (e.g. `CLASSIFIER_MODEL` swapping breaks the temperature knob on newer Claude tiers — some model tiers reject `temperature` entirely, see `classify/src/classify.js`). The original MVP-build docs (`docs/archive/ingestion-pipeline.md`, `docs/archive/admin-security.md`, `docs/archive/ui-plan.md`) are archived, shipped, and superseded — kept for historical context only, not live specs.

## Non-negotiable

**Never generate or use AI-generated images of players.** Only real, sourced photos (MLB/team editorial-use, Wikimedia Commons public domain/CC, or screenshots of the actual post being riffed on). This is the single biggest risk-reduction decision in the project per `SPEC.md` — do not relax it for convenience, mockups, or placeholders in a PR meant to ship. (The `classify/assets/demo.jpg` stub photo is a real stock photo, reused for pipeline-testing only, not a generated one — same rule applied to that decision.)

**No autonomous publishing.** Every headline is a `draft` row until a human flips it to `published` via `/admin`. Don't build a path that skips that gate, even for testing convenience.

## Running it

**Always run the app through the Docker stack** — `docker compose up -d` brings up `db` + `minio` + `web` together, and `web` depends on both (the public feed and `/admin` both query Postgres at request time, so the server 500s without a reachable DB). Don't run `node dist/server/entry.mjs` or `astro dev` directly on the host: it'll either fail to connect to services or diverge from the containerized runtime (platform-specific native bindings like `@rolldown/binding` are installed for linux-x64-musl inside the container, not the host OS).

```bash
cp .env.example .env
docker compose up -d              # db + minio + web
docker compose run --rm classify  # one-shot draft-classification run
```

Gotcha: `docker compose up -d web` reuses the anonymous `/app/node_modules` volume across recreations, so a stale install can persist after a `package.json`/lockfile change (symptom: `astro build` failing to resolve a dependency that's definitely in the lockfile). Recreate with `docker compose up -d web --renew-anon-volumes --build` to force a fresh install when that happens. To inspect a running service: `docker compose exec web sh`.

See `README.md` for the full command/URL table, and `handles/README.md` for the Go service (built/run standalone, not part of `docker compose up` — but if you need to run its `go` gates locally and Go isn't installed on the host, run them in the `golang:1.26-alpine` image the Dockerfile already targets: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/handles:/app" -w /app golang:1.26-alpine sh -c "go vet ./... && go test ./... && go build ./..."`).

## Quality gates — run these before considering work done

```bash
npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test && npm --prefix web run build
npm --prefix classify run lint && npm --prefix classify test
cd handles && go vet ./... && go test ./... && go build ./...
npm run format:check   # root — Prettier across the whole repo
```

All of the above run in CI (`.github/workflows/ci.yml`) on every push/PR, plus a `docker-build` job that builds all three services' production Dockerfiles — that job exists because a stale lockfile or a Dockerfile missing an install step (both bit this project once already) fails silently until someone tries to actually deploy. Don't skip it locally before opening a PR.

## Conventions (already in place — follow them, don't reinvent)

- **Formatting**: Prettier, single quotes, 2-space indent — root `.prettierrc` covers `web/`, `classify/`, and `.astro` files. Run `npm run format` at the repo root, not per-service.
- **Linting**: `oxlint` per Node service, not ESLint. Scoped to `.ts`/`.js` only — it doesn't understand `.astro` templates (see the ignore pattern in `web/.oxlintrc.json` if you're tempted to lint `.astro` files; it produces false-positive unused-var warnings on frontmatter).
- **Typechecking**: `astro check` for `web` (not raw `tsc`) — it understands `.astro` files, plain `tsc` doesn't.
- **DB access**: plain `pg` (node-postgres), no ORM. Don't introduce one for two tables.
- **Package management**: `web/` and `classify/` keep independent `package-lock.json` files, deliberately not npm workspaces — each service's Dockerfile does its own isolated `npm ci`. Don't merge them into a monorepo workspace; it breaks that isolation for no benefit at this size.
- **Object storage**: self-hosted MinIO (S3-compatible), not Cloudflare R2, despite what an older version of the spec said — see `README.md` → Production (Railway) for why.
- **Dockerfiles**: `web/Dockerfile` has a `builder` stage (full devDependencies, used by `docker-compose.yml` for local dev) and a `runtime` stage (clean `--omit=dev` install, used by Railway/production with no explicit `--target`). If you touch dependencies, verify both paths still work — this exact split was added after a naive `npm prune` broke local dev by stripping devDependencies the dev-compose workflow still needed.

## What's real vs. stubbed right now

MVP is complete — see `docs/README.md` for the full status and what's next.

- **Real**: Postgres-backed public feed + `/admin` draft review/edit/publish via a Svelte inline-edit island (`web/src/components/DraftCard.svelte`), MinIO image storage + proxy route, the handles service (JSON file + GitHub-PR review flow — see `docs/backend-api-plan.md` for why this is a deliberate design, not a stub of the spec's original Postgres plan), Cloudflare Access JWT verification in-app (`web/src/middleware.ts`), all CI/quality tooling. Headlines are authored directly in `/admin` (not auto-generated); `classify` reads unclassified drafts and assigns each a topic category + safety verdict via Claude (text + attached photo, vision), auto-discarding illegal/doxxing content and flagging the rest for review. It requires `ANTHROPIC_API_KEY` and exits non-zero without it (no placeholder-draft fallback). This replaced the original fetch/generate pipeline (Reddit/Bluesky/FAX Sports + MLB Stats MCP + two-register Claude generation) — see `docs/README.md` → "MVP status" for why, and `docs/archive/ingestion-pipeline.md` for the retired design, kept as historical context only.
- **Live**: the site is deployed to Railway (see `docs/production-verification.md` for the reference config). Infra work is done — the priority now is application code.
- **Next up**: sharing/SEO (no per-headline permalinks, OG tags, RSS, or sitemap yet), remaining CRUD gaps (orphaned-image cleanup, a health-check endpoint — unpublish/discard/create-from-scratch have since shipped), ops visibility for the classify cron, and closing the gap with a "complete" repo bar (test coverage thresholds, E2E, README polish) — see `docs/README.md` → Roadmap for the full list.
