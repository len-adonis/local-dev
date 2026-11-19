// Databases popup, opened from "DB ● ●" in the status bar or Len commands. A general
// access dashboard: everything it shows and runs comes from ~/.config/herdr-app/local/db.json
// (not in git; copy db.example.json beside this file to start). State comes from
// my-status/db-watch.js as shared("db.status").
// - `access` (optional): Teleport sign-in (`tsh login --proxy … --auth …`) and one
//   access request for the app `access.app`: request it (`tsh request create --resource …
//   --reason … --nowait`, the same resources as the last request), use it once approved
//   (`tsh login --request-id`), open `access.shell` in a new tab, or turn it off
//   (`tsh request drop <id>`).
// - `rows`: one line each. A row with `pg` gets a status dot. Its buttons are
//   `buttons[<state>]` (states: up, down, hidden, auth, lookup), else `buttons["*"]`.
//   A button has a `cmd` (run with sh in `cwd`) or a `url`, and may have:
//   `busy`/`done` (messages), `timeout` (seconds), `needsSignIn`, `onlyWhen` (a state),
//   and `dropAccess` (turn the access request off first).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, exec, notify, props, closeOverlay, shared, setShared, run, spaces, home, checking } from "herdr";
import { clock, loadLocal } from "./len-kit.js";

