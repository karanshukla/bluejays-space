#!/bin/sh
set -e

target="${HANDLES_FILE:-/app/handles.json}"

if [ ! -f "$target" ]; then
    mkdir -p "$(dirname "$target")"
    cp /app/handles.json "$target"
    echo "Initialized $target from bundled handles.json"
fi

exec "$@"
