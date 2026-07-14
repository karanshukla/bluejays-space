# CLAUDE.md

Repo orientation for any coding agent working here (Claude Code, GLM, or otherwise).

## What this is

`bluejays.space` — a parody headline site for Blue Jays fans (FAX Sports style), plus free Bluesky custom-domain handles at `@username.bluejays.space`. Three services: `handles/` (Go), `web/` (Astro SSR), `ingest/` (Node cron job), plus Postgres and MinIO.

**Read [`SPEC.md`](./SPEC.md) before making product decisions.** It's the canonical spec — what to build and why, including the safety-critical rules (parody labeling philosophy, no AI-generated player images). `README.md` and `docs/*.md` reference it as "the spec"; they are not a substitute for reading it.

**Read [`docs/README.md`](./docs/README.md) before picking up follow-up work.** It's the implementation roadmap: what's stubbed vs. real today, in build order, with links to per-area specs (`docs/ingestion-pipeline.md`, `docs/admin-security.md`, `docs/ui-plan.md`) that carry the concrete decisions — env var names, request shapes, library choices, gotchas already found. Don't re-derive these from `SPEC.md` alone; the docs exist because turning the spec into working code surfaced things worth getting right the first time (e.g. `mlb-api-mcp` is MCP-only with no REST surface, `GENERATION_MODEL` swapping breaks the register-2 temperature knob on newer Claude tiers, PRAW doesn't exist for Node).

## Non-negotiable

**Never generate or use AI-generated images of players.** Only real, sourced photos (MLB/team editorial-use, Wikimedia Commons public domain/CC, or screenshots of the actual post being riffed on). This is the single biggest risk-reduction decision in the project per `SPEC.md` — do not relax it for convenience, mockups, or placeholders in a PR meant to ship. (The `ingest/assets/demo.jpg` stub photo is a real stock photo, reused for pipeline-testing only, not a generated one — same rule applied to that decision.)

**No autonomous publishing.** Every headline is a `draft` row until a human flips it to `published` via `/admin`. Don't build a path that skips that gate, even for testing convenience.

## Running it

```bash
cp .env.example .env
docker compose up -d              # db + minio + web
docker compose run --rm ingest    # one-shot generation run
```

See `README.md` for the full command/URL table, and `handles/README.md` for the Go service (built/run standalone, not part of `docker compose up`).

## Quality gates — run these before considering work done

```bash
npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test && npm --prefix web run build
npm --prefix ingest run lint && npm --prefix ingest test
cd handles && go vet ./... && go test ./... && go build ./...
npm run format:check   # root — Prettier across the whole repo
```

All of the above run in CI (`.github/workflows/ci.yml`) on every push/PR, plus a `docker-build` job that builds all three services' production Dockerfiles — that job exists because a stale lockfile or a Dockerfile missing an install step (both bit this project once already) fails silently until someone tries to actually deploy. Don't skip it locally before opening a PR.

## Conventions (already in place — follow them, don't reinvent)

- **Formatting**: Prettier, single quotes, 2-space indent — root `.prettierrc` covers `web/`, `ingest/`, and `.astro` files. Run `npm run format` at the repo root, not per-service.
- **Linting**: `oxlint` per Node service, not ESLint. Scoped to `.ts`/`.js` only — it doesn't understand `.astro` templates (see the ignore pattern in `web/.oxlintrc.json` if you're tempted to lint `.astro` files; it produces false-positive unused-var warnings on frontmatter).
- **Typechecking**: `astro check` for `web` (not raw `tsc`) — it understands `.astro` files, plain `tsc` doesn't.
- **DB access**: plain `pg` (node-postgres), no ORM. Don't introduce one for two tables.
- **Package management**: `web/` and `ingest/` keep independent `package-lock.json` files, deliberately not npm workspaces — each service's Dockerfile does its own isolated `npm ci`. Don't merge them into a monorepo workspace; it breaks that isolation for no benefit at this size.
- **Object storage**: self-hosted MinIO (S3-compatible), not Cloudflare R2, despite what an older version of the spec said — see `README.md` → Production (Railway) for why, and `docs/ingestion-pipeline.md` for why `mlb-api-mcp` specifically needs to stay *publicly* reachable even though MinIO/Postgres are Railway-private (the MCP connector call originates from Anthropic's infrastructure, not from inside the Railway project).
- **Dockerfiles**: `web/Dockerfile` has a `builder` stage (full devDependencies, used by `docker-compose.yml` for local dev) and a `runtime` stage (clean `--omit=dev` install, used by Railway/production with no explicit `--target`). If you touch dependencies, verify both paths still work — this exact split was added after a naive `npm prune` broke local dev by stripping devDependencies the dev-compose workflow still needed.

## What's real vs. stubbed right now

- **Real**: Postgres-backed public feed + `/admin` draft review/edit/publish (plain HTML forms, not the spec's eventual Svelte/React island — see `docs/ui-plan.md`), MinIO image storage + proxy route, the handles service, all CI/quality tooling.
- **Stubbed**: `ingest`'s actual generation flow. It currently inserts two hardcoded placeholder draft rows and uploads a demo photo to prove the write path works — see `docs/ingestion-pipeline.md` for the real flow (MLB Stats via Claude's MCP connector, Reddit/Bluesky/FAX Sports fetch, the two-register Claude generation call).
- **Not started**: Cloudflare Access on `/admin` (currently wide open — see `docs/admin-security.md` before any real, unpublished drafts sit in that table).