const left = (ms) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  return m < 60 ? `${m}m left` : `${Math.floor(m / 60)}h ${m % 60}m left`;
};
const expand = (p) => p.replace(/^~(?=\/|$)/, home());
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export default class Databases extends View {
  init(_props, cx) {
    this.busy = null;
    this.asking = false; // the access request's reason box is open
    this.cfg = undefined; // undefined: loading; null: no local/db.json
    this.reason = this.reasonBox("Reason");
    cx.spawn(async (cx) => {
      this.cfg = await loadLocal("db");
      const a = this.cfg?.access;
      if (a) this.reason = this.reasonBox(`Reason for ${a.label.toLowerCase()}${a.reasonHint ? ` (for example: ${a.reasonHint})` : ""}`);
      cx.notify();
    });
    if (!checking()) setShared("db.poke", Date.now()); // fresh state when the popup opens
  }

  reasonBox(placeholder) {
    const box = InputState.new({ placeholder });
    box.on("submit", (_e, cx) => this.request(cx));
    return box;
  }

  // Runs steps in order; stops at the first that fails and shows its last lines.
  steps(label, cmds, cx, done) {
    this.busy = label;
    cx.notify();
    cx.spawn(async (cx) => {
      for (const [cmd, args, timeout] of cmds) {
        const r = await exec(cmd, args, { timeout: timeout ?? 120_000 });
        if (r.code !== 0) {
          const tail = (r.stderr || r.stdout).trim().split("\n").slice(-3).join("\n");
          notify({ title: `${label} failed`, body: tail, level: "error", timeout: 12_000 });
          this.busy = null;
          setShared("db.poke", Date.now());
          cx.notify();
          return;
        }
      }
      if (done) notify({ title: done, level: "success", timeout: 4000 });
      this.busy = null;
      setShared("db.poke", Date.now()); // ask db-watch for a fresh check
      cx.notify();
    });
  }

  sh(cmd, timeout) { return ["sh", ["-c", `cd ${quote(expand(this.cfg.cwd ?? "~"))} && ${cmd}`], timeout ? timeout * 1000 : undefined]; }
  drop(id) { return ["tsh", ["request", "drop", id]]; }
  signIn() { const a = this.cfg.access; return ["tsh", ["login", `--proxy=${a.proxy}`, ...(a.auth ? [`--auth=${a.auth}`] : [])], 300_000]; }

  request(cx) {
    const a = this.cfg?.access, reason = this.reason.value().trim();
    if (!a || !reason) return;
    const resources = shared("db.status")?.request?.resources ?? [`/${a.proxy}/app/${a.app}`];
    this.asking = false;
    this.steps(`Requesting ${a.label.toLowerCase()}`, [["tsh", ["request", "create", ...resources.flatMap((r) => ["--resource", r]), "--reason", reason, "--nowait"]]],
      cx, `${a.label} requested: waiting for approval`);
  }

  shell() {
    const s = this.cfg.access.shell, space = spaces().find((x) => x.active);
    run("tab.new", { name: s.tab ?? "shell", space: space?.id, folder: expand(this.cfg.cwd ?? "~"), argv: ["sh", "-c", s.cmd] });
    closeOverlay(props().overlay);
  }

  open(url) { exec("open", [url]); closeOverlay(props().overlay); }

  dot(state, t) {
    const c = state === "up" ? t.ansi2 : state === "down" ? t.ansi1 : t.blocked;
    return div().size(8).flex_none().rounded(4).bg(c);
  }

  button(id, label, onClick, t, disabled = false) {
    return div().id(id).px(8).py(3).rounded(5).text_size(11).border_1().border_color(t.border)
      .bg(t.raised).text_color(disabled ? t.dim : t.foreground)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
      .child(label);
  }

  row(dotState, title, detail, buttons, t) {
    return h_flex().gap(10).items_center().py(5)
      .child(dotState === null ? div().size(8).flex_none() : this.dot(dotState, t))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_color(t.foreground).child(title))
        .child(div().text_size(11).text_color(t.dim).truncate().child(detail)))
      .child(h_flex().gap(6).children(buttons));
  }

  // Teleport sign-in and the access request.
  accessRows(t, d, b) {
    const a = this.cfg.access, tp = d?.teleport, req = d?.request, on = d?.accessOn, name = a.label.toLowerCase();
    const teleportRow = this.row(tp ? (tp.signedIn ? "up" : "down") : "unknown", "Teleport",
      tp?.signedIn ? `Signed in · ${left(tp.until)}` : tp ? "Signed out" : "checking…",
      tp && !tp.signedIn ? [this.button("tp-in", "Sign in", (_e, cx) => this.steps("Signing in to Teleport", [this.signIn()], cx, "Signed in to Teleport"), t, b)] : [], t);

    let state = "down", text = "Off", buttons = [];
    if (on) {
      state = "up";
      text = `On · until ${clock(req.expires)}${req.reason ? ` · ${req.reason}` : ""}`;
      buttons = [
        ...(a.shell ? [this.button("ac-shell", a.shell.label ?? "Shell", () => this.shell(), t, b)] : []),
        this.button("ac-off", "Turn off", (_e, cx) => this.steps(`Turning off ${name}`, [this.drop(req.id)], cx, `${a.label} off`), t, b),
      ];
    } else if (req?.state === "approved" && req.expires > Date.now()) {
      state = "unknown";
      text = `Approved, not in use · until ${clock(req.expires)}`;
      buttons = [this.button("ac-use", "Use", (_e, cx) => this.steps(`Turning on ${name}`, [["tsh", ["login", `--proxy=${a.proxy}`, `--request-id=${req.id}`]]], cx, `${a.label} on`), t, b)];
    } else if (req?.state === "pending") {
      state = "unknown";
      text = `Waiting for approval${req.reason ? ` · ${req.reason}` : ""}`;
    } else {
      buttons = [this.button("ac-req", "Request…", (_e, cx) => { this.asking = true; this.reason.focus(); cx.notify(); }, t, b || !tp?.signedIn)];
    }
    return [teleportRow, this.row(state, a.label, text, buttons, t)];
  }

  // One configured row: its dot, text and buttons for its current state.
  configRow(r, t, d, b) {
    const s = d?.rows?.find((x) => x.id === r.id), state = r.pg ? (s?.state ?? "unknown") : null;
    const signedIn = Boolean(d?.teleport?.signedIn), req = d?.request;
    const key = state === "hidden" ? (d?.accessOn ? "hidden" : "down") : state === "unknown" ? "down" : state;
    const list = (key && r.buttons?.[key]) ?? r.buttons?.["*"] ?? [];
    const text = (state && r.text?.[state]) ?? r.detail ?? (state === "unknown" ? "checking…" : "");
    const buttons = list.map((btn, i) => {
      const id = `${r.id}-${i}`;
      if (btn.url) return this.button(id, btn.label, () => this.open(btn.url), t);
      const disabled = b || (btn.needsSignIn && !signedIn) || (btn.onlyWhen && state !== btn.onlyWhen) || (btn.dropAccess && !req?.id);
      const cmds = [...(btn.dropAccess && req?.id ? [this.drop(req.id)] : []), ...(btn.cmd ? [this.sh(btn.cmd, btn.timeout)] : [])];
      return this.button(id, btn.label, (_e, cx) => this.steps(btn.busy ?? btn.label, cmds, cx, btn.done), t, disabled);
    });
    return this.row(state, r.title, text, buttons, t);
  }

  render() {
    const t = theme(), d = shared("db.status"), b = Boolean(this.busy);
    const root = v_flex().id("db-popup").w_full().p(14).gap(2).bg(t.popover).text_size(13)
      .child(h_flex().items_center().pb(4)
        .child(div().flex_1().font_semibold().text_color(t.foreground).child("Databases"))
        .child(div().text_size(11).text_color(t.dim).child(this.busy ? `${this.busy}…` : d?.at ? "up to date" : "checking…")));
    if (this.cfg === undefined) return root;
    if (this.cfg === null) return root.child(div().text_color(t.dim).child(
      "No settings yet. Copy mods/db/db.example.json to ~/.config/herdr-app/local/db.json and fill it in."));
    return root
      .when(Boolean(this.cfg.access), (el) => el.children(this.accessRows(t, d, b)))
      .when(this.asking, (el) => el.child(h_flex().h(32).ml(18).px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.reason).flex_1().h_full().text_size(12).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child("↵ send"))))
      .when(Boolean(this.cfg.access), (el) => el.child(div().h(1).my(4).bg(t.border)))
      .children((this.cfg.rows ?? []).map((r) => this.configRow(r, t, d, b)));
  }
}
