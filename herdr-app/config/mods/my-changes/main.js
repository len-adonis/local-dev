// my-changes: a changed copy of Herdr's shipped Changes panel (mods/changes).
// Herdr is licensed under the Apache License 2.0 (copy: LICENSE-herdr in this folder).
// Changed from the original by Len: the scope row, commit and stack lists, the view
// cache, code colors, and no commit box. The parts below list them.
//   Uncommitted  the working tree against HEAD (the shipped view, with the commit box).
//   Not pushed   commits after the remote branch (@{u}..HEAD).
//   Branch       everything since the branch's base, uncommitted and new files too.
//                Base = the Graphite parent (refs/branch-metadata/<branch>), else origin/HEAD.
// Not pushed and Branch list their commits (● local, ○ pushed); click one to see only it.
// Branch on a Graphite stack also lists the stack (top first); click a branch for its PR
// (its parent..its tip), without leaving your branch.
// Only reads git. The shipped commit box (git add -A + commit) is removed on purpose.
// Switching views keeps the old view until the new one is ready, and recent views are
// cached, so the panel does not blank. Diff lines get simple code colors (see tokens()).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;

const SCOPES = [
  { id: "work", title: "Uncommitted", empty: "No uncommitted changes" },
  { id: "unpushed", title: "Not pushed", empty: "Everything is pushed" },
  { id: "branch", title: "Branch", empty: "No changes on this branch" },
];
const MAX_COMMITS = 200;

// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

// Code colors for one diff line. A small tokenizer, not a parser: one line at a time,
// so a string or comment that spans lines is colored only on its first line.
const HASH = new Set(["py", "sh", "bash", "zsh", "rb", "yaml", "yml", "toml", "tf", "hcl", "r", "pl", "mk", "dockerfile", "conf", "ini", "nix"]);
const DASH = new Set(["sql", "lua", "hs"]);
const PLAIN = new Set(["md", "markdown", "txt", "csv", "tsv", "log", "lock", "svg", "html", "xml"]);
const KEYWORDS = new Set(("if else elif for while do break continue return function func fn def class struct enum interface type impl trait " +
  "const let var mut pub priv static async await yield import from export default as package use mod module extends implements " +
  "new delete in of is not and or try catch except finally raise throw throws with switch case match when where select insert update " +
  "into values set create table alter drop join left right inner outer on group by order having limit union go defer chan map range " +
  "lambda pass global nonlocal assert self this super public private protected final abstract override void readonly declare namespace " +
  "end then begin local elseif unless until loop crate ref move dyn").split(" "));
const CONSTANTS = new Set("true false null undefined None True False nil NULL NaN Infinity".split(" "));
const TOKENS = {};
function tokenRegex(ext) {
  const comment = HASH.has(ext) ? "#.*" : DASH.has(ext) ? "--.*" : "\\/\\/.*|\\/\\*.*?(?:\\*\\/|$)";
  return TOKENS[ext] ??= new RegExp(`(${comment})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d[\\d_]*(?:\\.\\d+)?\\b)|([A-Za-z_$][\\w$]*)`, "g");
}
// [{ text, kind }] with kind one of: comment string number keyword constant function type, or "".
function tokens(text, ext) {
  if (PLAIN.has(ext)) return [{ text, kind: "" }];
  const re = tokenRegex(ext), out = [];
  let at = 0, m;
  const push = (t, kind) => { if (!t) return; const last = out[out.length - 1]; if (last && last.kind === kind) last.text += t; else out.push({ text: t, kind }); };
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    push(text.slice(at, m.index), "");
    let kind = m[1] ? "comment" : m[2] ? "string" : m[3] ? "number" : "";
    if (m[4]) {
      const w = m[4];
      kind = KEYWORDS.has(w) || (DASH.has(ext) && KEYWORDS.has(w.toLowerCase())) ? "keyword" : CONSTANTS.has(w) ? "constant" : /^\s*\(/.test(text.slice(re.lastIndex)) ? "function" : /^[A-Z][a-z]/.test(w) ? "type" : "";
    }
    push(m[0], kind);
    at = re.lastIndex;
  }
  push(text.slice(at), "");
  return out;
}
const extOf = (path) => { const name = (path ?? "").split("/").pop().toLowerCase(); return name === "dockerfile" || name === "makefile" ? "dockerfile" : name.includes(".") ? name.split(".").pop() : ""; };

