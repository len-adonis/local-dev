import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, shared, openOverlay, checking, appHome } from "herdr";
import { clock, dur, keyStretch, openInSpaceChrome, googleCalendarUrl, sh, readText } from "./len-kit.js";
import { startAutoSplit } from "./auto-split.js";
import { startDbWatch } from "./db-watch.js";
import { startStackWatch } from "./stack-watch.js";
import { startRestWatch } from "./rest-watch.js";

// Next meeting: mods/next-meeting/NextMeeting.app (src/main.swift) reads Apple Calendar,
// which includes synced Google calendars, and writes data/next-meeting.json.
// It is its own app because macOS gives calendar access per app, and Herdr doesn't ask for it.
// Not len-kit's nextMeeting(): that hides the error, and the bar shows "Calendar access is off".
const APP = `${appHome()}/mods/next-meeting/NextMeeting.app`;
const FILE = `${appHome()}/data/next-meeting.json`;
const span = (min) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`);

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.meeting = null;
    this.stack = null;
    // `herdr-app check` runs init for real: start no watchers there (auto-split would
    // split real tabs, and the meeting app and DB probes would run).
    if (checking()) return;
    this.refreshMeeting(cx);
    startAutoSplit(cx);
    startDbWatch(cx);
    startStackWatch(this, cx);
    // The break reminder, not during a meeting.
    startRestWatch(cx, () => { const d = this.meeting, now = Date.now(); return Boolean(d && !d.none && !d.error && d.start <= now && now < d.end); });
    cx.timer.every(60_000, (cx) => this.refreshMeeting(cx));
  }

  refreshMeeting(cx) {
    cx.spawn(async (cx) => {
      await sh('open -g -j -W "$0"', APP, { timeout: 20_000 });
      try { this.meeting = JSON.parse(await readText(FILE)); } catch { this.meeting = null; }
      cx.notify();
    });
  }

  // "DB ● ●": one dot for each row with `bar` in local/db.json (yellow: hidden while
  // an access request is on, or can't be checked), then the access label while that
  // access is on. Click for the DB popup. Nothing shows without local/db.json.
  dbPart(t) {
    const d = shared("db.status");
    if (d?.missing) return null;
    const color = (state) => state === "up" ? t.ansi2 : state === "down" ? t.ansi1 : d ? t.blocked : t.dim;
    return h_flex().id("db-status").gap(5).items_center().cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click(() => openOverlay({ mod: "db", kind: "popup", at: "pointer", width: 480, height: 360 }))
      .child("DB")
      .children((d?.rows ?? []).filter((r) => r.bar).map((r) => div().size(7).rounded(4).bg(color(r.state))))
      .when(Boolean(d?.accessOn), (el) => el.child(div().text_color(t.blocked).child((d.accessLabel ?? "access").toLowerCase())));
  }

  // "1 h 12 min on keys": the keyboard stretch, the same number and wording as the
  // break modal (keyStretch + dur in len-kit.js). Hidden under a minute; yellow once it
  // reaches the break limit (rest.config, set in rest-watch.js).
  keysPart(t) {
    const ms = keyStretch(), limit = shared("rest.config")?.limitMs;
    if (ms < 60_000) return null;
    return div().id("keys-stretch").text_color(limit && ms >= limit ? t.blocked : t.dim).child(`${dur(ms)} on keys`);
  }

  // The meeting room, short: "Building-5th Floor-HQ: Berlin (8)" → "Berlin"
  // (the full name is in the tooltip). No room on the event: "no room", so you know to
  // book one or that it's a call.
  roomPart(t, room) {
    if (!room) return div().text_color(t.ansi3).child("· no room");
    const short = room.split(": ").pop().replace(/\s*\(\d+\)$/, "").trim() || room;
    return div().id("meeting-room").tooltip(room).child(`· ${short}`);
  }

  meetingLabel(t) {
    const d = this.meeting;
    if (!d) return null;
    if (d.error) return { text: "Calendar access is off", color: t.muted };
    if (d.none) return null; // no meeting: show nothing
    const now = Date.now(), room = d.room ?? null;
    const toStart = Math.ceil((d.start - now) / 60_000), toEnd = Math.ceil((d.end - now) / 60_000);
    if (toStart <= 0) return { text: `Now: ${d.title} · ends in ${span(toEnd)}`, color: t.working, room };
    if (toStart <= 5) return { text: `${d.title} · in ${toStart}m`, color: t.blocked, room };
    if (toStart < 60) return { text: `${d.title} · in ${toStart}m`, color: t.muted, room };
    return { text: `${d.title} · ${clock(d.start)}`, color: t.muted, room };
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const needs = agents().filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      // The machine only for a remote space ("This computer" told you nothing).
      .when(Boolean(space?.machine), el => el.child(label("server", space.machine)))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      // Stack position from gt (stack-watch.js), e.g. "stack 6/7 · needs restack".
      .when(Boolean(this.stack), el => el.child(h_flex().gap(4).items_center()
        .child(`stack ${this.stack.pos}/${this.stack.total}`)
        .when(this.stack.restack, el => el.child(div().text_color(t.ansi3).child("· needs restack")))))
      // Agents only when one is waiting on you (the plain count told you nothing).
      .when(needs > 0, el => el.child(h_flex().gap(6).items_center().text_color(t.blocked)
        .child(div().size(6).rounded(3).bg(t.blocked)).child(`${needs} ${needs === 1 ? "agent needs" : "agents need"} you`)))
      .when(Boolean(this.meetingLabel(t)), el => {
        const m = this.meetingLabel(t);
        return el.child(h_flex().id("next-meeting").gap(6).items_center().text_color(m.color)
          .hover(s => s.text_color(t.foreground)).on_click(() => { const d = this.meeting; if (d) googleCalendarUrl(d).then(openInSpaceChrome); })
          .child(svg("mods/workspace-chrome/clock.svg").size(13)).child(m.text)
          .when("room" in m, el => el.child(this.roomPart(t, m.room))));
      })
      .when(Boolean(this.dbPart(t)), el => el.child(this.dbPart(t)))
      .when(Boolean(this.keysPart(t)), el => el.child(this.keysPart(t)))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
