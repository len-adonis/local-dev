// Rest: a bright white "Time for a breather?" modal, opened by my-status/rest-watch.js
// after a long stretch at the keyboard (or from Len commands: "Take a break (preview)").
// Light on purpose, against the dark app: it should catch your eye.
// - How long this stretch has been (keyStretch in len-kit.js; the status bar shows it too).
// - Opened with props.preview (Len commands "Take a break (preview)"): a look only. The
//   choices just close it; the count and the snooze stay as they were.
// - Your Claude Code and Droid sessions that are not working, oldest first. Each can be
//   compacted (Claude Code only: `/compact`, sent with `hc send`, only if it is still not
//   working) or closed (two clicks; ends that pane's terminal). Ones idle for STALE_MS
//   are marked stale. Working sessions are left alone.
// - "I took a break" + "Back to it": logs the break and starts a new stretch.
//   "I'm too locked in" + "Back to it": asked again after rest.config's snoozeMs (set
//   only in my-status/rest-watch.js, so captions never drift). Back to it is off until you pick one,
//   and Esc or a click beside the card does nothing: it closes only with a choice.
// Colors follow the Wii menu's feel (white, grays, cyan). An optional picture of your
// own goes in mods/rest/art.png.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, exec, run, props, closeOverlay, shared, setShared, checking, home } from "herdr";
import { dur, keyStretch } from "./len-kit.js";

const STALE_MS = 2 * 3600_000;
const MAX_ROWS = 3; // the quietest sessions only
const APPS = { "claude-code": "Claude Code", droid: "Droid" };

// A light palette of its own: this modal ignores the dark theme. Taken from the picture
// (art.png): the card is its wall gray, so the picture runs into the card; the blues are
// its window sky and line art; text is its slate frame, darkened.
const C = {
  card: "#e6e8ec", ink: "#3f4f63", soft: "#66768c", faint: "#8e9bad", line: "#d2d7de",
  wash: "#ffffff", sky: "#4aa8e6", skyDark: "#3a86c0", skyWash: "#e6f2fc", warm: "#d9773a", warmWash: "#fbeadd",
  off: "#d6dbe1", offInk: "#98a3b2",
};
// Optional picture of your own in place of the sun: save it as mods/rest/art.png.
const ART = "mods/rest/art.png";


