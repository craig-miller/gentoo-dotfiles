// Copied into each private receipt before launch: independent of extension reloads.
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, readSync, existsSync, statSync, realpathSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const read = p => JSON.parse(readFileSync(p, "utf8"));
const atomic = (p, value) => { const t = p + "." + randomUUID() + ".tmp"; writeFileSync(t, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" }); renameSync(t, p); };
export function outcome(exitCode, signal, session, comments, expected) {
  const valid = session && Number.isInteger(session.reviewed_count) && session.reviewed_count >= 0 && session.reviewed_count <= expected && session.file_count === expected && Array.isArray(comments);
  return { state: signal ? "cancelled" : exitCode !== 0 ? "failed" : !valid ? "failed" : session.reviewed_count === expected ? "completed" : "incomplete",
    exitCode, signal, reviewed: valid ? session.reviewed_count : null, total: expected,
    commentCount: Array.isArray(comments) ? comments.length : null, approval: false,
    ...(!valid ? { error: "Missing/ambiguous tuicr session, feedback, or mismatched file counts" } : {}) };
}
function instanceMatches(owner) {
  try { const s = statSync(owner.instance.socket, { bigint: true }); return s.isSocket() && realpathSync(owner.instance.socket) === owner.instance.socket &&
    String(s.dev) === owner.instance.device && String(s.ino) === owner.instance.inode && String(s.ctimeNs) === owner.instance.created; } catch { return false; }
}
// Return identity is pinned once at runner startup, never rediscovered by repo,
// tab order, agent name, or a moved pane alias. A reload of the same Pi is OK.
export function originIdentity(owner, snapshot) {
  const pane = snapshot.panes?.find(p => p.pane_id === owner.pane);
  const agent = snapshot.agents?.find(a => a.pane_id === owner.pane);
  const tab = snapshot.tabs?.find(t => t.tab_id === owner.tab);
  if (!pane?.terminal_id || tab?.workspace_id !== owner.workspace) return null;
  if (![pane, agent].every(p => p && p.tab_id === owner.tab && p.workspace_id === owner.workspace && p.terminal_id === pane.terminal_id &&
      p.agent === "pi" && p.agent_session?.agent === "pi" && p.agent_session?.kind === "path" && p.agent_session?.value === owner.sessionFile)) return null;
  return { terminal: pane.terminal_id };
}
function sessionId(path) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(8192), size = readSync(fd, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, size).indexOf(10);
    if (end < 0) return null;
    const header = JSON.parse(buffer.subarray(0, end).toString());
    return header.type === "session" ? header.id : null;
  } finally { closeSync(fd); }
}
const ownsReview = (owner, launch, snapshot) => snapshot.panes?.some(p =>
  p.pane_id === launch.pane && p.terminal_id === launch.terminal && p.tab_id === launch.tab && p.workspace_id === owner.workspace);
const reviewFocused = (owner, launch, snapshot) => snapshot.focused_pane_id === launch.pane &&
  snapshot.focused_tab_id === launch.tab && snapshot.focused_workspace_id === owner.workspace;

