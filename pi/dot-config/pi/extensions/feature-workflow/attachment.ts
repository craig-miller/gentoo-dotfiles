import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { atomicJSON, herdrInstance, matchesDestination, readJSON, sameInstance, stateRoot } from "./protocol.ts";
import { phaseBranch, reportingPhaseReady } from "./phase-record.ts";

export const reportingDirectory = (session: string) => join(stateRoot(), "reporting", createHash("sha256").update(session).digest("hex"));
export const hasAttachment = (session: string) => existsSync(join(reportingDirectory(session), "current.json"));
const correlated = (value: any, request: any) => value.revision === request.revision && value.feature === request.feature;

export function currentAttachment(request: any) {
  const current = readJSON(join(reportingDirectory(request.worker.session), "current.json"));
  if (!correlated(current, request)) throw new Error("Reporting revision superseded; old binding rejected");
}

export function liveRegistration(expected: any) {
  const live = readJSON(join(stateRoot(), "sessions", expected.epoch + ".json"));
  if (!live.capabilities?.includes("reporting-attach-v1") || !live.live || Date.now() - live.updated > 10_000 || !matchesDestination({ target: expected }, live) ||
      live.role !== expected.role || !sameInstance(live.instance, herdrInstance())) throw new Error("Endpoint stale; explicit rebind with current epochs required");
  return live;
}

export function readyAttachment(path: string) {
  const request = readJSON(path), directory = dirname(path);
  currentAttachment(request);
  const ready = readJSON(join(directory, "ready.json"));
  if (!correlated(ready, request) || ready.status !== "ready" || ready.worker_epoch !== request.worker.epoch ||
      ready.coordinator_epoch !== request.coordinator.epoch) throw new Error("Reporting attachment not ready");
  for (const role of ["worker", "coordinator"]) {
    liveRegistration(request[role]);
    const ack = readJSON(join(directory, `active-${role}.json`));
    if (!correlated(ack, request) || ack.status !== "active" || ack.role !== role || ack.epoch !== request[role].epoch ||
        ack.worker_epoch !== request.worker.epoch || ack.coordinator_epoch !== request.coordinator.epoch) throw new Error("Endpoint agreement missing");
  }
  return request;
}

export async function verifyEndpoint(pi: ExtensionAPI, expected: any) {
  liveRegistration(expected);
  const result = await pi.exec("herdr", ["agent", "get", expected.pane], { timeout: 5000 });
  const agent = result.code === 0 ? JSON.parse(result.stdout).result?.agent : undefined;
  if (agent?.agent !== "pi" || agent?.pane_id !== expected.pane || agent?.tab_id !== expected.tab || agent?.workspace_id !== expected.workspace || agent?.agent_session?.value !== expected.session_file ||
      realpathSync(agent?.foreground_cwd || "/") !== expected.cwd) throw new Error("Endpoint closed/replaced/moved");
  liveRegistration(expected);
  return agent;
}

export async function validateRequest(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, request: any, role: string) {
  currentAttachment(request);
  if (!matchesDestination({ target: request[role] }, mine) || mine.role !== role || ctx.sessionManager.getSessionId() !== mine.session ||
      ctx.sessionManager.getSessionFile() !== mine.session_file || realpathSync(ctx.cwd) !== mine.cwd) throw new Error("Attachment endpoint identity mismatch");
  if (request.worker.role !== "worker" || request.coordinator.role !== "coordinator" || request.worker.session === request.coordinator.session ||
      !sameInstance(request.worker.instance, request.coordinator.instance) || request.worker.common !== request.common ||
      request.coordinator.common !== request.common) throw new Error("Incompatible roles/repositories/instances");
  const bytes = readFileSync(request.receipt);
  if (createHash("sha256").update(bytes).digest("hex") !== request.receipt_sha256) throw new Error("Original receipt changed");
  const receipt = JSON.parse(bytes.toString());
  if (receipt.nonce !== request.feature || receipt.session !== request.worker.session || phaseBranch(request, receipt) !== request.branch ||
      realpathSync(receipt.cwd) !== request.cwd || request.worker.cwd !== request.cwd ||
      (receipt.worker?.session_file && receipt.worker.session_file !== request.worker.session_file)) throw new Error("Receipt/worker mismatch");
  for (const endpoint of [request.worker, request.coordinator]) await verifyEndpoint(pi, endpoint);
  const git = async (cwd: string, args: string[]) => {
    const result = await pi.exec("git", args, { cwd, timeout: 5000 });
    if (result.code) throw new Error(result.stderr || "Git identity failed");
    return result.stdout.trim();
  };
  for (const cwd of [request.cwd, receipt.repo, ctx.cwd]) {
    if (realpathSync(await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) !== request.common) throw new Error("Git repository changed");
  }
  if (await git(request.cwd, ["branch", "--show-current"]) !== request.branch ||
      realpathSync(await git(request.cwd, ["rev-parse", "--show-toplevel"])) !== request.cwd) throw new Error("Worker branch/worktree changed");
  // Deliberately no status/cleanliness/initial-HEAD requirement.
  currentAttachment(request);
  liveRegistration(mine);
}