export default class Rest extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus(); // keys go here (and stop here), not to the terminal behind
    cx.timer.after(300, () => this.handle.focus());
    this.choice = null;     // "break" | "locked": Back to it stays off until you pick one
    this.art = false;
    this.sessions = null;   // [{ address, pane, name, app, status, quietMs }]
    this.state = {};        // address -> "compacting" | "compacted" | "confirm" | "error"
    if (checking()) { this.sessions = []; return; }
    exec("test", ["-f", `${home()}/.config/herdr-app/${ART}`]).then((r) => { this.art = r.code === 0; cx.notify(); });
    this.load(cx);
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const list = agents().filter((a) => APPS[a.app] && a.status !== "working" && a.status !== "blocked");
      const now = Date.now();
      this.sessions = (await Promise.all(list.map(async (a) => {
        const r = await exec("hc", ["get", a.address, "--json"]);
        let since = null;
        try { since = JSON.parse(r.stdout).status_ms ?? null; } catch {}
        return { address: a.address, pane: a.pane, app: a.app, status: a.status,
          // The terminal's title (Claude Code sets the conversation's), else a named tab.
          name: a.title?.trim() || (/^\d+$/.test(a.tab_name ?? "") ? "" : a.tab_name) || a.space_name, space: a.space_name, quietMs: since ? now - since : 0 };
      }))).sort((x, y) => y.quietMs - x.quietMs);
      cx.notify();
    });
  }

  close() { closeOverlay(props().overlay); }

  // "I took a break": log it, start a new stretch. "I'm too locked in": back in
  // rest.config's snoozeMs; the stretch keeps counting.
  done() {
    if (props()?.preview) return this.close(); // a preview changes nothing
    const r = shared("rest") ?? {}, now = Date.now();
    const snoozeMs = shared("rest.config")?.snoozeMs; // set by my-status/rest-watch.js
    if (this.choice === "break") {
      const { breaks: _old, ...rest } = r; // breaks were logged before; not kept now
      setShared("rest", { ...rest, since: now, snoozeUntil: 0 });
    } else {
      if (snoozeMs) setShared("rest", { ...r, snoozeUntil: now + snoozeMs });
    }
    this.close();
  }

  compact(s, cx) {
    // Still not working? (It may have started since the modal opened.)
    const live = agents().find((a) => a.address === s.address);
    if (!live || live.status === "working" || live.status === "blocked") { this.state[s.address] = "busy"; cx.notify(); return; }
    this.state[s.address] = "compacting";
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec("hc", ["send", s.address, "/compact"]);
      this.state[s.address] = r.code === 0 ? "compacted" : "error";
      cx.notify();
    });
  }

  closeSession(s, cx) {
    if (this.state[s.address] !== "confirm") { this.state[s.address] = "confirm"; cx.notify(); return; }
    run("pane.close", { pane: s.pane });
    this.sessions = this.sessions.filter((x) => x.address !== s.address);
    delete this.state[s.address];
    cx.notify();
  }

  pill(id, label, onClick, { primary = false, danger = false, quiet = false } = {}) {
    const bg = primary ? C.sky : danger ? C.warmWash : quiet ? C.wash : C.card;
    const fg = primary ? "#ffffff" : danger ? C.warm : C.ink;
    return div().id(id).px(primary ? 22 : 10).py(primary ? 10 : 3).rounded_full().cursor_pointer()
      .text_size(primary ? 14 : 11.5).font_semibold().bg(bg).text_color(fg)
      .when(quiet, (el) => el.border_1().border_color(C.line))
      .hover((s) => s.bg(primary ? C.skyDark : danger ? "#f7dcc8" : C.skyWash))
      .on_click(onClick).child(label);
  }

  row(s) {
    const st = this.state[s.address];
    const stale = s.quietMs >= STALE_MS;
    const right = st === "compacting" ? div().text_size(12).text_color(C.soft).child("Compacting…")
      : st === "compacted" ? div().text_size(12).text_color(C.sky).child("Sent ✓")
      : st === "busy" ? div().text_size(12).text_color(C.soft).child("Working: left alone")
      : st === "error" ? div().text_size(12).text_color(C.warm).child("Could not send")
      : h_flex().gap(6)
        .when(s.app === "claude-code", (el) => el.child(this.pill(`compact-${s.address}`, "Compact", (_e, cx) => this.compact(s, cx), { quiet: true })))
        .child(this.pill(`close-${s.address}`, st === "confirm" ? "Sure? Close" : "Close", (_e, cx) => this.closeSession(s, cx), { danger: st === "confirm", quiet: st !== "confirm" }));
    // Just the name (and "stale"): how long and where are in the tooltip.
    return h_flex().id(`row-${s.address}`).px(12).py(6).gap(8).items_center().rounded(12).bg(C.wash)
      .tooltip(`quiet ${dur(s.quietMs)} · ${APPS[s.app]} · ${s.space}`)
      .child(div().min_w(0).flex_1().text_size(12.5).text_color(C.ink).truncate().child(s.name))
      .when(stale, (el) => el.child(div().flex_none().px(7).py(1).rounded_full().bg(C.warmWash).text_size(10.5).font_semibold().text_color(C.warm).child("stale")))
      .child(right);
  }

  render() {
    const r = shared("rest") ?? {}, now = Date.now();
    const stretch = keyStretch(now);
    // A choice, Wii-menu style: a white rounded card that turns cyan when picked.
    // Two choices of the same size, not the same pull: the break is a filled cyan call
    // to action; "too locked in" looks almost disabled (it still works).
    const option = (id, title, caption, inviting) => {
      const on = this.choice === id;
      const bg = inviting ? (on ? C.skyDark : C.sky) : on ? C.off : "#00000000";
      const fg = inviting ? "#ffffff" : C.offInk;
      return h_flex().id(`choice-${id}`).flex_1().min_w(0).h(56).px(12).gap(10).items_center().rounded(14).cursor_pointer()
        .bg(bg).border_2().border_color(inviting ? (on ? C.skyDark : C.sky) : on ? C.faint : C.off)
        .hover((s) => inviting ? s.bg(C.skyDark).border_color(C.skyDark) : s.border_color(C.faint))
        .on_click((_e, cx) => { this.choice = on ? null : id; cx.notify(); })
        .child(div().size(18).flex_none().rounded(5).border_2()
          .border_color(inviting ? "#ffffff" : on ? C.faint : C.offInk).bg(on ? (inviting ? "#ffffff" : C.faint) : "#00000000")
          .flex().items_center().justify_center().text_size(12).font_bold().text_color(inviting ? C.skyDark : "#ffffff").child(on ? "✓" : ""))
        .child(v_flex().min_w(0)
          .child(div().text_size(12.5).font_semibold().text_color(fg).child(title))
          .child(div().text_size(10.5).text_color(inviting ? "#e3f3fd" : C.offInk).truncate().child(caption)));
    };
    const ready = Boolean(this.choice);

    // The whole window: a dim backdrop that keeps the keyboard and the mouse (no Esc, no
    // click-away, no dragging), with the card in the middle.
    return div().id("rest-backdrop").size_full().flex().items_center().justify_center().bg("#000000a6")
      .track_focus(this.handle)
      .on_key_down((_e, cx) => cx.stop_propagation())
      .on_mouse_down("left", (_e, cx) => { this.handle.focus(); cx.stop_propagation(); })
      .child(this.card(r, now, stretch, option, ready));
  }

  card(r, now, stretch, option, ready) {
    const snoozeMs = shared("rest.config")?.snoozeMs;
    // Medium: 440 wide. The picture (1230 x 716) runs edge to edge across the top and
    // fades into the card's gray; without one, a soft blue sun.
    return v_flex().id("rest").w(440).max_h_full().rounded(24).overflow_hidden().bg(C.card).text_color(C.ink).shadow_2xl()
      .child(this.art
        ? image(ART).w(440).h(256).flex_none().rounded_t(24)
        : h_flex().justify_center().pt(26).child(div().size(56).rounded_full().bg(C.skyWash).flex().items_center().justify_center()
          .child(div().size(26).rounded_full().bg(C.sky))))
      .child(v_flex().px(24).pt(this.art ? 4 : 14).pb(22).gap(14)
        .child(v_flex().gap(5).items_center()
          .child(div().text_size(21).font_bold().text_color(C.ink).child("Time for a breather?"))
          .child(div().text_size(13).text_color(C.soft).text_center()
            .child(`${stretch > 60_000 ? dur(stretch) : "A while"} hands on keyboard. Stand up, stretch, step outside.`)))
        // Sessions to tidy up
        .child(v_flex().gap(6)
          .child(h_flex().items_center()
            .child(div().flex_1().text_size(10.5).font_semibold().text_color(C.faint).child("TIDY UP")))
          .child(this.sessions === null
            ? div().text_size(12).text_color(C.soft).child("Looking at your sessions…")
            : this.sessions.length === 0
              ? div().text_size(12).text_color(C.soft).child("Nothing to tidy up.")
              : v_flex().id("rest-sessions").gap(5).children(this.sessions.slice(0, MAX_ROWS).map((s) => this.row(s)))))
        // Footer: pick one, then Back to it
        .child(v_flex().gap(10)
          .child(h_flex().gap(8)
            .child(option("break", "I took a break", "walk, stretch, water", true))
            .child(option("locked", "I'm too locked in", snoozeMs ? `ask me again in ${dur(snoozeMs)}` : "ask me again later", false)))
          // A centered text button under the two: cyan "Back to it" after a break, a gray
          // "Snooze 20 min" after skipping, faint (off) until you pick.
          .child(h_flex().justify_center()
            .child(div().id("back").px(10).py(4).rounded(8).text_size(13).font_semibold()
              .text_color(this.choice === "break" ? C.skyDark : this.choice === "locked" ? C.soft : C.offInk)
              .when(ready, (el) => el.cursor_pointer().hover((s) => s.bg(this.choice === "break" ? C.skyWash : C.off)).on_click(() => this.done()))
              .child(this.choice === "locked" ? `Snooze ${snoozeMs ? dur(snoozeMs) : ""}`.trim() : "Back to it")))));
  }
}
