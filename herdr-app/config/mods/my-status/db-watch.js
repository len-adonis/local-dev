// DB watch: checks the rows in local/db.json (see mods/db/db.example.json) and Teleport,
// and shares the result as shared("db.status") for the status bar's "DB ● ●" and the
// `db` popup. Nothing about a company lives in this file: names, hosts, commands and
// links all come from the config.
// - A row with `pg` is checked with a real Postgres handshake (pg_isready) every
//   `every` seconds. `pg.host`/`pg.port` are fixed, or `pg.lookup` is a shell command
//   that prints {"host", "port"} (for example from a secrets manager). The lookup runs
//   at most every `lookupEvery` seconds and only host and port are kept, so no password
//   is stored. A lookup that fails with stderr matching `pg.authError` gives the state
//   "auth"; any other failure gives "lookup".
// - `access` (optional): Teleport sign-in (`tsh status`, every 30 s) and the newest
//   access request that includes the app `access.app` (`tsh request ls`, every 2 min).
//   While a request is active, Teleport shows only that request's resources, so a row
//   with `hiddenDuringAccess` that is down is "hidden", not "down".
// The popup asks for a fresh check with setShared("db.poke", Date.now()).
import { exec, shared, setShared } from "herdr";
import { loadLocal, sh, expandHome } from "./len-kit.js";

// Teleport's request states.
const STATES = { 1: "pending", 2: "approved", 3: "denied", 4: "promoted" };

let lastPoke = null, busy = false;
let requests = null, requestsAt = 0;
let teleport = null, teleportAt = 0;
const rowState = {};   // id -> { state, host, at }
const lookups = {};    // id -> { addr, at }

async function json(cmd, args, timeout = 20_000) {
  const r = await exec(cmd, args, { timeout });
  if (r.code !== 0) return { error: r.stderr.trim() || `${cmd} failed` };
  try { return { value: JSON.parse(r.stdout) }; } catch { return { error: "bad JSON" }; }
}

async function lookup(row, cwd, force) {
  const pg = row.pg, cached = lookups[row.id];
  if (cached && !force && Date.now() - cached.at < (pg.lookupEvery ?? 3600) * 1000) return { addr: cached.addr };
  const r = await sh('cd "$0" && eval "$1"', expandHome(cwd), pg.lookup, { timeout: 30_000 });
  let addr = null;
  if (r.code === 0) { try { const v = JSON.parse(r.stdout); if (v.host) addr = { host: v.host, port: v.port }; } catch { /* handled below */ } }
  if (addr) { lookups[row.id] = { addr, at: Date.now() }; return { addr }; }
  if (cached) return { addr: cached.addr }; // keep the last good address
  const auth = pg.authError && new RegExp(pg.authError, "i").test(r.stderr);
  return { error: auth ? "auth" : "lookup" };
}

async function checkRow(row, cwd, force) {
  const pg = row.pg;
  let host = pg.host, port = pg.port;
  if (pg.lookup) {
    const l = await lookup(row, cwd, force);
    if (l.error) return { state: l.error };
    ({ host, port } = l.addr);
  }
  const args = ["-h", host, "-p", String(port), "-t", "5", "-q"];
  if (pg.user) args.push("-U", pg.user);
  if (pg.db) args.push("-d", pg.db);
  const r = await exec("pg_isready", args, { timeout: 15_000 });
  return { state: r.code === 0 ? "up" : "down", host };
}

async function checkTeleport(force) {
  if (teleport && !force && Date.now() - teleportAt < 28_000) return teleport;
  const s = await json("tsh", ["status", "--format=json"]);
  const a = s.value?.active;
  const until = a ? Date.parse(a.valid_until) : 0;
  teleport = a ? { signedIn: until > Date.now(), until, active: a.active_requests ?? [] } : { signedIn: false };
  teleportAt = Date.now();
  return teleport;
}

// The newest request that includes the access app, with full resource paths
// (`/<cluster>/<kind>/<name>`) so a new request can ask for the same ones.
async function checkRequests(app, force) {
  if (requests && !force && Date.now() - requestsAt < 2 * 60_000) return requests;
  const l = await json("tsh", ["request", "ls", "--format=json"], 30_000);
  if (!l.value) return requests;
  const r = l.value.find((x) => (x.spec?.resource_ids ?? []).some((id) => id.name === app));
  requests = r ? {
    id: r.metadata.name,
    state: STATES[r.spec.state] ?? "unknown",
    expires: Date.parse(r.spec.expires),
    reason: r.spec.request_reason ?? "",
    resources: r.spec.resource_ids.map((x) => `/${x.cluster}/${x.kind}/${x.name}`),
  } : { state: "none" };
  requestsAt = Date.now();
  return requests;
}

async function check(force) {
  if (busy) return;
  busy = true;
  try {
    const cfg = await loadLocal("db");
    if (!cfg) { setShared("db.status", { missing: true, rows: [], at: Date.now() }); return; }
    const cwd = cfg.cwd ?? "~";
    const rowsCfg = cfg.rows ?? [];
    const due = rowsCfg.filter((r) => r.pg && (force || !rowState[r.id] || Date.now() - rowState[r.id].at >= (r.every ?? 30) * 1000 - 1000));
    const [tp, request] = cfg.access
      ? await Promise.all([checkTeleport(force), checkRequests(cfg.access.app, force)])
      : [null, null];
    await Promise.all(due.map(async (r) => { rowState[r.id] = { ...(await checkRow(r, cwd, force)), at: Date.now() }; }));
    const anyActive = Boolean(tp?.signedIn && tp.active?.length);
    const rows = rowsCfg.map((r) => {
      const s = rowState[r.id];
      const state = !r.pg ? null : !s ? "unknown" : s.state === "down" && r.hiddenDuringAccess && anyActive ? "hidden" : s.state;
      return { id: r.id, bar: Boolean(r.bar), state, host: s?.host ?? null };
    });
    const accessOn = Boolean(tp?.signedIn && request?.id && tp.active?.includes(request.id));
    setShared("db.status", { rows, teleport: tp, request, accessOn, accessLabel: cfg.access?.label ?? null, at: Date.now() });
  } catch (e) {
    setShared("db.status", { ...(shared("db.status") ?? {}), error: String(e.message ?? e), at: Date.now() });
  } finally { busy = false; }
}

export function startDbWatch(cx) {
  check(false);
  let ticks = 0;
  cx.timer.every(2_000, () => {
    const poke = shared("db.poke");
    if (poke !== lastPoke && lastPoke !== null) { lastPoke = poke; check(true); return; }
    lastPoke = poke ?? 0;
    if (++ticks % 5 === 0) check(false); // every 10 s; each row waits for its own `every`
  });
}
