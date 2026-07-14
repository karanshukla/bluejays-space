#!/bin/sh
set -e

# Always sync the bundled handles.json to the target path so each deploy
# picks up the latest entries from the image. If the target resolves to the
# default in-image path, no copy is needed (avoids cp same-file error).
bundled="/app/handles.json"
target="${HANDLES_FILE:-$bundled}"
# Resolve to absolute so a relative default ("handles.json") is recognized.
case "$target" in
    /*) ;;
    *) target="/app/$target" ;;
esac
if [ "$target" != "$bundled" ]; then
    mkdir -p "$(dirname "$target")"
    cp "$bundled" "$target"
fi

exec "$@"