// Adds `git diff --numstat -z` output to stats: path -> { add, del, binary }.
function addStats(stats, out) {
  for (const entry of out.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (!parts.length) continue;
    const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
    stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
  }
}

// Graphite's records (refs/branch-metadata/<branch>: { parentBranchName, children, … })
// for branches that still exist here, read in one `git cat-file --batch` call.
async function graphite(git, shell) {
  const refs = await git(["for-each-ref", "--format=%(refname:lstrip=2)", "refs/branch-metadata/"]);
  const names = refs.code === 0 ? refs.stdout.split("\n").filter(Boolean) : [];
  if (!names.length) return {};
  const r = await shell('git for-each-ref --format="%(objectname)" refs/branch-metadata/ | git cat-file --batch');
  const heads = await git(["for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads/"]);
  if (r.code !== 0 || heads.code !== 0) return {};
  const local = new Set(heads.stdout.split("\n").filter(Boolean)), meta = {}, out = r.stdout;
  let at = 0;
  for (const name of names) {
    const nl = out.indexOf("\n", at);
    if (nl < 0) break;
    const size = Number(out.slice(at, nl).split(" ")[2]);
    if (local.has(name)) try { meta[name] = JSON.parse(out.slice(nl + 1, nl + 1 + size)); } catch {}
    at = nl + 1 + size + 1;
  }
  return meta;
}

// The stack of the current branch, top first: the branches above it (all forks), then
// it and its parents down to the trunk (the trunk itself is not in the list).
function stackOf(meta, current, trunk) {
  if (!current || !meta[current] || current === trunk) return [];
  const down = [];
  for (let b = current, n = 0; b && meta[b] && b !== trunk && n < 100; b = meta[b].parentBranchName, n++) down.push(b);
  const up = [], seen = new Set(down);
  const walk = (b, depth) => {
    if (depth > 100) return;
    for (const c of meta[b]?.children ?? []) if (meta[c] && !seen.has(c)) { seen.add(c); up.push(c); walk(c, depth + 1); }
  };
  walk(current, 0);
  return [...up.reverse(), ...down];
}

// The commit a branch tip starts from, and a label. Parent: Graphite's, else the trunk.
// Of the local and origin/ copies, take the newer base, so a stale local main does not
// pull in other people's commits. The trunk too, as a fallback: after the parent PR
// merges, its branch can be gone while Graphite still names it.
async function branchBase(git, tip, parent, trunk) {
  for (const name of [...new Set([parent ?? trunk, trunk])]) {
    const bases = [];
    for (const ref of [name, `origin/${name}`]) {
      const r = await git(["merge-base", tip, ref]);
      if (r.code === 0) bases.push(r.stdout.trim());
    }
    if (!bases.length) continue;
    let base = bases[0];
    if (bases[1] && bases[1] !== base && (await git(["merge-base", "--is-ancestor", base, bases[1]])).code === 0) base = bases[1];
    return { base, label: `since ${name}` };
  }
  return null;
}

// Commits in from..tip, newest first: { sha, subject, when, pushed }.
async function commitsIn(git, from, tip, upstream) {
  const log = await git(["log", "--no-color", `--max-count=${MAX_COMMITS}`, "--format=%H%x1f%s%x1f%cr", `${from}..${tip}`]);
  if (log.code !== 0) return [];
  const pushed = new Set();
  if (upstream) {
    const r = await git(["rev-list", `--max-count=${MAX_COMMITS * 5}`, `${from}..${upstream}`]);
    if (r.code === 0) for (const sha of r.stdout.split("\n")) if (sha) pushed.add(sha);
  }
  return log.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, subject, when] = line.split("\x1f");
    return { sha, subject, when: when.replace(/ ago$/, ""), pushed: pushed.has(sha) };
  });
}

