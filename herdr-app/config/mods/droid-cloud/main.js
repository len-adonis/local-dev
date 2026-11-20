// Droid sessions: your Factory Droid sessions, cloud and local ("local" = on this Mac),
// in the sidebar under Agents, drawn like Agents rows. Droids open in Herdr tabs already
// show in Agents (live status and a droid_session label, both from
// ~/.factory/hooks/herdr-status.sh), so they're left out here. Empty sessions too.
//
// Data: Factory API (https://api.factory.ai/api/v0), key from the macOS Keychain
// (`security … -s factory-api-key`), kept in a module variable only:
//   GET /sessions, GET /sessions/<id>/elicitations (open questions),
//   GET /sessions/<id>/messages?role=user|assistant (newest first, paged: the conversation),
//   POST /sessions/<id>/messages {text} (reply), POST /sessions/<id>/interrupt (stop),
//   GET /computers/<id> (is its cloud computer online).
// Sessions can hold PHI: the conversation is shown only when you open a session, kept
// in memory only, never on disk; errors show the HTTP status only.
//
// Groups like Agents: Pinned, Needs you (an open question), Working (running/pending),
// Done (finished since you last opened it: the API only says idle/pending/running), Idle.
// "offline": its computer is missing, not active, not running, or silent for 3 minutes.
// Click a row: a dialog with the conversation (your messages and Droid's replies, as
// markdown; tool calls and thinking left out; Load earlier pages back), a box to answer, Open in Factory app
// (factory-desktop://sessions/<id>; the app routes host+path to its /sessions/<id> page)
// and, while it runs, Stop. Hover: the pin.
// One module, two copies: the panel (a layout block) and the dialog (props.preview). The
// dialog can't touch the panel's storage (each copy has its own), so it sends commands
// through shared("droid-cloud.cmd"). Kept quiet on purpose: high-autonomy background sessions.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, ScrollHandle, TextView } from "gpui-base";
import { theme, exec, notify, home, props, openOverlay, closeOverlay, shared, setShared, spaces, run, checking } from "herdr";
import { keychain, ago as age, sh } from "./len-kit.js";

const API = "https://api.factory.ai/api/v0";
const APP = (id) => `factory-desktop://sessions/${id}`;
const RECENT_MS = 7 * 24 * 3600_000;
const OFFLINE_AFTER_MS = 3 * 60_000;
const CMD = "droid-cloud.cmd";

let apiKey = null, thisMac = null;
async function key() {
  if (apiKey) return apiKey;
  apiKey = await keychain("factory-api-key", home().split("/").pop());
  return apiKey;
}
async function api(path, body) {
  const k = await key();
  if (!k) return { error: "No Factory key in the Keychain" };
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${k}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res) return { error: "Network error" };
  if (res.status === 401) apiKey = null; // read the key again next time
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return { value: await res.json() };
}
// This Mac's computer id, so its sessions (local) are left out.
async function localComputer() {
  if (thisMac) return thisMac;
  const r = await sh("jq -r .computerId ~/.factory/computer.json");
  thisMac = r.code === 0 ? r.stdout.trim() : "";
  return thisMac;
}
// Online: active, running, and checked in recently. null: unknown (network).
async function computerOnline(id) {
  const r = await api(`/computers/${id}`);
  if (r.error) return r.error === "HTTP 404" ? false : null;
  const c = r.value;
  return c.status === "active" && (c.providerStatus === "running" || c.providerType === "byom") && Date.now() - (Number(c.lastSeenAt) || 0) < OFFLINE_AFTER_MS;
}
// A local session's folder: line 1 of ~/.factory/sessions/<slug>/<id>.jsonl is
// {"type":"session_start","cwd":…}. Take it from there: the folder slug is lossy.
async function sessionFolder(id) {
  const r = await sh('f=$(find ~/.factory/sessions -maxdepth 2 -name "$0.jsonl" | head -1); [ -n "$f" ] && head -n 1 "$f" | jq -r ".cwd // empty"', id);
  const dir = r.code === 0 ? r.stdout.trim() : "";
  if (!dir) return null;
  const ok = await exec("test", ["-d", dir]);
  return ok.code === 0 ? dir : null;
}

