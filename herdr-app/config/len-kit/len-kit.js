// len-kit.js: shared helpers for Len's mods.
// A mod can import only files inside its own folder (no ../, no symlinks), so each mod
// gets a copy. Edit only ~/.config/herdr-app/len-kit/len-kit.js, then run
// ~/.config/herdr-app/len-kit/sync.sh, which copies it into every mod that imports it
// and checks those mods.
import { exec, layout, run, shared, spaces, home, appHome } from "herdr";

// The layout node with this id (a block, a stack, a panel), or null.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const c of node?.children ?? []) { const f = find(c, id); if (f) return f; }
  return null;
}

// Runs a shell script. Pass values as args, not in the script: they arrive as $0, $1, …
// so no quoting is needed. An object as the last arg is exec's options: sh(s, a, { timeout }).
export const sh = (script, ...args) => {
  const opts = args.length && typeof args.at(-1) === "object" ? args.pop() : undefined;
  return exec("sh", ["-c", script, ...args], opts);
};

// "~" or "~/x" with your home folder put in. Use it for paths that go to a command as args.
export const expandHome = (p) => p.replace(/^~(?=\/|$)/, home());

// A text file's contents, or "" if it is missing. Don't use readTextFile from "herdr":
// for a missing file it never settles (no result, no error).
export async function readText(path) {
  const r = await sh('cat "$0" 2>/dev/null', path).catch(() => null);
  return r?.code === 0 ? r.stdout : "";
}

// Machine-specific settings that stay out of git: ~/.config/herdr-app/local/<name>.json.
// Each mod that reads one ships a <name>.example.json beside it. Returns null if the
// file is missing or is not valid JSON.
export async function loadLocal(name) {
  const text = await readText(`${appHome()}/local/${name}.json`);
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// Writes a file anywhere in home (mods can write only under ~/.config/herdr-app
// themselves): makes the folder, writes a temp file, then moves it into place.
export const writeText = (path, text) =>
  sh('mkdir -p "$(dirname "$0")" && printf "%s" "$1" > "$0.tmp" && mv "$0.tmp" "$0"', path, text);

// A password from the macOS Keychain (the login user's account), or null. Never log it.
export async function keychain(service, account) {
  const r = await exec("security", ["find-generic-password", "-a", account, "-s", service, "-w"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

// "3:05 PM"
export const clock = (ms) => {
  const d = new Date(ms), h = d.getHours() % 12 || 12, m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${d.getHours() < 12 ? "AM" : "PM"}`;
};

// Time since ms, short: "now", "12m", "5h", "3d".
export const ago = (ms) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

// Is this side panel tab (a child of the "panel-body" stack) on screen?
export function panelShown(child) {
  const L = layout(), panel = find(L, "panel"), body = find(L, "panel-body");
  return Boolean(panel && !panel.hidden && body?.active === child);
}

// Shows a side panel tab, or hides the panel if that tab is already on screen.
export function togglePanel(child) {
  if (panelShown(child)) run("layout.hide", { id: "panel" });
  else { run("layout.select", { stack: "panel-body", child }); run("layout.show", { id: "panel" }); }
}

// A length of time, for people: "5 min", "1 h", "1 h 12 min" (at least 1 min).
export const dur = (ms) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
};

// The keyboard stretch, the "hands on keyboard" number: ms since shared("rest").since,
// which my-status/rest-watch.js keeps (it resets after a break). 0 if not known yet.
// The break modal and the status bar both read it here, so they always agree.
export const keyStretch = (now = Date.now()) => {
  const since = shared("rest")?.since;
  return since ? Math.max(0, now - since) : 0;
};

// Opens a URL in a new tab of the space's named Chrome window (made if missing).
const CHROME = `on run argv
  set n to item 1 of argv
  set u to item 2 of argv
  tell application "Google Chrome"
    set ids to id of (every window whose given name is n)
    if ids is {} then
      set w to make new window
      set given name of w to n
      set URL of active tab of w to u
    else
      set w to window id (item 1 of ids)
      set minimized of w to false
      tell w to make new tab with properties {URL:u}
    end if
    activate
    delay 0.15
    set index of w to 1
  end tell
end run`;

// AppleScript can't tell two running Chromes apart. A test tool may start a second one
// with its own --user-data-dir (e.g. a --remote-debugging-port browser); then the script
// could make the window in that one. So in that case, hand the URL to the real Chrome's
// own binary: with the default profile it passes the URL to your running Chrome and quits
// (a new tab in its last window, not the space's named window).
const REAL_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// All steps run in ONE shell call that starts at once. A popup (Len commands) closes
// before its command runs, and a .then() that runs after the close never fires, so
// a two-step pgrep-then-open did nothing from the palette. Fallback: plain `open -a`.
const OPEN = `chrome=$1 space=$2 url=$3
if pgrep -f "^$chrome .*--user-data-dir=" >/dev/null; then exec "$chrome" "$url"; fi
[ -n "$space" ] && osascript -e "$0" -- "$space" "$url" >/dev/null && exit 0
exec open -a "Google Chrome" "$url"`;

export function openInSpaceChrome(url) {
  const space = spaces().find((s) => s.active)?.name ?? "";
  return exec("sh", ["-c", OPEN, CHROME, REAL_CHROME, space, url], { timeout: 15_000 });
}

// The next meeting (null if none), as mods/next-meeting/NextMeeting.app writes it (Apple Calendar, which
// syncs Google Calendar): title, start, uid, calendar.
export async function nextMeeting() {
  try { const m = JSON.parse(await readText(`${home()}/.config/herdr-app/data/next-meeting.json`)); return m.none || m.error ? null : m; }
  catch { return null; }
}

// The Google Calendar page of that event. Apple Calendar keeps Google's event id as the
// uid ("<id>@google.com", plus "/RID=…" for one instance of a repeating event, whose
// Google id is "<root id>_<start in UTC, 20261118T150000Z>"; checked against Glean's link). Google's link is
// event?eid=base64("<id> <calendar email>"). Without a Google uid: that day's page.
export async function googleCalendarUrl(m) {
  const d = new Date(m.start);
  const day = `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const g = /^([^@/]+)@google\.com(\/RID=)?/.exec(m.uid ?? "");
  if (!g || !m.calendar?.includes("@")) return day;
  const utc = d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  // An instance id uses the series' root id: drop a "_R20261118T150000" part (Apple's uid
  // keeps it when the series was split there; Google's instance ids don't have it).
  const id = g[2] ? `${g[1].replace(/_R\d{8}T\d{6}$/, "")}_${utc}` : g[1];
  const r = await sh('printf "%s" "$0" | base64 | tr -d "=\n"', `${id} ${m.calendar}`);
  return r.code === 0 ? `https://calendar.google.com/calendar/event?eid=${r.stdout.trim()}&authuser=${encodeURIComponent(m.calendar)}` : day;
}
