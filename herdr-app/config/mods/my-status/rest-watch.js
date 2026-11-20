// Rest watch: counts the time you are actually at the keyboard, and opens the `rest`
// modal ("Time for a breather?") after a long stretch.
// - At the keyboard: macOS HIDIdleTime (seconds since the last key press or mouse move),
//   read from `ioreg` every 30 s.
// - A stretch ends by itself when you are away for AWAY_MS (idle that long, or the Mac
//   slept), so a real break resets it without any click.
// - The modal opens after LIMIT_MS of one stretch, not during a meeting (my-status's
//   next meeting), and not again within SNOOZE_MS ("Not now", or Esc).
// State, shared("rest"): { since (start of this stretch), snoozeUntil, lastCheck }.
// The modal reads and changes it too. The timings are shared as shared("rest.config"). Len commands "Take a break (preview)" opens it at once.
import { shared, setShared, openOverlay } from "herdr";
import { sh } from "./len-kit.js";

export const LIMIT_MS = 90 * 60_000;
export const AWAY_MS = 10 * 60_000;
export const SNOOZE_MS = 5 * 60_000;
const TICK_MS = 30_000;

// A window overlay over the whole app, not a dialog: dialogs always close on Esc, and
// this one closes only with a choice. The mod draws its own dimmed backdrop.
export const openRest = () => openOverlay({ mod: "rest", kind: "window", frame: "none", key: "rest", width: 1, height: 1, at: { x: 0, y: 0 } });

async function idleMs() {
  const r = await sh("ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print $NF; exit}'");
  const ns = Number(r.stdout.trim());
  return r.code === 0 && Number.isFinite(ns) ? ns / 1e6 : 0;
}

// inMeeting: () => true while a calendar event is on now.
export function startRestWatch(cx, inMeeting) {
  // The one place these numbers live: the modal reads them from here for its captions
  // and for "I'm too locked in".
  setShared("rest.config", { limitMs: LIMIT_MS, awayMs: AWAY_MS, snoozeMs: SNOOZE_MS });
  const tick = () => cx.spawn(async (cx) => {
    const now = Date.now(), idle = await idleMs();
    const r = shared("rest") ?? {};
    let since = r.since ?? now;
    // Away long enough: idle that long, or no check for that long (the Mac slept, or
    // Herdr was closed: lastCheck is saved, so a gap across a restart counts too).
    if (idle >= AWAY_MS || now - (r.lastCheck ?? now) >= AWAY_MS) since = now;
    const due = now - since >= LIMIT_MS && now >= (r.snoozeUntil ?? 0) && !inMeeting();
    // When it opens, snooze at once: an Esc then brings it back after SNOOZE_MS.
    setShared("rest", { ...r, since, lastCheck: now, ...(due ? { snoozeUntil: now + SNOOZE_MS } : {}) });
    if (due) openRest();
    cx.notify(); // the status bar shows the stretch
  });
  tick();
  cx.timer.every(TICK_MS, () => tick());
}
