// Len commands: a personal command palette (cmd-shift-k).
// Type to filter, up/down to choose, Enter to run, Esc to close.
// Any text that matches no command can be searched in Glean, which opens in the
// focused space's own Chrome window (the one the top bar "Chrome" button uses).
// To add a command, add an entry to COMMANDS.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, props, closeOverlay, openOverlay, checking, run, home } from "herdr";
import { togglePanel, openInSpaceChrome, nextMeeting, googleCalendarUrl } from "./len-kit.js";

const GLEAN = "https://app.glean.com";

// The link for "Next meeting in Google Calendar". Built each time the palette opens.
const GCAL = "https://calendar.google.com/calendar/r";
let links = { cal: GCAL };
async function meetingLinks() {
  const m = await nextMeeting();
  links = { cal: m ? await googleCalendarUrl(m) : GCAL };
}

const COMMANDS = [
  { id: "notes", title: "Notes", words: "notes notepad today priorities intentions focus", run: () => togglePanel("notes") },
  { id: "glean", title: "Search Glean", words: "glean search docs company wiki", query: true,
    run: (q) => openInSpaceChrome(q ? `${GLEAN}/search?q=${encodeURIComponent(q)}` : GLEAN) },
  { id: "rest", title: "Take a break (preview)", words: "rest break reminder walk breather debug wii", run: () =>
      openOverlay({ mod: "rest", props: { preview: true }, kind: "window", frame: "none", key: "rest", width: 1, height: 1, at: { x: 0, y: 0 } }) },
  // Opens a link built when the palette opened (see meetingLinks): the palette closes
  // before a command runs, and work it still awaits then never finishes.
  { id: "meeting-cal", title: "Next meeting in Google Calendar", words: "meeting calendar google gcal event next",
    run: () => openInSpaceChrome(links.cal) },
  // A real blocked alert: a background tab whose agent asks a question. Not `hc run`:
  // a sub-agent's alert goes to its parent agent, and no sound plays.
  // Sound files: ~/.config/herdr-app/sounds (rebuild with make-sounds.sh).
  { id: "test-alert", title: "Test alert sound (blocked)", words: "test alert sound blocked notification washer chime", run: () =>
      run("tab.new", { name: "sound test", folder: home(), argv: ["claude", "--permission-mode", "default"], focus: false,
        task: "This is a test of Herdr's blocked alert sound. Use the AskUserQuestion tool to ask: Did you hear the alert sound? with options Yes and No. Then tell me to close this tab." }) },
  { id: "db", title: "Databases", words: "db database tunnel tableplus postgres teleport access", run: () =>
      openOverlay({ mod: "db", kind: "popup", width: 480, height: 360 }) },
];

export default class LenCommands extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = 0;
    this.handle = cx.focus_handle();
    if (!checking()) cx.spawn(() => meetingLinks());
    this.input = InputState.new({ placeholder: "Len commands… (or type to search Glean)" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
  }

  // Commands that match; with text typed, a "Search Glean for …" row too
  // (first when no command matches).
  rows() {
    const f = this.filter.trim().toLowerCase();
    const hits = COMMANDS.filter((c) => !f || `${c.title} ${c.words}`.toLowerCase().includes(f)).map((c) => ({ ...c, q: "" }));
    if (!f) return hits;
    const glean = COMMANDS.find((c) => c.id === "glean");
    const search = { ...glean, id: "glean-q", title: `Search Glean for “${this.filter.trim()}”`, q: this.filter.trim() };
    return hits.length ? [...hits.filter((c) => c.id !== "glean"), search] : [search];
  }

  go(row) {
    if (!row) return;
    closeOverlay(props().overlay);
    row.run(row.q);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    return v_flex().id("len-commands").track_focus(this.handle).w_full().p(14).gap(8).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        if (e.key === "down") this.at = (this.at + 1) % Math.max(1, rows.length);
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % Math.max(1, rows.length);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().font_semibold().text_color(t.foreground).child("Len commands"))
        .child(div().text_size(11).text_color(t.dim).child("↑↓ choose · ↵ run · Esc close")))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12).text_color(t.foreground)))
      .child(v_flex().gap(2).children(rows.map((r, i) => h_flex().id(`len-${r.id}`).h(30).px(10).gap(8).items_center().rounded(7)
        .cursor_pointer().bg(i === this.at ? t.selected : t.popover).hover((s) => s.bg(t.hover))
        .on_click(() => this.go(r))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.title)))));
  }
}
