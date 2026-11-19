// Notes: your own daily notes, in the side panel ("notes" in panel-body), opened from the
// top bar button (props.button) or Len commands. One plain markdown file per day, so any
// editor can open them:
//   ~/src/notes/daily/YYYY-MM-DD.md   "# Wed 2026-11-18", "## Today" (the one most
//                                     important thing, one line), "## Notes" (free text)
// ‹ › step one calendar day (forward up to tomorrow); the header says Today / Yesterday /
// k days ago / Tomorrow, with the full date as a caption and a Today button. Today's line also shows on
// the top bar button ("Notes: …"), where you look when you pick what to do next. A new day
// with no priorities offers to carry over the last day's.
// The notepad shows rendered markdown; click it to edit, click away to render again.
// Edits save about half a second after you stop typing. Files are read and
// written with len-kit.js (readText, writeText: home is outside ~/.config/herdr-app).
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState, TextView, InputState, Input } from "gpui-base";
import { theme, exec, run, props, shared, setShared, home, nextCommand, settings } from "herdr";
import { readText as read, writeText as write, panelShown, togglePanel } from "./len-kit.js";

const DIR = `${home()}/src/notes/daily`;
const SAVE_MS = 500;
const MAX_BUTTON_PX = 480; // the top bar button grows with its text up to this
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n) => String(n).padStart(2, "0");
const dateOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fileOf = (date) => `${DIR}/${date}.md`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "Wednesday, Nov 18, 2026"
const longDate = (s) => { const d = new Date(`${s}T12:00:00`); return `${LONG_DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
// "Today", "Yesterday", "3 days ago"
const relative = (s) => {
  const k = Math.round((new Date(`${dateOf(new Date())}T12:00:00`) - new Date(`${s}T12:00:00`)) / 86_400_000);
  return k === 0 ? "Today" : k === 1 ? "Yesterday" : k > 1 ? `${k} days ago` : k === -1 ? "Tomorrow" : `In ${-k} days`;
};

// A day's file -> { today, notes }. Text before the sections counts as notes.
function parseDay(text) {
  const t = text.match(/^## Today\s*\n([\s\S]*?)(?=^## Notes\s*$|(?![\s\S]))/m);
  const n = text.match(/^## Notes\s*\n([\s\S]*)$/m);
  if (!t && !n) return { today: "", notes: text.replace(/^# .*\n?/, "").trim() };
  return { today: (t?.[1] ?? "").trim(), notes: (n?.[1] ?? "").trim() };
}
function composeDay(date, today, notes) {
  const d = new Date(`${date}T12:00:00`);
  return `# ${DAYS[d.getDay()]} ${date}\n\n## Today\n\n${today.trim()}\n\n## Notes\n\n${notes.trim()}\n`;
}
export const firstLine = (body) => (body.split("\n").map((l) => l.replace(/^\s*(- \[[ xX]\]|\d+[.)]|[-*•])\s*/, "").trim()).find(Boolean) ?? "");