// Herdr 0.9.0/protocol 22 has no compare-and-focus/close operation. This is a
// bounded best-effort return, NOT an atomic no-focus-stealing guarantee. User
// navigation or replacement after the final snapshot can still race tab.focus.
// Never retry/undo focus: an uncertain request may already have taken effect.
export function returnAndClose({ owner, launch, origin, pid, herdr, sameServer, readSessionId, record, now = () => performance.now() }) {
  const began = now();
  let closeRequested = false;
  const inspect = () => {
    if (!sameServer()) throw Error("Herdr instance changed");
    const proc = herdr(["pane", "process-info", "--pane", launch.pane]).process_info;
    const snapshot = herdr(["api", "snapshot"]).snapshot;
    if (!sameServer() || proc?.shell_pid !== pid || !ownsReview(owner, launch, snapshot)) throw Error("Review pane moved/replaced; retained");
    return snapshot;
  };
  try {
    const first = inspect();
    let reason = "focus_elsewhere";
    if (reviewFocused(owner, launch, first)) {
      reason = "origin_unavailable";
      let validSession = false;
      try { validSession = readSessionId(owner.sessionFile) === owner.session; } catch { /* Fail safe. */ }
      reason = !origin ? "origin_unpinned" : !validSession ? "session_mismatch" : "origin_unavailable";
      if (origin && validSession && originIdentity(owner, first)?.terminal === origin.terminal) {
        record("return-focus.json", { state: "checking", tab: owner.tab, atomic: false });
        // Recheck ownership and BOTH endpoints after all potentially slow work.
        const final = inspect();
        if (!reviewFocused(owner, launch, final)) reason = "focus_elsewhere";
        else if (originIdentity(owner, final)?.terminal !== origin.terminal) reason = "origin_changed";
        else if (now() - began > 1500) reason = "validation_expired";
        else {
          reason = "attempted";
          try {
            // No filesystem writes or extra CLI calls between final check and focus.
            if (!sameServer()) throw Error("Herdr instance changed before focus");
            herdr(["tab", "focus", owner.tab]);
            record("return-focus.json", { state: "acknowledged", tab: owner.tab, atomic: false });
          } catch (e) { record("return-focus.json", { state: "uncertain", tab: owner.tab, atomic: false, error: String(e) }); }
        }
      }
    }
    if (reason !== "attempted") record("return-focus.json", { state: "skipped", reason, atomic: false });
    // Focusing and waiting for its acknowledgement must not weaken close ownership.
    inspect();
    record("close.json", { state: "requested", pane: launch.pane });
    if (!sameServer()) throw Error("Herdr instance changed before close");
    closeRequested = true;
    herdr(["pane", "close", launch.pane]);
  } catch (e) {
    // Self-close may terminate the CLI before its acknowledgement reaches us.
    record("close.json", { state: closeRequested ? "uncertain" : "retained", error: String(e) });
  }
}
export function reviewEnv(dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return { ...env, XDG_DATA_HOME: join(dir, "data"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" };
}
export function collectFeedback(dir) {
  const snapshot = join(dir, "snapshot"), env = reviewEnv(dir);
  const list = JSON.parse(execFileSync("tuicr", ["review", "list", "--repo", snapshot], { cwd: snapshot, env, timeout: 10000, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
  if (Array.isArray(list) && list.length === 0) return { session: null, comments: null };
  if (!Array.isArray(list) || list.length !== 1 || list[0].kind !== "local") throw Error("Expected exactly one private local review session");
  const session = list[0];
  const comments = JSON.parse(execFileSync("tuicr", ["review", "comments", "--repo", snapshot, "--session", session.slug], { cwd: snapshot, env, timeout: 10000, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
  if (!Array.isArray(comments)) throw Error("Invalid tuicr feedback response");
  atomic(join(dir, "session.json"), session); atomic(join(dir, "feedback.json"), comments);
  return { session, comments };
}
export async function run(dir) {
  process.umask(0o077);
  const manifest = read(join(dir, "manifest.json")), launch = read(join(dir, "launch.json"));
  const owner = manifest.owner, snapshot = join(dir, "snapshot");
  // Keep the caller's usable socket spelling (it can be a short /proc alias).
  // The canonical inode/lifetime identity is independently checked below.
  const cliEnv = { ...process.env };
  if (!cliEnv.HERDR_SOCKET_PATH || realpathSync(cliEnv.HERDR_SOCKET_PATH) !== owner.instance.socket) throw Error("Herdr endpoint changed");
  const herdr = args => JSON.parse(execFileSync("herdr", args, { env: cliEnv, timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })).result;
  // Must run as the replacement shell of precisely the tab we created.
  if (!instanceMatches(owner) || process.env.HERDR_PANE_ID !== launch.pane || process.env.HERDR_TAB_ID !== launch.tab) throw Error("Runner ownership mismatch");
  const pane = herdr(["pane", "get", launch.pane]).pane;
  const proc = herdr(["pane", "process-info", "--pane", launch.pane]).process_info;
  if (pane.terminal_id !== launch.terminal || pane.tab_id !== launch.tab || proc.shell_pid !== process.pid) throw Error("Runner is not the owned terminal shell");
  const fd = openSync(join(dir, "runner.claim"), "wx", 0o600); closeSync(fd);
  let origin = null;
  try { if (instanceMatches(owner)) origin = originIdentity(owner, herdr(["api", "snapshot"]).snapshot); } catch { /* No return if startup identity is uncertain. */ }
  atomic(join(dir, "origin.json"), { ...origin, captured: Boolean(origin), session: owner.session, sessionFile: owner.sessionFile, pane: owner.pane, tab: owner.tab, workspace: owner.workspace });
  atomic(join(dir, "started.json"), { pid: process.pid, at: new Date().toISOString(), pane: launch.pane, terminal: launch.terminal });
  const env = reviewEnv(dir);
  mkdirSync(env.XDG_DATA_HOME, { recursive: true, mode: 0o700 });
  const output = openSync(join(dir, "export.md"), "wx", 0o600);
  const child = spawn("tuicr", ["--no-update-check", "-w", "--stdout"], { cwd: snapshot, env, stdio: ["inherit", output, "pipe"] });
  closeSync(output);
  let stderrTail = "";
  child.stderr.on("data", data => { process.stderr.write(data); stderrTail = (stderrTail + data.toString()).slice(-65536); });
  let cancelled, killed;
  const cancel = reason => { if (cancelled) return; cancelled = reason; child.kill("SIGTERM"); killed = setTimeout(() => child.kill("SIGKILL"), 3000); };
  const hup = () => cancel("SIGHUP"), term = () => cancel("SIGTERM"), interrupt = () => cancel("SIGINT");
  process.on("SIGHUP", hup); process.on("SIGTERM", term); process.on("SIGINT", interrupt);
  const timer = setInterval(() => { if (existsSync(join(dir, "cancel.request"))) cancel("requested"); }, 500);
  const exited = await new Promise(resolve => { child.once("error", error => resolve({ code: -1, error: String(error) })); child.once("close", (code, signal) => resolve({ code, signal })); });
  clearInterval(timer); clearTimeout(killed);
  let session, comments, error = exited.error;
  try {
    ({ session, comments } = collectFeedback(dir));
  } catch (e) { error = String(e); }
  const summary = /tuicr-summary: reviewed (\d+)\/(\d+) files, (\d+) comments added/.exec(stderrTail);
  if (summary) atomic(join(dir, "summary.json"), { reviewed: Number(summary[1]), total: Number(summary[2]), comments: Number(summary[3]) });
  // tuicr does not persist an untouched session on :q. Its exit summary is
  // positive evidence for 0/N, not a missing-session assumption or completion.
  if (!error && !session && summary && Number(summary[1]) === 0 && Number(summary[2]) === manifest.snapshot.fileCount && Number(summary[3]) === 0) {
    session = { reviewed_count: 0, file_count: manifest.snapshot.fileCount }; comments = [];
    atomic(join(dir, "feedback.json"), comments);
  }
  atomic(join(dir, "completion.json"), { ...outcome(exited.code, cancelled || exited.signal, session, comments, manifest.snapshot.fileCount), ...(error ? { error } : {}),
    finished: new Date().toISOString(), identity: manifest.snapshot.identity });
  returnAndClose({ owner, launch, origin, pid: process.pid, herdr, sameServer: () => instanceMatches(owner), readSessionId: sessionId,
    record: (name, value) => atomic(join(dir, name), value) });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.argv[2]).catch(error => {
    console.error(error);
    try { atomic(join(process.argv[2], "completion.json"), { state: "failed", error: String(error), reviewed: null, approval: false }); } catch { /* Preserve stderr if storage failed. */ }
    process.exitCode = 1;
  });
}
