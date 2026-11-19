#!/bin/sh
# Checks every mod that Len's layout shows, plus the popups opened from them, and makes
# sure that each len-kit.js copy is up to date. Run it after any mod change.
# Exits nonzero if one fails; `herdr-app check <folder>` then shows the exact error.
set -u
APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
POPUPS="db len-commands rest"
status=0
mods="$( (jq -r '.. | objects | .mod? // empty' "$APP/layouts/herdr-chrome.json"; for p in $POPUPS; do echo "$p"; done) | sort -u)"
for name in $mods; do
  if herdr-app check "$APP/mods/$name" >/dev/null 2>&1; then echo "ok    $name"
  else echo "FAIL  $name  (herdr-app check $APP/mods/$name)"; status=1; fi
done
"$(dirname "$0")/sync.sh" --verify || status=1
exit $status
