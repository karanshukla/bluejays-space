#!/bin/sh
set -e

# Dev entrypoint: ensure node_modules exist in the (Linux) container before
# starting the dev server. The host's node_modules (if any) are intentionally
# masked by the anonymous volume in docker-compose.yml, so we install here to
# get platform-correct (linux-x64-musl) native bindings like @rolldown/binding.
if [ ! -d node_modules ]; then
    echo "[dev] installing dependencies (first start)..."
    npm install
fi

exec "$@"
