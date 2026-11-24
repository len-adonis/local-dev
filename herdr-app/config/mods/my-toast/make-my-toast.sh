#!/bin/sh
# Builds mods/my-toast from Herdr's shipped `toast` mod plus desktop.js.
# Only desktop.js and this script are mine, so only they go into git; Herdr's code
# is copied from your own install. Run it again after a Herdr update changes `toast`.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SHIPPED="$HERE/../toast"
[ -f "$SHIPPED/main.js" ] || { echo "no shipped toast mod at $SHIPPED" >&2; exit 1; }

cp "$SHIPPED/mod.json" "$HERE/mod.json"
for f in jsconfig.json gpui-kit.d.ts; do [ -f "$SHIPPED/$f" ] && cp "$SHIPPED/$f" "$HERE/$f"; done

# Two changes to the shipped main.js: import toDesktop, and call it once per notification.
python3 -I - "$SHIPPED/main.js" "$HERE/main.js" <<'EOF'
import sys
src, out = sys.argv[1], sys.argv[2]
t = open(src).read()
imp = 'from "herdr";\n'
hook = "export default class Toast extends View {\n"
if t.count(imp) != 1 or t.count(hook) != 1:
    sys.exit("the shipped toast changed shape: update make-my-toast.sh")
t = t.replace(imp, imp + 'import { toDesktop } from "./desktop.js"; // my-toast\n', 1)
t = t.replace(hook, hook + "  init() { toDesktop(props() ?? {}); } // my-toast\n\n", 1)
open(out, "w").write(t)
EOF
herdr-app check "$HERE" >/dev/null && echo "built $HERE"
