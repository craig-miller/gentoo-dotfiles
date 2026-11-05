import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { herdrInstance, readJSON, sameInstance, stateRoot } from "./protocol.ts";
import { phaseBranch, reportingPhaseReady } from "./phase-record.ts";

export const enrollmentType = "feature-workflow-enrollment";
const fields = ["session", "session_file", "cwd", "common", "pane", "tab", "workspace"];
export function sameEnrollment(a: any, b: any) {
  return a?.version === 1 && a.role === b.role && sameInstance(a.instance, b.instance) && fields.every(k => typeof a[k] === "string" && a[k] === b[k]);
}
function savedEnrollment(ctx: ExtensionContext) {
  const entries = ctx.sessionManager.getEntries().filter((e: any) => e.type === "custom" && e.customType === enrollmentType &&
    e.data?.session === ctx.sessionManager.getSessionId()) as any[];
  if (!entries.length) return undefined;
  const values = entries.map(e => e.data);
  if (!values.every(e => sameEnrollment(e, values[0]))) throw new Error("Conflicting feature enrollment; inspect before activation");
  return values[0];
}

// Old automatic coordinator registrations and unbound role-only transcript
// entries are not opt-in evidence. A *current, completed* two-endpoint attach is.
// Epochs can be expired on reload; enrollment never makes that binding ready.
function attachedEnrollment(ctx: ExtensionContext) {
  const root = join(stateRoot(), "reporting"), proofs: any[] = [];
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root)) {
    const pointerPath = join(root, name, "current.json");
    if (!existsSync(pointerPath)) continue;
    try {
      const pointer = readJSON(pointerPath), r = readJSON(pointer.request), dir = dirname(pointer.request);
      const role = ["worker", "coordinator"].find(role => r[role]?.session === ctx.sessionManager.getSessionId() && r[role]?.session_file === ctx.sessionManager.getSessionFile());
      if (!role || r.version !== 1 || r.revision !== pointer.revision || r.feature !== pointer.feature ||
          r.worker.role !== "worker" || r.coordinator.role !== "coordinator" || r.worker.session === r.coordinator.session ||
          r.worker.common !== r.common || r.coordinator.common !== r.common || !sameInstance(r.worker.instance, r.coordinator.instance)) continue;
      // The worker-keyed current pointer must be canonical, not an unrelated copy.
      if (name !== createHash("sha256").update(r.worker.session).digest("hex")) continue;
      const ready = readJSON(join(dir, "ready.json"));
      const correlated = (a: any) => a.revision === r.revision && a.feature === r.feature && a.worker_epoch === r.worker.epoch && a.coordinator_epoch === r.coordinator.epoch;
      if (!correlated(ready) || ready.status !== "ready") continue;
      if (!["worker", "coordinator"].every(role => {
        const ack = readJSON(join(dir, `active-${role}.json`));
        return correlated(ack) && ack.role === role && ack.epoch === r[role].epoch && ack.status === "active";
      })) continue;
      const bytes = readFileSync(r.receipt), receipt = JSON.parse(bytes.toString());
      if (createHash("sha256").update(bytes).digest("hex") !== r.receipt_sha256 || receipt.nonce !== r.feature || receipt.session !== r.worker.session ||
          realpathSync(receipt.cwd) !== r.cwd || r.worker.cwd !== r.cwd || phaseBranch(r, receipt) !== r.branch ||
          (receipt.worker?.session_file && receipt.worker.session_file !== r.worker.session_file)) continue;
      reportingPhaseReady(r);
      proofs.push({ ...r[role], version: 1, source: "verified-attachment", relationship: pointer.request });
    } catch { /* Incomplete/corrupt/superseded bindings never opt in a session. */ }
  }
  if (!proofs.length) return undefined;
  if (!proofs.every(p => sameEnrollment(p, proofs[0]))) throw new Error("Conflicting attached roles/identities; explicit operator resolution required");
  return proofs[0];
}
function startupRequest(reason: string) {
  const index = process.argv.indexOf("--feature-request");
  const path = index >= 0 ? process.argv[index + 1] : process.argv.find(a => a.startsWith("--feature-request="))?.slice("--feature-request=".length);
  if (reason === "reload" && path && !existsSync(path)) return undefined;
  return path ? { path, request: readJSON(path) } : undefined;
}
export function enrollmentIntent(pi: ExtensionAPI, ctx: ExtensionContext, reason: string) {
  if (["new", "fork"].includes(reason)) return undefined; // Do not inherit launch flags or copied history.
  const saved = savedEnrollment(ctx);
  if (saved) {
    const flag = reason === "startup" ? pi.getFlag("feature-role") : undefined;
    if (flag !== undefined && flag !== saved.role) throw new Error("Saved enrollment conflicts with explicit launch role");
    return { role: saved.role, expected: saved, source: saved.source, persisted: true };
  }
  const attached = attachedEnrollment(ctx);
  let startup = ["startup", "reload"].includes(reason) ? startupRequest(reason) : undefined;
  // Process arguments survive /new and /resume. On reload, only a request
  // naming this exact conversation can supply launch intent.
  if (reason === "reload" && startup?.request.session !== ctx.sessionManager.getSessionId()) startup = undefined;
  const flag = reason === "startup" || startup ? pi.getFlag("feature-role") : undefined;
  if (flag !== undefined && !["coordinator", "worker"].includes(String(flag))) throw new Error("Invalid feature role");
  if (startup) {
    const role = startup.request.role || "worker";
    if (!["coordinator", "worker"].includes(role) || (flag !== undefined && flag !== role) || (attached && attached.role !== role)) throw new Error("Conflicting launcher/enrollment role");
    return { role, source: "launcher-request", request: startup.request };
  }
  if (attached) {
    if (flag !== undefined && flag !== attached.role) throw new Error("Conflicting feature role and attachment");
    return { role: attached.role, expected: attached, source: "verified-attachment" };
  }
  // A role flag is deliberate opt-in, not a default. It is never inherited by
  // /new, /fork or /resume. The new durable record binds subsequent reloads.
  return flag === undefined ? undefined : { role: String(flag), source: "explicit-launch-role" };
}
export function explicitEnrollment(ctx: ExtensionContext, role: string, receipt?: string) {
  if (!["coordinator", "worker"].includes(role)) throw new Error("Use /feature-coordinate or /feature-coordinate worker /absolute/receipt.json");
  const saved = savedEnrollment(ctx);
  if (saved && saved.role !== role) throw new Error("Enrollment role is immutable; do not reclassify a feature session");
  if (saved) return { role, expected: saved, source: saved.source, persisted: true };
  if (role === "worker" && !receipt) throw new Error("Legacy worker activation requires its exact original receipt");
  return { role, source: "explicit-command", request: receipt ? readJSON(realpathSync(receipt)) : undefined };
}
export async function verifyEnrollment(pi: ExtensionAPI, ctx: ExtensionContext, intent: any, stillCurrent = () => true, bootstrap = false) {
  if (!["coordinator", "worker"].includes(intent.role)) throw new Error("Invalid enrollment role");
  if (process.env.HERDR_ENV !== "1" || !ctx.sessionManager.getSessionFile()) throw new Error("Feature enrollment requires a persistent session inside Herdr");
  const git = await pi.exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ctx.cwd, timeout: 5000 });
  if (git.code) throw new Error("Feature enrollment requires a Git worktree; ordinary sessions need no enrollment");
  const pane = process.env.HERDR_PANE_ID, tab = process.env.HERDR_TAB_ID, workspace = process.env.HERDR_WORKSPACE_ID;
  if (!pane || !tab || !workspace) throw new Error("Feature enrollment requires exact Herdr pane/tab/workspace");
  const identity = { version: 1, role: intent.role, source: intent.source, instance: herdrInstance(), session: ctx.sessionManager.getSessionId(),
    session_file: ctx.sessionManager.getSessionFile(), cwd: realpathSync(ctx.cwd), common: realpathSync(git.stdout.trim()), pane, tab, workspace };
  if (intent.expected && !sameEnrollment(intent.expected, identity)) throw new Error("Feature enrollment identity changed; no automatic adoption");
  if (intent.request) {
    const r = intent.request, endpoint = r.worker || r;
    const legacy = intent.source === "explicit-command" && identity.role === "worker" && !r.instance && !endpoint.instance;
    if (typeof r.nonce !== "string" || !r.nonce || (r.role || "worker") !== identity.role || r.session !== identity.session || realpathSync(r.cwd) !== identity.cwd ||
        (!legacy && !sameInstance(r.instance || endpoint.instance, identity.instance)) ||
        ["pane", "tab", "workspace"].some(k => (endpoint[k] ?? r[k]) !== undefined ? (endpoint[k] ?? r[k]) !== (identity as any)[k] : !legacy) ||
        (endpoint.session_file && endpoint.session_file !== identity.session_file)) throw new Error("Launcher/receipt does not identify this exact feature endpoint");
    let common = r.common || endpoint.common;
    if (legacy) {
      // Old receipts can lack Herdr/registry fields. Explicit activation still
      // requires the original session/file, repo/worktree and original branch;
      // current physical endpoint identity is independently verified below.
      if (endpoint.session_file !== identity.session_file || !r.repo || !r.branch) throw new Error("Legacy receipt needs exact session file/repository/branch");
      const repository = await pi.exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: realpathSync(r.repo), timeout: 5000 });
      const branch = await pi.exec("git", ["branch", "--show-current"], { cwd: identity.cwd, timeout: 5000 });
      if (repository.code || branch.code || branch.stdout.trim() !== r.branch) throw new Error("Legacy receipt repository/branch changed; no implicit phase authorization");
      common = repository.stdout.trim();
    }
    if (!common || realpathSync(common) !== identity.common) throw new Error("Launcher/receipt repository mismatch");
  }
  // session_start handlers run sequentially; Herdr's publisher may run after
  // us. Only authorized bootstrap waits, read-only and bounded, outside the
  // hook's awaited lifetime. Nothing is registered before exact verification.
  const deadline = Date.now() + (bootstrap ? 5000 : 0);
  while (true) {
    if (!stillCurrent()) throw new Error("Enrollment superseded by session lifecycle");
    const result = await pi.exec("herdr", ["agent", "get", identity.pane], { timeout: 5000 });
    const agent = result.code === 0 ? JSON.parse(result.stdout).result?.agent : undefined;
    if (agent?.agent === "pi" && agent.pane_id === identity.pane && agent.tab_id === identity.tab && agent.workspace_id === identity.workspace &&
        agent.agent_session?.value === identity.session_file && realpathSync(agent.foreground_cwd || "/") === identity.cwd) break;
    if (!bootstrap || Date.now() >= deadline) throw new Error("Feature endpoint changed during enrollment");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!stillCurrent() || !sameInstance(identity.instance, herdrInstance()) || ctx.sessionManager.getSessionId() !== identity.session || ctx.sessionManager.getSessionFile() !== identity.session_file) throw new Error("Feature endpoint changed during enrollment");
  if (intent.source === "verified-attachment" && !intent.persisted) {
    const current = attachedEnrollment(ctx);
    if (!current || !sameEnrollment(current, identity) || current.relationship !== intent.expected?.relationship) throw new Error("Attachment changed during enrollment; inspect/retry explicitly");
  }
  return identity;
}
