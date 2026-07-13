#!/bin/sh
set -e

# Always sync the bundled handles.json to the target path so each deploy
# picks up the latest entries from the image. If the target is the default
# in-image path, no copy is needed.
target="${HANDLES_FILE:-/app/handles.json}"
if [ "$target" != "/app/handles.json" ]; then
    mkdir -p "$(dirname "$target")"
    cp /app/handles.json "$target"
fi

exec "$@"
