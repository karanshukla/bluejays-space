#!/bin/sh
set -e

# Dev entrypoint: ensure node_modules exist in the (Linux) container before
# starting the server. The host's node_modules (if any) are intentionally
# masked by the anonymous volume in docker-compose.yml, so we install here to
# get platform-correct (linux-x64-musl) native bindings like @rolldown/binding.
if [ ! -d node_modules ]; then
    echo "[dev] installing dependencies (first start)..."
    npm install
fi

# Same schema-application step as production (see scripts/migrate.mjs and
# the Dockerfile's runtime CMD) — an existing dev Postgres volume only gets
# schema.sql applied once, on first `docker compose up` ever, via Postgres's
# own docker-entrypoint-initdb.d hook. A volume created before a later
# schema.sql change (e.g. an ALTER) won't have picked it up without this.
echo "[dev] applying schema migration..."
node scripts/migrate.mjs

exec "$@"
