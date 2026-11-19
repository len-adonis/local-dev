#!/bin/sh
# Copies len-kit.js into every mod that imports "./len-kit.js", then checks those mods.
# Run it after you edit len-kit.js. `sync.sh --verify` only reports copies that differ.
set -u
KIT="$(cd "$(dirname "$0")" && pwd)/len-kit.js"
MODS="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"
status=0
for dir in "$MODS"/*/; do
  dir="${dir%/}"
  grep -lqs 'from "./len-kit.js"' "$dir"/*.js || continue
  name="$(basename "$dir")"
  if [ "${1:-}" = "--verify" ]; then
    cmp -s "$KIT" "$dir/len-kit.js" || { echo "out of date: $name"; status=1; }
    continue
  fi
  cp "$KIT" "$dir/len-kit.js"
  if herdr-app check "$dir" >/dev/null 2>&1; then echo "ok    $name"
  else echo "FAIL  $name  (herdr-app check $dir)"; status=1; fi
done
exit $status
