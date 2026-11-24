// Stack position for the focused terminal's folder, from Graphite's own records in git
// (refs/branch-metadata/<branch>: JSON with parentBranchName, parentBranchRevision,
// children). `gt log short --stack` was not used: from some worktrees it leaves out a
// branch's children, so a 7-branch stack showed as 1/1.
// - Position: parents walked down to the trunk (1 = the branch next to the trunk).
// - Total: position + the longest chain of children above (the first branch of a fork).
// - Needs restack: the recorded parent commit is not the parent branch's commit now.
// Four quick git calls, when the focused folder changes and every 30 s.
import { exec, focused } from "herdr";
import { sh } from "./len-kit.js";

async function git(cwd, args) {
  const r = await exec("git", ["-C", cwd, ...args], { timeout: 10_000 });
  return r.code === 0 ? r.stdout : null;
}

async function stackFor(cwd) {
  const branch = (await git(cwd, ["branch", "--show-current"]))?.trim();
  if (!branch) return null;
  const refs = await git(cwd, ["for-each-ref", "--format=%(refname:lstrip=2)", "refs/branch-metadata/"]);
  if (!refs) return null;
  const names = refs.trim().split("\n").filter(Boolean);
  if (!names.includes(branch)) return null; // not a tracked branch (or the trunk)
  // All records in one call: `git cat-file --batch` prints "<sha> blob <size>\n<json>\n",
  // in the same order as for-each-ref lists them.
  const r = await sh('cd "$0" && git for-each-ref --format="%(objectname)" refs/branch-metadata/ | git cat-file --batch', cwd, { timeout: 10_000 });
  if (r.code !== 0) return null;
  const meta = {};
  const out = r.stdout;
  let at = 0;
  for (const name of names) {
    const nl = out.indexOf("\n", at);
    if (nl < 0) break;
    const size = Number(out.slice(at, nl).split(" ")[2]);
    try { meta[name] = JSON.parse(out.slice(nl + 1, nl + 1 + size)); } catch {}
    at = nl + 1 + size + 1;
  }
  const heads = {};
  for (const line of ((await git(cwd, ["for-each-ref", "--format=%(refname:lstrip=2) %(objectname)", "refs/heads/"])) ?? "").split("\n")) {
    const [b, sha] = line.split(" ");
    if (b) heads[b] = sha;
  }
  let pos = 0, b = branch, guard = 0;
  while (meta[b] && guard++ < 100) { pos++; b = meta[b].parentBranchName; }
  const up = (name, depth = 0) => depth > 100 ? 0 : Math.max(0, ...(meta[name]?.children ?? []).filter((c) => meta[c]).map((c) => 1 + up(c, depth + 1)));
  const m = meta[branch];
  const restack = Boolean(m?.parentBranchRevision && heads[m.parentBranchName] && heads[m.parentBranchName] !== m.parentBranchRevision);
  return { pos, total: pos + up(branch), restack };
}

export function startStackWatch(view, cx) {
  let cwd = null, at = 0, busy = false;
  view.stack = null;
  cx.timer.every(2_000, (cx) => {
    const now = focused()?.cwd ?? null;
    if (busy || (now === cwd && Date.now() - at < 30_000)) return;
    cwd = now; at = Date.now(); busy = true;
    cx.spawn(async (cx) => {
      try { view.stack = now ? await stackFor(now) : null; }
      catch { view.stack = null; }
      finally { busy = false; cx.notify(); }
    });
  });
}