// The diff lines of one file in a view (src = a snapshot or the view itself).
async function diffLines(src, path) {
  const file = src.files.find((f) => f.path === path), root = src.root, on = src.on;
  if (!file) return null;
  let lines;
  if (file.fresh || (!src.hasHead && file.status === "A")) {
    const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
    if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
    else if (text.includes("\0")) lines = ["Binary file · no text diff"];
    else {
      file.add = countLines(text);
      lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
    }
  } else {
    const ends = src.range ? [src.range.from, ...(src.range.to ? [src.range.to] : [])] : src.hasHead ? ["HEAD"] : [];
    const r = await exec("git", [...READ, "diff", ...ends, "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
    if (r.code !== 0) throw new Error(r.stderr);
    const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
    lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
  }
  return lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line);
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.handle = cx.focus_handle();
    this.scope = "work"; this.commit = null; this.commits = []; this.range = null; this.scopeNote = null;
    this.stack = []; this.current = null; this.stackBranch = null; this.trunk = null;
    this.cache = new Map(); // view() -> a finished view, so switching back is instant
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  // What is on screen: the folder, the scope, the stack branch and the picked commit.
  // When it changes, the file list starts again; a result for an older view is dropped.
  view() { return `${key()}|${this.scope}|${this.stackBranch ?? ""}|${this.commit ?? ""}`; }

  setScope(scope, cx) {
    if (this.scope === scope) return;
    this.scope = scope; this.commit = null; this.stackBranch = null; this.closed = false;
    this.refresh(cx);
    cx.notify();
  }

  // null = all commits of the range.
  pickCommit(sha, cx) {
    this.commit = sha && this.commit !== sha ? sha : null; this.closed = false;
    this.refresh(cx);
    cx.notify();
  }

  // Another branch of the stack (its PR: since its parent). Your own branch = null.
  pickBranch(name, cx) {
    this.stackBranch = name === this.current ? null : name; this.commit = null; this.closed = false;
    this.refresh(cx);
    cx.notify();
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  // What a finished view holds; also the cache entry.
  snapshot() {
    const { root, on, hasHead, files, limited, commits, range, scopeNote, stack, current, trunk, open, rows, diffWidth, error } = this;
    return { root, on, hasHead, files, limited, commits, range, scopeNote, stack, current, trunk, open, rows, diffWidth, error };
  }

  refresh(cx) {
    // A refresh asked for during another one runs when that one ends (a scope click must not be lost).
    if (this.loading) { this.again = true; return; }
    const { cwd, on } = location(), place = key();
    if (place !== this.place) {
      // Another folder: start empty.
      this.place = place; this.commit = null; this.stackBranch = null; this.watched = null; this.cache.clear();
      this.root = null; this.files = []; this.open = null; this.commits = []; this.range = null; this.stack = [];
      this.setLines([]); this.error = null; this.scopeNote = null; this.closed = false; this.limited = false;
    }
    if (this.view() !== this.context) {
      // Same folder, another view: keep what is on screen (or show the cached copy)
      // until the new one is ready, so the panel does not blank.
      this.context = this.view(); this.note = null;
      const hit = this.cache.get(this.context);
      if (hit) Object.assign(this, hit);
    }
    const ctx = this.context;
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (this.view() !== ctx) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const shell = (script) => exec("sh", ["-c", script], { cwd: root, on });
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const r = this.scope === "work" || head.code !== 0 ? await this.workFiles(git, head.code === 0) : await this.rangeFiles(git, shell);
        if (this.view() !== ctx) return;
        const next = { root, on, hasHead: head.code === 0, error: null, files: r.files, limited: r.limited, commits: r.commits ?? [], range: r.range ?? null,
          scopeNote: r.note ?? null, stack: r.stack ?? [], current: r.current ?? null, trunk: r.trunk ?? null };
        // Keep the open file if the new view has it; else the first file, unless you closed it.
        let open = this.open && next.files.some((f) => f.path === this.open) ? this.open : null;
        if (!open && !this.closed && next.files.length) open = next.files[0].path;
        let lines = [];
        if (open) {
          try { lines = await diffLines(next, open); }
          catch { lines = ["Cannot preview this diff (too large or unreadable)"]; }
        }
        if (this.view() !== ctx) return;
        // Everything changes in one frame.
        Object.assign(this, next); this.open = open; this.setLines(lines, open);
        this.watch(root, cx);
        this.cache.delete(ctx); this.cache.set(ctx, this.snapshot());
        while (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value);
      } catch (e) { if (this.view() === ctx) this.error = String(e); }
      finally {
        this.loading = false; cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  // The shipped view: the working tree and index against HEAD.
  async workFiles(git, hasHead) {
    const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
    if (status.code !== 0) throw new Error(status.stderr);
    const stats = {};
    const results = hasHead ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
    for (const result of results) {
      if (result.code !== 0) throw new Error(result.stderr);
      addStats(stats, result.stdout);
    }
    const files = [];
    const entries = status.stdout.split("\0").filter(Boolean);
    for (const entry of entries.slice(0, 1000)) {
      const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
      const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
      const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
      files.push({ path, status: s, fresh, ...(stats[path] ?? { add: 0, del: 0 }) });
    }
    return { files, limited: entries.length > 1000 };
  }

  // Not pushed / Branch / one commit: a diff between two commits, or a commit and the
  // working tree (to = null). Branch also lists new files that are not in git yet.
  // Branch of another stack branch: that branch's PR (its parent..its tip), no working tree.
  async rangeFiles(git, shell) {
    const current = (await git(["branch", "--show-current"])).stdout.trim() || null;
    const origin = await git(["rev-parse", "--abbrev-ref", "origin/HEAD"]);
    const trunk = origin.code === 0 ? origin.stdout.trim().replace(/^origin\//, "") : "main";
    const meta = this.scope === "branch" ? await graphite(git, shell) : {};
    const stack = stackOf(meta, current, trunk);
    const other = this.stackBranch && stack.includes(this.stackBranch) ? this.stackBranch : null;
    const tip = other ?? "HEAD", more = { stack, current, trunk };
    const up = await git(["rev-parse", "--verify", "--quiet", `${other ?? ""}@{u}`]);
    const upstream = up.code === 0 ? up.stdout.trim() : null;
    let from, label;
    if (this.scope === "unpushed") {
      if (!upstream) {
        return { files: [], limited: false, ...more, note: current ? "No remote branch yet: nothing is pushed. Use Branch to see it all." : "Not on a branch (detached HEAD). Use Branch to see the changes." };
      }
      from = upstream; label = "after the remote branch";
    } else {
      const b = await branchBase(git, tip, meta[other ?? current]?.parentBranchName, trunk);
      if (!b) return { files: [], limited: false, ...more, note: "Cannot find where this branch starts" };
      from = b.base; label = other ? `${other} ${b.label}` : b.label;
    }
    const commits = await commitsIn(git, from, tip, upstream);
    const picked = this.commit && commits.find((c) => c.sha === this.commit);
    const range = picked
      ? { from: `${picked.sha}^`, to: picked.sha, label: `${picked.sha.slice(0, 7)} only` }
      : { from, to: this.scope === "branch" ? other : "HEAD", label };
    const ends = range.to ? [range.from, range.to] : [range.from];
    const [names, nums] = [await git(["diff", "--name-status", "-z", "--no-renames", ...ends]), await git(["diff", "--numstat", "-z", "--no-renames", ...ends])];
    for (const r of [names, nums]) if (r.code !== 0) throw new Error(r.stderr);
    const stats = {};
    addStats(stats, nums.stdout);
    const parts = names.stdout.split("\0"), files = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const s = parts[i][0], path = parts[i + 1];
      files.push({ path, status: s === "D" ? "D" : s === "A" ? "A" : s === "U" ? "U" : "M", fresh: false, ...(stats[path] ?? { add: 0, del: 0 }) });
    }
    if (!range.to) {
      const fresh = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
      if (fresh.code === 0) for (const path of fresh.stdout.split("\0").filter(Boolean)) files.push({ path, status: "A", fresh: true, add: 0, del: 0 });
    }
    return { files: files.slice(0, 1000), limited: files.length > 1000, commits, range, ...more };
  }

  async load(path, context) {
    const lines = await diffLines(this, path);
    if (lines && this.view() === context && this.open === path) this.setLines(lines, path);
  }

  setLines(lines, path) {
    this.rows = diffRows(lines); this.ext = extOf(path);
    this.diffWidth = Math.max(300, ...this.rows.map(row => (row.text.length + 1) * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.note = null;
    if (!this.open) this.setLines([]);
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (this.view() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(this.code(text, t));
  }

  // One line of code in colors. Tokens are worked out once per row (rows are cached in this.rows).
  code(text, t) {
    const colors = { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 };
    const parts = tokens(text, this.ext);
    if (parts.length === 1 && !parts[0].kind) return div().flex_1().min_w(0).truncate().child(text);
    return h_flex().flex_1().min_w(0).overflow_hidden().whitespace_nowrap()
      .children(parts.map((p) => div().flex_none().whitespace_nowrap().when(Boolean(p.kind), (e) => e.text_color(colors[p.kind])).child(p.text)));
  }

  scopeRow(t) {
    return h_flex().h(34).flex_none().px(10).gap(4).items_center().border_b(1).border_color(t.border)
      .children(SCOPES.map((s) => {
        const on = this.scope === s.id;
        return div().id(`scope-${s.id}`).h(22).px(8).flex().items_center().rounded(6).text_size(11).cursor_pointer()
          .border_1().border_color(on ? t.accent : t.border).bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
          .hover((e) => e.bg(t.hover)).on_click((_e, cx) => this.setScope(s.id, cx)).child(s.title);
      }))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(this.range?.label ?? ""));
  }

  // The commits of Not pushed / Branch. "All" first; ● = only here, ○ = pushed.
  commitList(t) {
    const rows = [{ sha: null, subject: `All ${this.commits.length}${this.commits.length >= MAX_COMMITS ? "+" : ""} commits`, when: "" }, ...this.commits];
    return div().flex_none().max_h(Math.min(rows.length, 6) * 24 + 8).h(Math.min(rows.length, 6) * 24 + 8).relative().border_b(1).border_color(t.border)
      .child(v_flex().id("changes-commits").absolute().inset_0().overflow_y_scroll().p(4).children(rows.map((c) => {
        const on = (this.commit ?? null) === c.sha;
        return h_flex().id(`commit-${c.sha ?? "all"}`).h(24).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
          .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pickCommit(c.sha, cx))
          .child(div().w(10).text_size(10).text_color(c.pushed ? t.dim : t.accent).child(c.sha ? (c.pushed ? "○" : "●") : ""))
          .when(Boolean(c.sha), (e) => e.child(div().flex_none().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).text_color(t.dim).child(c.sha.slice(0, 7))))
          .child(div().flex_1().min_w(0).truncate().text_color(c.sha ? t.foreground : t.muted).child(c.subject))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(c.when));
      })))
      .child(Scrollbar.vertical("changes-commits").absolute().inset_0());
  }

  // The Graphite stack, top first, with the trunk under it. Click a branch for its PR.
  stackList(t) {
    const shown = (this.stackBranch ?? this.current), n = this.stack.length, rows = this.stack.length + 1;
    const h = Math.min(rows, 6) * 24 + 8;
    return div().flex_none().h(h).relative().border_b(1).border_color(t.border)
      .child(v_flex().id("changes-stack").absolute().inset_0().overflow_y_scroll().p(4)
        .children(this.stack.map((name, i) => {
          const on = shown === name, mine = name === this.current;
          return h_flex().id(`stack-${name}`).h(24).flex_none().px(8).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
            .when(on, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pickBranch(name, cx))
            .child(div().w(18).flex_none().text_right().text_size(11).text_color(t.dim).child(String(n - i)))
            .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(name))
            .when(mine, (e) => e.child(div().flex_none().px(5).rounded(4).border_1().border_color(t.accent).text_size(10).text_color(t.accent).child("you")));
        }))
        .child(h_flex().h(24).flex_none().px(8).gap(8).items_center().text_size(12)
          .child(div().w(18).flex_none().text_right().text_size(11).text_color(t.dim).child("└"))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.trunk ?? "trunk"))))
      .child(Scrollbar.vertical("changes-stack").absolute().inset_0());
  }

  render(cx) {
    if (this.view() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const scope = SCOPES.find((s) => s.id === this.scope);
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(`${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .child(this.scopeRow(t))
      .when(this.scope === "branch" && this.stack.length > 1, (e) => e.child(this.stackList(t)))
      .when(this.scope !== "work" && this.commits.length > 0, (e) => e.child(this.commitList(t)))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).max_h(this.files.length * 28 + 12).relative().border_b(1).border_color(t.border)
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().p(6).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop();
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(this.open === f.path, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(div().w(14).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || this.scopeNote || (this.loading ? "Loading changes…" : this.root ? scope.empty : "No folder")))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)));
  }
}