// Metadata-only two-phase agreement. Safe during a model run: no prompt, abort,
// editor operation or permission change. Every stage is claimed before its ACK.
export async function pollAttachments(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, stillCurrent: () => boolean) {
  const inbox = join(stateRoot(), "inbox", mine.epoch);
  for (const file of readdirSync(inbox).filter(f => f.endsWith(".binding.json"))) {
    const envelope = readJSON(join(inbox, file));
    if (!matchesDestination(envelope, mine) || !["worker", "coordinator"].includes(envelope.role)) continue;
    const request = readJSON(envelope.request), directory = dirname(envelope.request), role = envelope.role;
    if (envelope.revision !== request.revision) continue;
    const stage = existsSync(join(directory, "commit.json")) ? "active" : "prepared";
    const ackPath = join(directory, `${stage}-${role}.json`), claim = ackPath + ".claim";
    if (existsSync(claim)) {
      if (existsSync(join(directory, "ready.json"))) {
        try {
          readyAttachment(envelope.request);
          if (matchesDestination({ target: request[role] }, mine)) ctx.ui.setStatus("feature-reporting",
            `Reporting ready: ${request.revision.slice(0, 8)} → ${request.coordinator.tab}. Future reports only; no new permissions.`);
        } catch { /* Superseded/old epochs never become ready again. */ }
      }
      continue;
    }
    const ack = { revision: request.revision, feature: request.feature, epoch: mine.epoch, role,
      worker_epoch: request.worker.epoch, coordinator_epoch: request.coordinator.epoch, busy: !ctx.isIdle() || ctx.hasPendingMessages() };
    try {
      await validateRequest(pi, ctx, mine, request, role);
      if (!stillCurrent()) return;
      if (stage === "active") {
        if (!correlated(readJSON(join(directory, "commit.json")), request)) throw new Error("Commit correlation mismatch");
        for (const endpoint of ["worker", "coordinator"]) {
          const prepared = readJSON(join(directory, `prepared-${endpoint}.json`));
          if (!correlated(prepared, request) || prepared.status !== "prepared" || prepared.epoch !== request[endpoint].epoch ||
              prepared.worker_epoch !== request.worker.epoch || prepared.coordinator_epoch !== request.coordinator.epoch) throw new Error("Prepare agreement missing");
        }
      }
      writeFileSync(claim, JSON.stringify(ack), { flag: "wx", mode: 0o600 });
      atomicJSON(ackPath, { ...ack, status: stage });
      ctx.ui.setStatus("feature-reporting", `Reporting ${request.revision.slice(0, 8)}: ${stage}; destination ${request.coordinator.tab}. No new permissions.`);
    } catch (error) {
      if (!stillCurrent()) return;
      if (!existsSync(claim)) writeFileSync(claim, JSON.stringify(ack), { flag: "wx", mode: 0o600 });
      atomicJSON(ackPath, { ...ack, status: "rejected", error: String(error) });
      ctx.ui.setStatus("feature-reporting", `Reporting attach blocked: ${error}`);
    }
  }
}

export function validBoundMessage(message: any, mine: any) {
  try {
    const request = readyAttachment(message.relationship);
    reportingPhaseReady(request);
    return message.kind === "bound-status" && correlated(message, request) &&
      matchesDestination({ target: request.coordinator }, mine) && matchesDestination({ target: message.sender }, request.worker);
  } catch { return false; }
}

export async function reportAttached(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, aborted: boolean, stillCurrent: () => boolean) {
  if (mine.role !== "worker" || !hasAttachment(mine.session)) return;
  const directory = reportingDirectory(mine.session);
  const entry = [...ctx.sessionManager.getBranch()].reverse().find((e: any) => e.type === "message" && e.message.role === "assistant") as any;
  const text = entry?.message.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || "Settled without a text response";
  const content = `${aborted ? "Aborted; inspect before continuing.\n" : ""}${text}`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pointer = readJSON(join(directory, "current.json"));
  atomicJSON(join(directory, "last-report.json"), { revision: pointer.revision, epoch: mine.epoch, session: mine.session, content });
  try {
    const request = readyAttachment(pointer.request);
    reportingPhaseReady(request);
    if (!matchesDestination({ target: request.worker }, mine)) throw new Error("Worker epoch changed; explicit rebind required");
    await validateRequest(pi, ctx, mine, request, "worker");
    if (!stillCurrent()) return;
    readyAttachment(pointer.request); // Reject a rebind that raced the asynchronous verification.
    const id = `${Date.now()}-${randomUUID()}`;
    const path = join(stateRoot(), "inbox", request.coordinator.epoch, id + ".request.json");
    atomicJSON(path, { id, kind: "bound-status", revision: request.revision, feature: request.feature,
      target: request.coordinator, sender: mine, relationship: pointer.request,
      content: `Worker report for ${request.branch}, reporting revision ${request.revision}. Agent status only, NOT Craig's approval. Reporting attachment grants no new permissions; do not replay work, relaunch the worker or take over implementation. The original launch brief is in ${request.receipt}; existing conversation instructions and subsequent explicit approvals remain unchanged. Consult those conversations rather than treating status as approval.\n\n${content}` });
    ctx.ui.notify(`Report queued to ${request.coordinator.tab}; acknowledgement: ${path.replace(".request.json", ".ack.json")}`, "info");
  } catch (error) {
    ctx.ui.setStatus("feature-reporting", `Report retained, not sent: ${error}. Explicit rebind required; no automatic resend.`);
  }
}