export default class Notes extends View {
  init(_props, cx) {
    if (props()?.button) {
      this.kind = "button";
      const panels = shared("workspace.panels") ?? ["changes"];
      if (!panels.includes("notes")) setShared("workspace.panels", [...panels, "notes"]);
      // Today's #1, from today's note (the panel also shares it at once on save).
      this.todayLine = "";
      const readToday = (cx) => cx.spawn(async (cx) => {
        this.todayLine = firstLine(parseDay(await read(fileOf(dateOf(new Date())))).today);
        cx.notify();
      });
      readToday(cx);
      cx.timer.every(10_000, (cx) => readToday(cx));
      return;
    }
    this.kind = "panel";
    this.date = dateOf(new Date());
    this.days = [];              // dates with a file, oldest first
    this.carry = null;           // { date, today } when today has no priorities yet
    this.loaded = false;
    this.editing = false;        // the notepad: editor (true) or rendered markdown (false)
    this.typing = { today: false, notes: false };
    this.seq = 0;                // each open() gets a number; a slower, older one is ignored
    this.makeFields("", "");
    this.open(this.date, cx);
    // Key/CLI commands for this panel: notes.prev, notes.next, notes.today.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "prev") this.step(-1, cx);
        else if (c === "next") this.step(1, cx);
        else if (c === "today") this.open(dateOf(new Date()), cx);
        cx.notify();
      }
    });
    // Picks up edits made elsewhere: another editor, every 5 s (or at once on shared notes.changed).
    this.seenChange = shared("notes.changed") ?? 0;
    this.lastRefresh = Date.now();
    cx.timer.every(1_000, (cx) => {
      const changed = shared("notes.changed") ?? 0;
      if (changed !== this.seenChange || Date.now() - this.lastRefresh > 5_000) {
        this.seenChange = changed; this.lastRefresh = Date.now();
        this.refresh(cx);
      }
    });
  }

  // Fresh fields for a day, filled from the start. Setting text on the old fields was not
  // reliable (set_value("") keeps the old text), so each day gets its own fields.
  makeFields(todayText, notesText) {
    this.today?.release(); this.notes?.release();
    this.typing = { today: false, notes: false };
    // One line by design: it makes you pick the one thing, and say it briefly.
    this.today = InputState.new({ placeholder: "", value: todayText });
    this.today.on("submit", (_e, cx) => { this.pending = null; this.save(cx); });
    this.notes = TextareaState.new({ placeholder: "", value: notesText });
    for (const [key, state] of [["today", this.today], ["notes", this.notes]]) {
      state.on("focus", () => { this.typing[key] = true; });
      state.on("blur", (_e, cx) => {
        this.typing[key] = false;
        if (this.pending) { this.pending = null; this.save(cx); } // also save on leaving the field
        if (key === "notes") { this.editing = false; cx.notify(); }
      });
      state.on("change", (_e, cx) => this.changed(cx));
    }
    this.shown = { today: todayText, notes: notesText }; // what the fields started with
  }

  open(date, cx) {
    // Unsaved typing belongs to the day it was typed on: save it before switching.
    if (this.pending) { this.pending = null; this.save(cx); }
    const seq = ++this.seq;
    this.date = date; this.loaded = false; this.editing = false;
    this.openedOn = dateOf(new Date()); // the calendar date when this day was opened
    cx.spawn(async (cx) => {
      const day = parseDay(await read(fileOf(date)));
      await this.listDays();
      let carry = null;
      if (date === dateOf(new Date()) && !day.today) {
        const before = this.days.filter((d) => d < date).at(-1);
        const prev = before ? parseDay(await read(fileOf(before))).today : "";
        if (prev) carry = { date: before, today: prev };
      }
      if (seq !== this.seq) return; // you already moved on to another day
      this.makeFields(firstLine(day.today), day.notes);
      this.carry = carry;
      this.loaded = true;
      cx.notify();
    });
  }

  refresh(cx) {
    const date = this.date, seq = this.seq;
    cx.spawn(async (cx) => {
      // Midnight: you were on that day's "today" and the date has changed since.
      const now = dateOf(new Date());
      if (!this.typing.today && !this.typing.notes && date === this.openedOn && now !== this.openedOn) { this.open(now, cx); return; }
      const day = parseDay(await read(fileOf(date)));
      // Only for the day still shown, while you're not typing, and only if the file
      // changed elsewhere (another editor) since the fields were filled.
      if (seq !== this.seq || this.typing.today || this.typing.notes || this.pending) return;
      const today = firstLine(day.today);
      if (today !== this.shown.today && today !== this.today.value() || day.notes !== this.shown.notes && day.notes !== this.notes.value()) {
        this.makeFields(today, day.notes);
        cx.notify();
      }
    });
  }

  async listDays() {
    const r = await exec("sh", ["-c", 'ls "$0" 2>/dev/null', DIR]);
    this.days = r.stdout.split("\n").map((f) => f.match(/^(\d{4}-\d\d-\d\d)\.md$/)?.[1]).filter(Boolean).sort();
  }

  // Saves after a short pause in typing.
  changed(cx) {
    if (!this.loaded) return;
    this.pending = Date.now();
    cx.timer.after(SAVE_MS + 50, (cx) => {
      if (!this.pending || Date.now() - this.pending < SAVE_MS) return;
      this.pending = null;
      this.save(cx);
    });
  }

  save(cx) {
    const date = this.date, today = this.today.value(), notes = this.notes.value();
    // Never create a file for a day with nothing in it (browsing an empty day, for one).
    if (!today.trim() && !notes.trim() && !this.days.includes(date)) return;
    write(fileOf(date), composeDay(date, today, notes)).then(() => this.listDays()).then(() => cx.notify());
    if (date === dateOf(new Date())) {
      this.carry = null;
      setShared("notes.today", { line: firstLine(today), at: Date.now() }); // the status bar shows it at once
    }
  }

  // ‹ › step one calendar day. Back: any day, with or without a note. Forward: up to
  // tomorrow (to plan it), so › is disabled on tomorrow.
  shifted(date, k) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + k);
    return dateOf(d);
  }

  canStepForward() {
    return this.date < this.shifted(dateOf(new Date()), 1);
  }

  step(dir, cx) {
    if (dir > 0 && !this.canStepForward()) return;
    this.open(this.shifted(this.date, dir), cx);
  }

  button(t) {
    const on = panelShown("notes");
    const sharedLine = shared("notes.today");
    const line = sharedLine && Date.now() - sharedLine.at < 15_000 ? sharedLine.line : this.todayLine;
    // The layout slot is fixed px, so it follows the button: an invisible copy of the
    // button, with room to grow, reports its natural width, and the slot is set to that.
    // Without this, the slot's empty part sits between Changes and the button.
    const content = (el, measure) => el
      .child(svg("mods/workspace-chrome/square-pen.svg").size(14).flex_none())
      .child(div().flex_none().child(line ? "Notes:" : "Notes"))
      // Today's most important thing, so it stays on screen.
      .when(Boolean(line), (el) => measure
        ? el.child(div().flex_none().whitespace_nowrap().child(line))
        : el.min_w(0).child(div().min_w(0).truncate().text_color(t.foreground).child(line)));
    const pill = () => h_flex().h(26).px(8).gap(6).items_center().rounded(6).text_size(12);
    return h_flex().size_full().relative().items_center().justify_end().bg(t.chrome)
      .child(h_flex().absolute().top(0).left(0).w(1200).h_full().items_center().opacity(0) // a row, so the copy takes its own width
        .child(content(pill().id("notes-measure").flex_none(), true)
          .on_size_change((size) => {
            // The size comes zoomed (settings().zoom); the slot's px are not.
            const px = Math.min(MAX_BUTTON_PX, Math.ceil(size.width / (Number(settings()?.zoom) || 1)) + 2);
            if (Math.abs(px - (this.slotPx ?? 0)) > 1) { this.slotPx = px; run("layout.resize", { id: "notes-btn", px }); }
          })))
      .child(content(pill().id("notes-button")
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
        .on_click(() => togglePanel("notes")), false));
  }

  section(title, extra, t) {
    return h_flex().px(2).pt(10).pb(4).gap(8).items_center()
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(title))
      .child(div().flex_1())
      .when(Boolean(extra), (el) => el.child(extra));
  }

  small(id, label, onClick, t, disabled = false) {
    return div().id(id).px(6).py(2).rounded(5).text_size(11).border_1().border_color(t.border).bg(t.raised)
      .text_color(disabled ? t.dim : t.muted)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick))
      .child(label);
  }

  render() {
    const t = theme();
    if (this.kind === "button") return this.button(t);
    const today = dateOf(new Date());
    const notesText = this.notes.value();
    return v_flex().id("notes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // Header: ‹ Today/Yesterday/k days ago ›, the full date as a caption, a Today
      // button when you're on another day, show in Finder.
      .child(h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(this.small("day-prev", "‹", (_e, cx) => this.step(-1, cx), t))
        .child(div().px(4).font_semibold().child(relative(this.date)))
        .child(this.small("day-next", "›", (_e, cx) => this.step(1, cx), t, !this.canStepForward()))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).truncate().child(longDate(this.date)))
        .when(this.date !== today, (el) => el.child(this.small("day-today", "Today", (_e, cx) => this.open(today, cx), t)))
        .child(div().text_size(11).text_color(t.dim).child("·"))
        .child(div().id("notes-open").text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          // In Finder, with the day's file selected (`open -R`); a day with no file yet shows
          // the folder. Plain `open` would start the .md app (Xcode).
          .on_click(() => exec("open", this.days.includes(this.date) ? ["-R", fileOf(this.date)] : [DIR])).child("show in Finder")))
      .child(v_flex().flex_1().min_h(0).px(12).pb(12).gap(2)
        // Today's priorities
        .child(this.section("MOST IMPORTANT", null, t))
        .when(Boolean(this.carry), (el) => el.child(h_flex().px(10).py(6).mb(4).gap(8).items_center().rounded(8).bg(t.raised)
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(`${relative(this.carry.date)}: ${firstLine(this.carry.today)}`))
          .child(this.small("carry", "Carry over", (_e, cx) => { this.makeFields(firstLine(this.carry.today), this.notes.value()); this.loaded = true; this.save(cx); cx.notify(); }, t))))
        .child(h_flex().w_full().h(38).px(10).items_center().rounded(8).border_1().border_color(t.border).bg(t.background)
          .child(Input.new(this.today).flex_1().h_full().text_size(13.5).text_color(t.foreground)))
        // Notes: rendered until clicked
        .child(this.section("NOTES", this.editing ? div().text_size(10.5).text_color(t.dim).child("editing · click away to render") : null, t))
        .child(div().id("notes-body").flex_1().min_h(80).w_full().relative().rounded(8).border_1()
          .border_color(this.editing ? t.accent : t.border).bg(t.background)
          .when(!this.editing, (el) => el.cursor_text().on_click((_e, cx) => {
            this.editing = true; cx.notify();
            cx.timer.after(30, () => this.notes.focus());
          }))
          .child(this.editing
            ? div().absolute().inset_0().px(10).py(8).child(Textarea.new(this.notes).size_full().text_size(12.5).text_color(t.foreground))
            : div().absolute().inset_0().px(10).py(8).overflow_y_scroll().id("notes-md").child(notesText.trim()
              ? TextView.markdown(`notes-md-${this.date}`, notesText).text_size(12.5).text_color(t.foreground)
              : div().text_size(12.5).text_color(t.dim).child("Click to write")))));
  }
}
