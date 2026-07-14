# bluejays-space

Monorepo for **bluejays.space** — a parody headline site for Blue Jays fans (in the style of FAX Sports), plus free Bluesky custom domain handles at `@username.bluejays.space`.

**Start here:** [`SPEC.md`](./SPEC.md) is the canonical product/design spec (what to build and why, including the safety-critical rules). [`docs/README.md`](./docs/README.md) is the implementation roadmap for what's left to build, in order. [`CLAUDE.md`](./CLAUDE.md) is the quick-orientation doc for any coding agent picking this repo up cold.

## Services

| Directory | Type | Description |
|---|---|---|
| [`handles/`](./handles) | Go service | Serves AT Protocol DID files and a handle-request form for `*.bluejays.space`. JSON-backed; opens GitHub PRs for new handle requests. |
| [`web/`](./web) | Astro SSR | Public headline feed (published rows) + `/admin` draft review/edit/publish UI, both DB-backed. |
| [`ingest/`](./ingest) | Node job | Headline generation cron. DB write path is wired up; the real fetch/generate step (Reddit/Bluesky/MLB context, Claude drafting) is still stubbed — each run inserts placeholder draft rows. |
| [`db/`](./db) | Postgres schema | Baseline `handles` + `headlines` tables, auto-loaded on first DB init. |
| `minio` (no repo folder — off-the-shelf image) | Object storage | Self-hosted S3-compatible store for headline photos, standing in for Cloudflare R2. `ingest` uploads, `web` proxies reads at `/api/images/*`; nothing else talks to it directly. |

See [`handles/README.md`](./handles/README.md) for the handle service's env vars and deployment notes.

## Local development

Everything runs through Docker Compose. Requires Docker Desktop (or Engine + Compose).

```bash
cp .env.example .env        # fill in secrets (GITHUB_TOKEN, API keys, etc.)
docker compose up -d        # starts db + minio + web
docker compose run --rm ingest   # trigger a generation run manually
docker compose down -v      # tear down + drop the Postgres/MinIO volumes
```

| URL | Service |
|---|---|
| http://localhost:4321 | web (Astro) |
| http://localhost:8080 | handles (Go) — not started by `up`, build/run separately (see [`handles/README.md`](./handles/README.md)) |
| http://localhost:9001 | MinIO console (login: `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) |
| localhost:5432 | Postgres |
| localhost:9000 | MinIO S3 API |

## Quality & CI

Tooling matches the pattern used across the author's other repos: [Prettier](https://prettier.io) for formatting (root-level config, covers `web/`, `ingest/`, and `.astro` files via `prettier-plugin-astro`), [oxlint](https://oxc.rs/docs/guide/usage/linter) per Node service for fast linting, `astro check` for `web`'s type/template checking, and native test runners — [Vitest](https://vitest.dev) for `web` (a browser-adjacent SSR app), Node's built-in `node --test` for `ingest` (a plain script, no need for a heavier runner), and Go's `testing` package for `handles`.

```bash
npm install              # root: installs Prettier + husky (pre-commit hooks)
npm run format            # format the whole repo
npm run format:check      # CI-equivalent check, no writes

npm --prefix web install && npm --prefix web run lint && npm --prefix web run typecheck && npm --prefix web test
npm --prefix ingest install && npm --prefix ingest run lint && npm --prefix ingest test
cd handles && go vet ./... && go test ./...
```

A root `.husky/pre-commit` hook runs Prettier + oxlint on staged files per service, then `web`'s typecheck and `handles`'s `go vet`/`gofmt` — install it via `npm install` at the repo root (the `prepare` script wires it up automatically).

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push/PR: lint + typecheck + test + build for `web`, lint + test for `ingest`, vet + test + build for `handles`, a root format check, and a `docker-build` job that builds all three services' production Dockerfiles — the last one exists because a stale lockfile or a missing `npm ci` step in a Dockerfile (both of which happened during this project's early development) fails silently until someone actually tries to deploy; this catches it on every PR instead. [`dependabot.yml`](.github/dependabot.yml) keeps each service's dependencies (npm ×2, Go, Docker base images, GitHub Actions) current on a weekly schedule.

`web/` and `ingest/` deliberately keep independent `package-lock.json` files rather than npm workspaces — each service's Dockerfile does its own isolated `npm ci`, and a shared workspace lockfile would break that independence for no real benefit at this repo's size.

## Production (Railway)

Each service ships a production `Dockerfile` and runs as its own Railway service (`bluejays-web`, `bluejays-ingest`, `bluejays-handles`) plus a managed Postgres instance — no shared container, no docker-compose in prod. In Railway, set each service's **root directory** to its subfolder (`handles/`, `web/`, `ingest/`) so Railway builds from the right Dockerfile. `ingest` runs as a cron trigger (runs, exits); `handles` and `web` are always-on.

Services reach Postgres over Railway's private network (`DATABASE_URL` set via a variable reference to the Postgres plugin, not a public connection string) — `web`, `ingest`, and `handles` (once its DID storage moves off `handles.json`, see [`handles/README.md`](./handles/README.md)) all point at the same instance this way.

**Domains:** the apex `bluejays.space` points at `bluejays-web`. The wildcard `*.bluejays.space` (see [`handles/README.md`](./handles/README.md) for the CNAME) points at `bluejays-handles` and covers every subdomain under it — including `handles.bluejays.space` itself, which serves the handle-request form (the Go service isn't host-gated on `/`, only `/.well-known/atproto-did` is). `web`'s header links out to `handles.bluejays.space` so visitors can find the handle feature; no separate DNS entry is needed for it beyond the wildcard.

**Object storage:** MinIO deploys as its own Railway service too, but from the official `minio/minio` Docker image directly (Railway's "Deploy from Docker Image" source) rather than a repo subfolder — there's no custom code to build. Give it a Railway volume for `/data` and set `S3_ENDPOINT` on `web`/`ingest` to its private Railway URL (`http://<service>.railway.internal:9000`). It should **not** get a public domain — `web`'s `/api/images/*` route is the only public path to anything in it, which keeps bucket policy irrelevant (private-only, no anonymous read needed) and credentials confined to two services instead of anything with a browser.