// One page of a role's messages (newest first), keeping only ones with readable text:
// tool calls, tool results and thinking are left out. Most messages are tool traffic,
// so user and assistant are fetched separately (role filter) and merged by time.
async function textPage(id, role, cursor) {
  const q = `role=${role}&limit=${role === "user" ? 10 : 30}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const r = await api(`/sessions/${id}/messages?${q}`);
  if (r.error) return { error: r.error };
  const items = [];
  for (const m of r.value.messages ?? []) {
    const text = (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n\n").trim();
    if (text && m.isUserVisible !== false) items.push({ id: m.id, role, text, at: m.createdAt });
  }
  return { items, cursor: r.value.pagination?.nextCursor ?? null, more: Boolean(r.value.pagination?.hasMore) };
}

const send = (cmd) => setShared(CMD, { ...cmd, at: Date.now() });

// Conversations already loaded, by session: { updatedAt, items, cursor, more }. Module
// level, so every dialog copy shares it; memory only (PHI): gone when Herdr quits.
const convos = new Map();
const CACHE_SESSIONS = 10;
function remember(id, entry) {
  convos.delete(id);
  convos.set(id, entry);
  while (convos.size > CACHE_SESSIONS) convos.delete(convos.keys().next().value);
}

export default class DroidCloud extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.preview) { this.kind = "preview"; this.initPreview(p.preview, cx); return; }
    this.kind = "panel";
    this.sessions = null; this.error = null; this.at = 0; this.busyUntil = 0; this.hovered = null;
    this.pinned = new Set(JSON.parse(localStorage.getItem("pinned") ?? "[]"));
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    // seen[id] = the session's updatedAt when you last opened it. null until the first
    // load, which marks everything seen so old sessions start as Idle, not Done.
    this.seen = JSON.parse(localStorage.getItem("seen") ?? "null");
    this.online = {}; this.onlineAt = 0; // computerId -> true / false / null
    this.asks = {};                      // sessionId -> open questions
    this.lastCmd = shared(CMD)?.at ?? 0;
    if (checking()) return; // `herdr-app check`: no Factory API calls
    this.poll(cx);
    // Checks every 10 s; every 4 s while a session works or right after you open or
    // answer one (so Working shows up fast).
    cx.timer.every(2_000, (cx) => {
      const busy = Date.now() < this.busyUntil || (this.sessions ?? []).some((s) => s.status !== "idle");
      if (!this.polling && Date.now() - this.at > (busy ? 4_000 : 10_000)) this.poll(cx);
      else cx.notify(); // keeps ages fresh
    });
  }

  // ---- panel ----

  save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  poll(cx) {
    this.at = Date.now();
    this.polling = true;
    cx.spawn(async (cx) => {
      try { await this.load(); } finally { this.polling = false; cx.notify(); }
    });
  }

  async load() {
    const mac = await localComputer();
    const r = await api("/sessions?limit=50");
    if (r.error) { this.error = r.error; return; }
    this.error = null;
    // Local sessions open in a live Herdr terminal (labelled droid_session=<id> by
    // ~/.factory/hooks/herdr-status.sh) already show in Agents: leave them out here.
    // `hc ls --json` names each terminal's agent but leaves labels out, so read each live
    // Droid terminal's label with `hc get` (one local call per Droid tab).
    const HC = `${home()}/.local/bin/hc`;
    let droids = [];
    try { droids = JSON.parse((await exec(HC, ["ls", "--json"])).stdout).terminals.filter((x) => x.state === "live" && x.agent === "droid").map((x) => x.address); } catch {}
    const got = await Promise.all(droids.map((a) => exec(HC, ["get", a])));
    const open = new Set(got.map((g) => { try { return JSON.parse(g.stdout).labels?.droid_session; } catch { return null; } }).filter(Boolean));
    this.sessions = (r.value.sessions ?? [])
      .filter((s) => s.computerId && s.messageCount > 0 && !open.has(s.sessionId))
      .map((s) => ({ ...s, local: s.computerId === mac }))
      .filter((s) => s.status !== "idle" || this.pinned.has(s.sessionId) || Date.now() - s.updatedAt < RECENT_MS)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    // Computers: at most once a minute. Questions: only for sessions not idle.
    if (Date.now() - this.onlineAt > 60_000) {
      this.onlineAt = Date.now();
      const ids = [...new Set(this.sessions.map((x) => x.computerId))];
      const states = await Promise.all(ids.map(computerOnline));
      this.online = Object.fromEntries(ids.map((id, i) => [id, states[i]]));
    }
    const live = this.sessions.filter((x) => x.status !== "idle");
    const asks = await Promise.all(live.map((x) => api(`/sessions/${x.sessionId}/elicitations`)));
    this.asks = Object.fromEntries(live.map((x, i) => [x.sessionId, asks[i].value?.elicitations?.length ?? 0]));
    if (this.seen === null) {
      this.seen = Object.fromEntries(this.sessions.map((s) => [s.sessionId, s.updatedAt]));
      this.save("seen", this.seen);
    }
    // Once: local sessions joined the list later; start the ones you already had as Idle.
    if (!localStorage.getItem("seen-local")) {
      for (const x of this.sessions) if (x.local && !(x.sessionId in this.seen)) this.seen[x.sessionId] = x.updatedAt;
      this.save("seen", this.seen);
      localStorage.setItem("seen-local", "1");
    }
  }

  // Commands from the menu and preview copies.
  takeCommand() {
    const c = shared(CMD);
    if (!c || c.at <= this.lastCmd) return;
    this.lastCmd = c.at;
    const s = (this.sessions ?? []).find((x) => x.sessionId === c.id);
    if (c.action === "pin") { this.pinned.has(c.id) ? this.pinned.delete(c.id) : this.pinned.add(c.id); this.save("pinned", [...this.pinned]); }
    if (c.action === "seen" && s) this.markSeen(s);
    if (c.action === "busy") { this.busyUntil = Date.now() + 3 * 60_000; if (s) this.markSeen(s); }
    if (c.action === "refresh" || c.action === "busy") this.at = 0; // the 2 s timer polls next
  }

  markSeen(s) {
    this.seen = { ...(this.seen ?? {}), [s.sessionId]: s.updatedAt };
    this.save("seen", this.seen);
  }

  state(s) {
    if (this.asks[s.sessionId] > 0) return "blocked";
    if (s.status !== "idle") return "working";
    return s.updatedAt > (this.seen?.[s.sessionId] ?? 0) ? "done" : "idle";
  }

  // Shapes as in Agents: needs you a "!", working a spinner (dim here), done a dot, idle a ring.
  status(t, st) {
    if (st === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.dim).spin(900);
    if (st === "done") return div().size(7).mx(3).flex_none().rounded(4).bg(t.done ?? t.dim);
    return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  // Cloud: the conversation dialog. Local and idle: resume it in a new Herdr tab, in its
  // folder (it then shows in Agents). Local and running: it runs elsewhere (Factory.app or
  // another terminal), so a second copy in a tab would clash: open it in Factory.app.
  activate(s, offline, cx) {
    const id = s.sessionId;
    if (!s.local) {
      openOverlay({ mod: "droid-cloud", kind: "dialog", width: 720, height: 560, props: {
        preview: { id, title: s.title, running: s.status !== "idle", offline, updatedAt: s.updatedAt },
      } });
      return;
    }
    this.markSeen(s);
    if (s.status !== "idle") { exec("open", [APP(id)]); this.busyUntil = Date.now() + 3 * 60_000; return; }
    cx.spawn(async (cx) => {
      const folder = await sessionFolder(id);
      if (!folder) { notify({ title: "Can't resume here", body: "Its folder is gone; opening it in Factory app", level: "warning", timeout: 6000 }); exec("open", [APP(id)]); return; }
      const space = spaces().find((x) => x.active);
      run("tab.new", { name: s.title || "Droid", space: space?.id, folder, argv: ["droid", "--resume", id] });
      this.at = 0; // refresh soon: it leaves this list once its tab labels itself
      cx.notify();
    });
  }

  row(s, t) {
    const id = s.sessionId, st = this.state(s);
    // A running or pending session is clearly connected; only idle ones can be offline.
    const offline = s.status === "idle" && this.online[s.computerId] === false;
    return h_flex().id(`dc-${id}`).px(8).h(30).flex_none().rounded(8).items_center().gap(9).cursor_pointer()
      .hover((x) => x.bg(t.hover))
      .on_hover((on, cx) => { if (on) this.hovered = id; else if (this.hovered === id) this.hovered = null; cx.notify(); })
      .on_click((_e, cx) => this.activate(s, offline, cx))
      .child(image("my-icons/droid.png").size(16).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_color(st === "idle" ? t.muted : t.foreground).child(s.title || "Untitled"))
      .when(offline, (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child("offline")))
      .when(Boolean(s.local), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child("local")))
      .when(this.hovered === id, (el) => el.child(div().id(`dc-pin-${id}`).px(4).h(18).flex().items_center().rounded(4)
        .text_color(t.dim).cursor_pointer().hover((x) => x.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.pinned.has(id) ? this.pinned.delete(id) : this.pinned.add(id);
          this.save("pinned", [...this.pinned]);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${this.pinned.has(id) ? "pin-off" : "pin"}.svg`).size(13))))
      .when(this.hovered !== id, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(age(s.updatedAt))))
      .child(this.status(t, st));
  }

  // A group header like Agents': its title colored by state, folds on click.
  header(g, t) {
    const open = !this.folded.has(g.id);
    return h_flex().id(`dcg-${g.id}`).px(8).pt(8).h(30).flex_none().gap(6).items_center().text_size(11).font_medium()
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => { open ? this.folded.add(g.id) : this.folded.delete(g.id); this.save("folded", [...this.folded]); cx.notify(); })
      .child(div().truncate().text_color(t[g.color] ?? t.dim).child(g.label))
      .child(div().text_color(t.dim).child(String(g.members.length)))
      .child(div().flex_1())
      .when(!open, (el) => el.child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim)));
  }

  renderPanel(t, cx) {
    this.takeCommand();
    const list = this.sessions ?? [];
    const not = (s) => !this.pinned.has(s.sessionId);
    const groups = [
      { id: "pinned", label: "Pinned", color: null, members: list.filter((s) => this.pinned.has(s.sessionId)) },
      { id: "blocked", label: "Needs you", color: "blocked", members: list.filter((s) => not(s) && this.state(s) === "blocked") },
      { id: "working", label: "Working", color: "working", members: list.filter((s) => not(s) && this.state(s) === "working") },
      { id: "done", label: "Done", color: "done", members: list.filter((s) => not(s) && this.state(s) === "done") },
      { id: "idle", label: "Idle", color: null, members: list.filter((s) => not(s) && this.state(s) === "idle") },
    ].filter((g) => g.members.length);
    const rows = groups.flatMap((g) => [this.header(g, t), ...(this.folded.has(g.id) ? [] : g.members.map((s) => this.row(s, t)))]);
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_size(13)
      .child(h_flex().px(16).h(41).pt(14).pb(5).flex_none().items_center().gap(6)
        .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Droid sessions"))
        .child(div().flex_1())
        .child(div().id("dc-refresh").text_size(12).text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.poll(cx)).child("↻")))
      .when(Boolean(this.error), (el) => el.child(div().px(16).text_size(11.5).text_color(t.dim).child(this.error)))
      .when(!this.error && this.sessions && !list.length, (el) => el.child(div().px(16).text_size(11.5).text_color(t.dim).child("No Droid sessions in the last 7 days")))
      .child(v_flex().id("dc-list").flex_1().min_h(0).px(8).overflow_y_scrollbar().children(rows));
  }

  // ---- preview dialog: the last reply, and a box to answer it ----

  initPreview(s, cx) {
    this.s = s; this.sending = false; this.confirmStop = false;
    this.items = []; this.error = null; this.loading = false; this.first = true;
    this.cursor = { user: null, assistant: null }; this.more = { user: true, assistant: true };
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: s.offline ? "Its computer is offline: sending may fail" : "Reply to Droid…" });
    this.input.on("submit", (_e, cx) => this.post(cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    const cached = convos.get(s.id);
    if (!cached) { this.loadEarlier(cx); return; }
    // Seen before: show it at once; fetch only the newest page if the session changed.
    this.items = [...cached.items]; this.cursor = { ...cached.cursor }; this.more = { ...cached.more };
    if (cached.updatedAt === s.updatedAt) { this.opened(cx); return; }
    this.loadNewest(cx);
  }

  opened(cx) {
    if (!this.first) return;
    this.first = false;
    // A plain scroll area's handle has no scroll_to_bottom: reveal the last child instead
    // (the "Load earlier" row, when shown, is child 0, so the last message is items.length).
    const last = this.items.length - 1 + ((this.more.user || this.more.assistant) && this.items.length ? 1 : 0);
    if (last >= 0) cx.timer.after(60, () => this.scroll.scroll_to_item(last));
    send({ action: "seen", id: this.s.id }); // reading it counts as looking
  }

  keep() {
    remember(this.s.id, { updatedAt: this.s.updatedAt, items: this.items, cursor: this.cursor, more: this.more });
  }

  // The session changed since it was cached: add messages newer than what we have.
  loadNewest(cx) {
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const pages = await Promise.all(["user", "assistant"].map((r) => textPage(this.s.id, r, null)));
        const known = new Set(this.items.map((x) => x.id));
        for (const pg of pages) if (!pg.error) this.items.push(...pg.items.filter((x) => !known.has(x.id)));
        this.items.sort((a, b) => a.at - b.at);
        this.keep();
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
      this.opened(cx);
    });
  }

  // Loads older pages until a few more readable messages turn up (at most 4 rounds).
  loadEarlier(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        let found = 0;
        for (let round = 0; round < 4 && found < 6 && (this.more.user || this.more.assistant); round++) {
          const roles = ["user", "assistant"].filter((r) => this.more[r]);
          const pages = await Promise.all(roles.map((r) => textPage(this.s.id, r, this.cursor[r])));
          for (const [k, pg] of pages.entries()) {
            if (pg.error) { this.error = pg.error; this.more[roles[k]] = false; continue; }
            this.cursor[roles[k]] = pg.cursor;
            this.more[roles[k]] = pg.more && Boolean(pg.cursor);
            const known = new Set(this.items.map((x) => x.id));
            const fresh = pg.items.filter((x) => !known.has(x.id));
            this.items.push(...fresh);
            found += fresh.length;
          }
        }
        this.items.sort((a, b) => a.at - b.at);
        if (!this.error) this.keep();
      } catch (e) { this.error = String(e?.message ?? e); }
      this.loading = false;
      cx.notify();
      this.opened(cx);
    });
  }

  post(cx) {
    const text = this.input.value().trim();
    if (!text || this.sending) return;
    this.sending = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await api(`/sessions/${this.s.id}/messages`, { text });
      this.sending = false;
      if (r.error) {
        notify({ title: "Reply not sent", body: `${r.error}${this.s.offline ? " (its computer is offline: open it in Factory app)" : ""}`, level: "error", timeout: 10_000 });
        cx.notify();
        return;
      }
      notify({ title: "Sent to Droid", level: "success", timeout: 3000 });
      send({ action: "busy", id: this.s.id });
      closeOverlay(props().overlay);
    });
  }

  message(m, t) {
    const when = div().text_size(10.5).text_color(t.dim).child(`${m.role === "user" ? "You" : "Droid"} · ${age(m.at)} ago`);
    if (m.role === "user") {
      return v_flex().flex_none().items_end().gap(3).child(when)
        .child(div().max_w(520).px(10).py(7).rounded(9).bg(t.raised).text_size(12.5).text_color(t.foreground).child(m.text));
    }
    return v_flex().flex_none().gap(3).child(when)
      .child(TextView.markdown(`dcm-${m.id}`, m.text).selectable().text_size(12.5).text_color(t.foreground));
  }

  renderPreview(t) {
    const close = () => closeOverlay(props().overlay);
    const more = this.more.user || this.more.assistant;
    const empty = !this.loading && !this.items.length;
    return v_flex().id("dc-preview").size_full().p(16).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e) => { if (e.key === "escape") close(); })
      .child(h_flex().items_center().gap(8)
        .child(image("my-icons/droid.png").size(16).flex_none())
        .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(this.s.title || "Untitled"))
        .when(Boolean(this.s.running), (el) => el.child(div().id("dc-stop").px(8).py(3).rounded(5).text_size(11).border_1().border_color(t.border).bg(t.raised)
          .text_color(this.confirmStop ? t.blocked : t.muted).cursor_pointer().hover((x) => x.bg(t.hover))
          .on_click((_e, cx) => {
            if (!this.confirmStop) { this.confirmStop = true; cx.notify(); return; }
            close();
            api(`/sessions/${this.s.id}/interrupt`, {}).then((r) => {
              notify(r.error ? { title: "Stop failed", body: r.error, level: "error", timeout: 8000 } : { title: "Droid stopped", level: "success", timeout: 3000 });
              send({ action: "refresh", id: this.s.id });
            });
          })
          .child(this.confirmStop ? "Click again to stop" : "Stop")))
        .child(div().id("dc-open-app").px(8).py(3).rounded(5).text_size(11).border_1().border_color(t.border).bg(t.raised)
          .text_color(t.foreground).cursor_pointer().hover((x) => x.bg(t.hover))
          .on_click(() => { exec("open", [APP(this.s.id)]); send({ action: "busy", id: this.s.id }); close(); })
          .child("Open in Factory app")))
      .when(this.s.offline, (el) => el.child(div().text_size(11).text_color(t.dim).child("Its cloud computer is offline. Replying may fail; Factory app may restart it.")))
      .child(div().flex_1().min_h(0).relative().rounded(8).border_1().border_color(t.border).bg(t.background)
        .child(v_flex().id("dc-convo").absolute().inset_0().overflow_y_scroll().track_scroll(this.scroll).p(12).gap(14)
          .when(more && this.items.length > 0, (el) => el.child(h_flex().justify_center().child(
            div().id("dc-earlier").px(8).py(3).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
              .hover((x) => x.bg(t.hover).text_color(t.foreground))
              .on_click((_e, cx) => this.loadEarlier(cx))
              .child(this.loading ? "Loading…" : "Load earlier messages"))))
          .children(this.items.map((m) => this.message(m, t)))
          .when(this.loading && !this.items.length, (el) => el.child(div().text_color(t.dim).child("Loading the conversation…")))
          .when(empty, (el) => el.child(div().text_color(t.dim).child(this.error ? `Couldn't load it (${this.error})` : "No messages yet"))))
        .child(Scrollbar.vertical("dc-convo").absolute().inset_0()))
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.5).text_color(t.foreground))
        .child(div().text_size(11).text_color(t.dim).child(this.sending ? "Sending…" : "↵ send · Esc close")));
  }

  render(cx) {
    const t = theme();
    if (this.kind === "preview") return this.renderPreview(t);
    return this.renderPanel(t, cx);
  }
}
