# bluejays-space

Monorepo for **bluejays.space** — a parody headline site for Blue Jays fans (in the style of FAX Sports), plus free Bluesky custom domain handles at `@username.bluejays.space`.

## Services

| Directory | Type | Description |
|---|---|---|
| [`handles/`](./handles) | Go service | Serves AT Protocol DID files and a handle-request form for `*.bluejays.space`. JSON-backed; opens GitHub PRs for new handle requests. |
| [`web/`](./web) | Astro SSR | Public headline feed + `/admin` review UI (stubbed). |
| [`ingest/`](./ingest) | Node job | Headline generation cron — fetches Reddit/Bluesky/MLB context, drafts with Claude, writes draft rows to Postgres (stubbed). |
| [`db/`](./db) | Postgres schema | Baseline `handles` + `headlines` tables, auto-loaded on first DB init. |

See [`handles/README.md`](./handles/README.md) for the handle service's env vars and deployment notes.

## Local development

Everything runs through Docker Compose. Requires Docker Desktop (or Engine + Compose).

```bash
cp .env.example .env        # fill in secrets (GITHUB_TOKEN, API keys, etc.)
docker compose up -d        # starts db + web + handles
docker compose run --rm ingest   # trigger a generation run manually
docker compose down -v      # tear down + drop the Postgres volume
```

| URL | Service |
|---|---|
| http://localhost:4321 | web (Astro) |
| http://localhost:8080 | handles (Go) |
| localhost:5432 | Postgres |

## Production (Railway)

Each service ships a production `Dockerfile`. In Railway, set each service's **root directory** to its subfolder (`handles/`, `web/`, `ingest/`) so Railway builds from the right Dockerfile. `ingest` runs as a cron trigger (runs, exits); `handles` and `web` are always-on.
