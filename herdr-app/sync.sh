#!/bin/bash
# Copies the parts of ~/.config/herdr-app that are safe to publish into this folder.
# This list is the only thing that decides what goes public. Run it, then review
# `git diff` before you commit.
#
# Never add: local/ (work settings), data/, shared.json, view.json, window.json,
# seen.json, layouts/.state/ (live app data), sounds and images that belong to
# someone else, or the files and mods that ship with Herdr.
#
# Usage: herdr-app/sync.sh            copy into the repo
#        herdr-app/sync.sh --install  copy from the repo into ~/.config/herdr-app
set -euo pipefail

APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
REPO="$(cd "$(dirname "$0")" && pwd)/config"

FILES=(
  settings.json
  keys.json
  layouts/herdr-chrome.json
  themes/atom-one-dark.json
  sounds/make-sounds.sh
  len-kit/README.md
  len-kit/len-kit.js
  len-kit/sync.sh
  len-kit/check-all.sh
  mods/db/main.js
  mods/db/mod.json
  mods/db/db.example.json
  mods/droid-cloud/main.js
  mods/droid-cloud/mod.json
  mods/len-commands/main.js
  mods/len-commands/mod.json
  mods/my-status/main.js
  mods/my-status/mod.json
  mods/my-status/auto-split.js
  mods/my-status/split7030.py
  mods/my-status/db-watch.js
  mods/my-status/rest-watch.js
  mods/my-status/stack-watch.js
  mods/my-changes/main.js
  mods/my-changes/mod.json
  mods/my-changes/changes.svg
  mods/my-changes/LICENSE-herdr
  mods/my-toast/desktop.js
  mods/my-toast/make-my-toast.sh
  mods/next-meeting/src/main.swift
  mods/next-meeting/NextMeeting.app/Contents/Info.plist
  mods/notes/main.js
  mods/notes/mod.json
  mods/rest/main.js
  mods/rest/mod.json
  mods/rest/art-source/make-art.py
  mods/space-vscode/main.js
  mods/space-vscode/mod.json
)

if [ "${1:-}" = "--install" ]; then FROM="$REPO"; TO="$APP"; else FROM="$APP"; TO="$REPO"; fi

for f in "${FILES[@]}"; do
  [ -f "$FROM/$f" ] || { echo "missing: $FROM/$f" >&2; exit 1; }
  mkdir -p "$TO/$(dirname "$f")"
  cp "$FROM/$f" "$TO/$f"
done
echo "copied ${#FILES[@]} files to $TO"

if [ "${1:-}" = "--install" ]; then
  # my-toast = Herdr's shipped toast + desktop.js; build it from this machine's Herdr.
  "$APP/mods/my-toast/make-my-toast.sh"
  # Each mod that imports len-kit gets its own copy (mods can't import outside their folder).
  "$APP/len-kit/sync.sh"
fi
