import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJSON, matchesDestination, readJSON, sameInstance, stateRoot } from "./protocol.ts";
import { liveRegistration, readyAttachment, reportingDirectory, validateRequest, verifyEndpoint } from "./attachment.ts";
import { digest, phaseBranch, phaseDirectory, phaseRecord } from "./phase-record.ts";
import { contextObservation, evaluateContext } from "./context-policy.ts";
import { activeFollowup } from "./followup.ts";
import { controlRestack } from "./restack.ts";
import { assertNotRestacking, restackReserved } from "./restack-state.ts";

const ceiling = "Only the explicit next-phase scope is authorized. Planning is not implementation. No implicit commit, integration, release, push, cleanup, installation, live configuration or live app/provider input. Release the complete feature, not an intermediate phase. Agent status is never human approval. Preserve transcripts and checkpoints.";
const immutable = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const fileText = (path: string, max = 128 * 1024) => {
  const bytes = readFileSync(realpathSync(path));
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.trim() || bytes.length > max) throw new Error(`Nonempty UTF-8 file (maximum ${max} bytes) required: ${path}`);
  return text;
};
const pointerPath = (session: string) => join(reportingDirectory(session), "phase-current.json");
const marker = (record: any, name: string) => join(phaseDirectory(record.id), name + ".json");
const has = (record: any, name: string) => existsSync(marker(record, name));
const blocked = (record: any) => has(record, "blocked") && (!has(record, "recovery") || readJSON(marker(record, "recovery")).blocked_sha256 !== digest(readFileSync(marker(record, "blocked"))));
const save = (record: any, name: string, data: any = {}) => immutable(marker(record, name), { id: record.id, ...data });
const stopPhase = (record: any, error: unknown) => {
  const failure = { id: record.id, event: randomUUID(), error: String(error), at: Date.now() };
  immutable(join(phaseDirectory(record.id), `failure-${failure.event}.json`), failure);
  atomicJSON(marker(record, "blocked"), failure);
};

export function phaseStatus(id: string) {
  const record = phaseRecord(id), directory = phaseDirectory(id);
  const evidence: Record<string, any> = {};
  for (const name of ["reserved", "compact-claim", "compacted", "compact-failed", "compact-skipped", "recovery", "branch-claim", "branched", "binding", "activated", "delivery-claim", "delivery-submitted", "delivered", "blocked"]) {
    if (has(record, name)) evidence[name] = readJSON(marker(record, name));
  }
  const stage = has(record, "delivered") ? "submitted" : has(record, "delivery-claim") ? "uncertain-assignment-delivery" :
    has(record, "activated") ? "activated-not-delivered" : has(record, "branched") ? "branched-not-activated" :
    has(record, "branch-claim") ? "uncertain-branch" : has(record, "compacted") ? "compacted-not-branched" :
    has(record, "compact-failed") ? "compaction-failed" : has(record, "compact-claim") ? "compaction-pending-or-uncertain" : "requested";
  const reportingPointer = join(reportingDirectory(record.worker.session), "current.json");
  const reporting = existsSync(reportingPointer) ? readJSON(reportingPointer) : undefined;
  const active = reporting?.request && existsSync(reporting.request) ? readJSON(reporting.request) : record;
  const staleEndpoints = ["worker", "coordinator"].filter(role => { try { liveRegistration(active[role]); return false; } catch { return true; } });
  return { id, stage, blocked: blocked(record) ? evidence.blocked : undefined, directory, branch: record.nextBranch, evidence, reporting, staleEndpoints,
    note: "Status is not human approval. Retain resources; no automatic replay, release or cleanup." };
}

async function git(pi: ExtensionAPI, cwd: string, ...args: string[]) {
  const result = await pi.exec("git", args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 });
  if (result.code || result.killed || result.truncated) throw new Error(result.stderr || "Git verification failed");
  return result.stdout.trim();
}

export async function boundary(pi: ExtensionAPI, record: any, after = false) {
  const cwd = record.cwd, branch = after ? record.nextBranch : record.branch;
  if (realpathSync(await git(pi, cwd, "rev-parse", "--show-toplevel")) !== cwd ||
      realpathSync(await git(pi, cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")) !== record.common ||
      await git(pi, cwd, "branch", "--show-current") !== branch || await git(pi, cwd, "rev-parse", "HEAD") !== record.head) throw new Error("Branch/worktree/HEAD drift");
  if (await git(pi, cwd, "status", "--porcelain=v1", "--untracked-files=all")) throw new Error("Clean tree AND index required");
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer", "index.lock"]) {
    if (existsSync(await git(pi, cwd, "rev-parse", "--path-format=absolute", "--git-path", name))) throw new Error(`Git operation in progress: ${name}`);
  }
  const parent = after ? record.branch : record.parent;
  const metadata = JSON.parse(await git(pi, cwd, "show", `refs/branch-metadata/${branch}`));
  const parentHead = await git(pi, cwd, "rev-parse", `refs/heads/${parent}^{commit}`);
  if (metadata.parentBranchName !== parent || metadata.parentBranchRevision !== parentHead || (after && parentHead !== record.head)) throw new Error("Stax parent/revision drift; coordinate restacking separately");
  await git(pi, cwd, "merge-base", "--is-ancestor", parentHead, record.head);
}

function current(record: any) {
  const pointer = readJSON(pointerPath(record.worker.session));
  if (pointer.id !== record.id) throw new Error("Phase superseded");
  phaseRecord(record.id);
}

function workerIdle(ctx: ExtensionContext, blocked: boolean) {
  if (!ctx.isIdle() || ctx.hasPendingMessages() || blocked) throw new Error("Worker busy, queued or UI-blocked; no interruption");
}

async function endpoints(pi: ExtensionAPI, record: any) {
  for (const role of ["worker", "coordinator"]) {
    const live = liveRegistration(record[role]);
    if (!live.capabilities?.includes("phase-transition-v1")) throw new Error("Both endpoints require phase-transition-v1; user-controlled reload required");
    const agent = await verifyEndpoint(pi, record[role]);
    if (role === "worker" && (live.busy || !["idle", "done"].includes(agent.agent_status))) throw new Error("Worker not idle");
  }
}

function own(ctx: ExtensionContext, mine: any, expected: any) {
  if (!matchesDestination({ target: expected }, mine) || mine.role !== expected.role || realpathSync(ctx.cwd) !== expected.cwd ||
      ctx.sessionManager.getSessionId() !== expected.session || ctx.sessionManager.getSessionFile() !== expected.session_file) throw new Error("Runtime identity changed");
}

export async function inspectPhaseContext(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  const request = readyAttachment(realpathSync(input.relationship));
  own(ctx, mine, request.coordinator);
  if (request.revision !== input.expectedRevision) throw new Error("Reporting revision drift");
  await validateRequest(pi, ctx, mine, request, "coordinator");
  const observation = liveRegistration(request.worker).context ?? { percent: null, leaf: null, guidance: "Telemetry unavailable; safe candidate reload required" };
  return { id: request.feature, stage: "context-evaluation-required", directory: dirname(input.relationship), observation,
    note: "At the reviewed/committed boundary evaluate usage, next-phase continuity and debugging history. 70% prompts evaluation, never automatic compaction; below that keep is default. Unknown is not zero. Supply explicit keep/compact and rationale with start." };
}

export async function startPhase(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  if (!mine || mine.role !== "coordinator") throw new Error("Only the registered coordinator can request a phase");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.requestKey || "")) throw new Error("Stable requestKey required");
  const keyRoot = join(stateRoot(), "phase-keys"); mkdirSync(keyRoot, { recursive: true, mode: 0o700 });
  const key = join(keyRoot, digest(mine.session + ":" + input.requestKey) + ".json");
  const fingerprint = digest(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))));
  if (existsSync(key)) {
    const previous = readJSON(key);
    if (previous.fingerprint !== fingerprint) throw new Error("Request key reused with different arguments");
    return phaseStatus(previous.id);
  }
  const request = readyAttachment(realpathSync(input.relationship));
  own(ctx, mine, request.coordinator);
  if (request.revision !== input.expectedRevision) throw new Error("Reporting revision drift");
  await validateRequest(pi, ctx, mine, request, "coordinator");
  if (!/^[a-z][a-z0-9]*(?:[/-][a-z0-9]+)*$/.test(input.nextBranch || "") || input.nextBranch.length > 100) throw new Error("Exact lowercase next branch required");
  await git(pi, request.cwd, "check-ref-format", "--branch", input.nextBranch);
  const duplicate = await pi.exec("git", ["show-ref", "--verify", "--quiet", "refs/heads/" + input.nextBranch], { cwd: request.cwd, timeout: 5000 });
  if (duplicate.code !== 1) throw new Error("Next branch exists or lookup failed; never adopt implicitly");
  if (!/^[a-f0-9]{40,64}$/.test(input.expectedHead || "") || !input.expectedParent || !["keep", "compact"].includes(input.sessionMode)) throw new Error("Expected committed HEAD, Stax parent and keep/compact mode required");
  const record: any = { version: 1, id: randomUUID(), feature: request.feature, receipt: request.receipt, receipt_sha256: request.receipt_sha256,
    common: request.common, cwd: request.cwd, branch: request.branch, head: input.expectedHead, parent: input.expectedParent,
    nextBranch: input.nextBranch, previousPhase: request.phase || null, previousRelationship: realpathSync(input.relationship),
    previousRevision: request.revision, worker: request.worker, coordinator: request.coordinator, sessionMode: input.sessionMode,
    contextEvaluation: evaluateContext(input.contextEvaluation, liveRegistration(request.worker).context, input.sessionMode),
    handoff: fileText(input.handoffFile, 32 * 1024), brief: fileText(input.briefFile), authorization: fileText(input.authorizationFile, 32 * 1024),
    context: input.contextFile ? fileText(input.contextFile) : "", ceiling, created: Date.now() };
  const phasePointer = pointerPath(record.worker.session);
  if (existsSync(phasePointer)) {
    const previous = phaseRecord(readJSON(phasePointer).id);
    if (!has(previous, "delivered") || request.phase !== previous.id) throw new Error("Earlier phase incomplete; correlated recovery required");
  }
  await endpoints(pi, record); await boundary(pi, record);
  readyAttachment(input.relationship); own(ctx, mine, record.coordinator);
  const directory = phaseDirectory(record.id); mkdirSync(directory, { recursive: true, mode: 0o700 });
  immutable(join(directory, "record.json"), record);
  immutable(join(directory, "seal.json"), { sha256: digest(readFileSync(join(directory, "record.json"))) });
  // Exclusive claim tied to the exact reporting revision; crashes never free it.
  const lock = join(reportingDirectory(record.worker.session), "control.lock");
  mkdirSync(lock, { mode: 0o700 });
  try {
    readyAttachment(input.relationship);
    const followup = activeFollowup(record.worker.session);
    if (followup) throw new Error(`Follow-up ${followup.id} pending/uncertain; settle or explicitly cancel it before phase transition`);
    immutable(join(dirname(input.relationship), "next-phase-claim.json"), { id: record.id });
    immutable(key, { id: record.id, fingerprint });
    atomicJSON(phasePointer, { id: record.id });
    for (const role of ["worker", "coordinator"]) {
      immutable(join(stateRoot(), "inbox", record[role].epoch, record.id + ".phase.json"), { id: record.id, target: record[role] });
    }
  } catch (error) {
    stopPhase(record, error);
    throw new Error(`Phase ${record.id} retained at ${directory}: ${error}. Inspect the claim/request key; never blindly retry.`);
  } finally { rmdirSync(lock); }
  return phaseStatus(record.id);
}

function ackBinding(record: any, request: any, stage: string) {
  const directory = dirname(request.path);
  for (const role of ["worker", "coordinator"]) {
    const path = join(directory, `${stage}-${role}.json`);
    if (!existsSync(path)) return false;
    const ack = readJSON(path);
    if (ack.status !== stage || ack.revision !== request.revision || ack.feature !== record.feature || ack.epoch !== record[role].epoch ||
        ack.worker_epoch !== record.worker.epoch || ack.coordinator_epoch !== record.coordinator.epoch) throw new Error(`Reporting ${stage} rejected`);
  }
  return true;
}

function createBinding(record: any) {
  const revision = randomUUID(), directory = join(reportingDirectory(record.worker.session), "revisions", revision);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "request.json");
  const request = { version: 1, revision, feature: record.feature, phase: record.id, receipt: record.receipt, receipt_sha256: record.receipt_sha256,
    common: record.common, cwd: record.cwd, branch: record.nextBranch, worker: record.worker, coordinator: record.coordinator,
    adoption: readJSON(record.previousRelationship).adoption,
    adoption_sha256: readJSON(record.previousRelationship).adoption_sha256,
    previous: { revision: record.previousRevision, request: record.previousRelationship }, scope: "Reporting for the authorized phase only. " + ceiling };
  immutable(path, request);
  save(record, "binding", { path, revision });
  atomicJSON(join(reportingDirectory(record.worker.session), "current.json"), { revision, feature: record.feature, request: path });
  for (const role of ["worker", "coordinator"]) immutable(join(stateRoot(), "inbox", record[role].epoch, revision + ".binding.json"),
    { revision, request: path, target: record[role], role });
}

function transcriptPrefix(ctx: ExtensionContext) {
  const bytes = readFileSync(ctx.sessionManager.getSessionFile()!);
  return { bytes: bytes.length, sha256: digest(bytes) };
}
function verifyTranscript(record: any, before: any) {
  const bytes = readFileSync(record.worker.session_file);
  if (bytes.length < before.bytes || digest(bytes.subarray(0, before.bytes)) !== before.sha256) throw new Error("Transcript prefix changed");
}

export function phasePrompt(record: any) {
  const launch = readJSON(record.receipt);
  return ["Continue the SAME feature in the SAME session and worktree; this is not a fresh launch or a replay.",
    `Phase transition: ${record.id}\nWorktree: ${record.cwd}\nAuthorized branch: ${record.nextBranch}\nPrevious checkpoint: ${record.branch} at ${record.head}\nIntegration base: ${launch.base}`,
    `Verify cwd, branch and PI_SESSION_ID (${record.worker.session}) with your own bash tool before changes. Stop on mismatch.`, ceiling,
    "--- NEXT-PHASE USER BRIEF (verbatim) ---", record.brief, "--- END USER BRIEF ---",
    "--- EXPLICIT AUTHORIZATION EVIDENCE (not worker approval) ---", record.authorization,
    "--- SYNTHESIZED HANDOFF / CONTEXT (not additional authorization) ---", record.handoff, record.context,
    `Original feature brief/receipt (unchanged): ${record.receipt}\nReporting is active for this phase; settled responses route to the coordinator. Stop at this phase's approval boundary.`].join("\n\n");
}

function persistedAssignment(record: any) {
  if (!has(record, "delivery-claim") || !has(record, "binding")) return undefined;
  const revision = readJSON(marker(record, "binding")).revision;
  return readFileSync(record.worker.session_file, "utf8").trim().split("\n").map(line => JSON.parse(line)).find(e =>
    e.type === "custom_message" && e.customType === "feature-phase-assignment" && e.details?.phase === record.id && e.details?.revision === revision && e.content === phasePrompt(record));
}

export function acknowledgePendingPhase(ctx: ExtensionContext, mine: any) {
  if (mine?.role !== "worker" || !existsSync(pointerPath(mine.session))) return;
  const record = phaseRecord(readJSON(pointerPath(mine.session)).id);
  if (!has(record, "delivered") && persistedAssignment(record)) acknowledgePhaseAssignment(ctx, mine, record.id);
}

export function acknowledgePhaseAssignment(ctx: ExtensionContext, mine: any, id: string) {
  const record = phaseRecord(id); current(record); own(ctx, mine, record.worker);
  if (has(record, "delivered")) return;
  const entry = persistedAssignment(record);
  if (!entry) throw new Error("Assignment not persisted; delivery remains uncertain");
  readyAttachment(readJSON(marker(record, "binding")).path);
  verifyTranscript(record, readJSON(marker(record, "reserved")).before);
  save(record, "delivered", { status: "persisted", entry: entry.id, revision: entry.details.revision });
}

// One bounded step per poll; compaction completion is callback-correlated, never
// inferred from a timer or another session_compact event. No model polling loop.
export async function pollPhases(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, stillCurrent: () => boolean, blockedUI: () => boolean) {
  const inbox = join(stateRoot(), "inbox", mine.epoch);
  for (const file of readdirSync(inbox).filter(f => f.endsWith(".phase.json"))) {
    const envelope = readJSON(join(inbox, file));
    if (!matchesDestination(envelope, mine)) continue;
    const record = phaseRecord(envelope.id);
    if (mine.role !== "worker" || has(record, "delivered") || blocked(record)) continue;
    try {
      current(record); own(ctx, mine, record.worker);
      if (!stillCurrent()) return;
      if (has(record, "delivery-claim")) { acknowledgePhaseAssignment(ctx, mine, record.id); continue; }
      if (has(record, "compact-claim") && !has(record, "compacted") && !has(record, "compact-skipped")) continue;
      workerIdle(ctx, blockedUI());
      await endpoints(pi, record);
      if (!stillCurrent()) return;
      workerIdle(ctx, blockedUI()); current(record); own(ctx, mine, record.worker);
      if (!has(record, "branched")) {
        readyAttachment(record.previousRelationship);
        await boundary(pi, record);
        if (!stillCurrent()) return;
        workerIdle(ctx, blockedUI()); current(record);
        if (!has(record, "reserved")) {
          evaluateContext(record.contextEvaluation, contextObservation(ctx), record.sessionMode);
          save(record, "reserved", { before: transcriptPrefix(ctx) }); return;
        }
        if (record.sessionMode === "compact" && !has(record, "compact-claim")) {
          const before = transcriptPrefix(ctx), priorEntries = ctx.sessionManager.getEntries().map(e => e.id);
          save(record, "compact-claim", { before, priorEntries });
          ctx.compact({ customInstructions: `Phase boundary ${record.id}. Preserve all authorization ceilings and unresolved decisions. Handoff:\n${record.handoff}\n${ceiling}`,
            onComplete: () => {
              try {
                if (!stillCurrent()) throw new Error("Runtime replaced during compaction");
                current(record); own(ctx, mine, record.worker); verifyTranscript(record, before);
                const entries = ctx.sessionManager.getEntries().filter(e => e.type === "compaction" && !priorEntries.includes(e.id));
                if (entries.length !== 1) throw new Error("Compaction callback has missing/ambiguous persisted entries");
                save(record, "compacted", { entry: entries[0].id, before, session: mine.session, session_file: mine.session_file });
              } catch (error) { stopPhase(record, error); }
            },
            onError: error => { save(record, "compact-failed", { error: String(error) }); stopPhase(record, error); },
          });
          return;
        }
        if (has(record, "branch-claim")) throw new Error("Branch operation already claimed; inspect and explicitly recover, never retry");
        // Recheck after all asynchronous verification, immediately before mutation.
        readyAttachment(record.previousRelationship); workerIdle(ctx, blockedUI()); current(record);
        save(record, "branch-claim");
        const result = await pi.exec("stax", ["create", record.nextBranch, "--prefix", ""], { cwd: record.cwd, timeout: 30_000, maxBuffer: 128 * 1024 });
        if (result.code || result.killed || result.truncated) throw new Error(`Stax outcome uncertain: ${result.stderr || result.stdout}`);
        if (!stillCurrent()) return;
        await boundary(pi, record, true); current(record); own(ctx, mine, record.worker);
        save(record, "branched", { branch: record.nextBranch, head: record.head, parent: record.branch });
        return;
      }
      await boundary(pi, record, true);
      if (!stillCurrent()) return;
      workerIdle(ctx, blockedUI()); current(record); own(ctx, mine, record.worker);
      if (!has(record, "binding")) {
        // The old relationship's branch check intentionally cannot pass now.
        // Its exact pointer must still be current before phase authorization activates.
        const pointer = readJSON(join(reportingDirectory(mine.session), "current.json"));
        if (pointer.revision !== record.previousRevision || pointer.request !== record.previousRelationship) throw new Error("Reporting changed before phase activation");
        createBinding(record); return;
      }
      const binding = readJSON(marker(record, "binding")), request = readJSON(binding.path), directory = dirname(binding.path);
      const pointer = readJSON(join(reportingDirectory(mine.session), "current.json"));
      if (pointer.revision !== binding.revision || pointer.request !== binding.path) throw new Error("Phase reporting superseded");
      if (!existsSync(join(directory, "commit.json"))) {
        if (ackBinding(record, { ...binding }, "prepared")) immutable(join(directory, "commit.json"), { revision: request.revision, feature: record.feature });
        return;
      }
      if (!existsSync(join(directory, "ready.json"))) {
        if (ackBinding(record, binding, "active")) immutable(join(directory, "ready.json"), { revision: request.revision, feature: record.feature,
          worker_epoch: record.worker.epoch, coordinator_epoch: record.coordinator.epoch, status: "ready" });
        return;
      }
      readyAttachment(binding.path);
      if (!has(record, "activated")) { save(record, "activated", { revision: request.revision }); return; }
      if (has(record, "delivery-claim")) throw new Error("Assignment delivery uncertain; never replay");
      await validateRequest(pi, ctx, mine, request, "worker");
      if (!stillCurrent()) return;
      workerIdle(ctx, blockedUI()); current(record); readyAttachment(binding.path);
      verifyTranscript(record, readJSON(marker(record, "reserved")).before);
      save(record, "delivery-claim", { revision: request.revision });
      pi.sendMessage({ customType: "feature-phase-assignment", content: phasePrompt(record), display: true, details: { phase: record.id, revision: request.revision } }, { triggerTurn: true });
      save(record, "delivery-submitted", { status: "api-submitted", revision: request.revision });
    } catch (error) {
      stopPhase(record, error);
      ctx.ui.setStatus("feature-phase", `Phase ${record.id}: blocked; inspect durable evidence, no automatic retry`);
    }
  }
}

export function phaseReserved(session: string): boolean {
  if (restackReserved(session)) return true;
  if (!existsSync(pointerPath(session))) return false;
  const record = phaseRecord(readJSON(pointerPath(session)).id);
  return has(record, "reserved") && !has(record, "delivered");
}

// Recovery never repeats a side effect. It reconciles verified evidence or
// resumes an unclaimed step, under the original live endpoint epochs only.
export async function recoverPhase(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  const record = phaseRecord(input.id); current(record); own(ctx, mine, record.coordinator);
  if (phaseStatus(record.id).stage !== input.expectedStage) throw new Error("Recovery stage changed; inspect again");
  const evidence = fileText(input.authorizationFile, 32 * 1024);
  await endpoints(pi, record);
  if (!has(record, "blocked")) throw new Error("No stopped operation to recover; pending operations must not be raced");
  if (has(record, "delivery-claim")) {
    const binding = readJSON(marker(record, "binding"));
    const entry = persistedAssignment(record);
    if (!entry) throw new Error("No exact persisted assignment; delivery remains uncertain. Replaying is unsupported");
    if (!has(record, "delivered")) save(record, "delivered", { status: "persisted", entry: entry.id, revision: binding.revision });
  } else if (has(record, "branch-claim") && !has(record, "branched")) {
    await boundary(pi, record, true);
    save(record, "branched", { branch: record.nextBranch, head: record.head, parent: record.branch, recovered: true });
  } else if (has(record, "compact-claim") && !has(record, "compacted") && !has(record, "compact-skipped")) {
    if (!has(record, "compact-failed") || input.resolution !== "keep-after-failed-compaction") throw new Error("Compaction completion unconfirmed: never retry. A correlated failure can be explicitly recovered with keep-after-failed-compaction and user authorization");
    await boundary(pi, record);
    save(record, "compact-skipped", { evidence, failure: digest(readFileSync(marker(record, "compact-failed"))) });
  } else {
    await boundary(pi, record, has(record, "branched"));
  }
  current(record); own(ctx, mine, record.coordinator); await endpoints(pi, record);
  const recovery = { id: record.id, evidence, blocked_sha256: digest(readFileSync(marker(record, "blocked"))), at: Date.now() };
  immutable(join(phaseDirectory(record.id), `recovery-${randomUUID()}.json`), recovery);
  atomicJSON(marker(record, "recovery"), recovery);
  return phaseStatus(record.id);
}

function sameSessionEndpoint(a: any, b: any) {
  return sameInstance(a.instance, b.instance) && ["session", "session_file", "common", "cwd", "pane", "tab", "workspace", "role"].every(key => a[key] === b[key]);
}

export async function renewPhase(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  const record = phaseRecord(input.id); current(record);
  assertNotRestacking(record.worker.session);
  if (!has(record, "delivered")) throw new Error("Partial phase cannot be renewed; retain state and recover with the original epochs");
  if (!sameSessionEndpoint(mine, record.coordinator)) throw new Error("Renewal requires the same coordinator session/pane/worktree; successor binding unsupported");
  if (!/^[a-f0-9-]{36}$/.test(input.workerEpoch || "")) throw new Error("Explicit current worker epoch required");
  const worker = liveRegistration(readJSON(join(stateRoot(), "sessions", input.workerEpoch + ".json")));
  if (!sameSessionEndpoint(worker, record.worker)) throw new Error("Renewal requires the same worker session/pane/worktree");
  own(ctx, mine, mine);
  for (const endpoint of [worker, mine]) { await verifyEndpoint(pi, endpoint); if (!endpoint.capabilities?.includes("phase-transition-v1")) throw new Error("Phase extension required"); }
  if (await git(pi, record.cwd, "branch", "--show-current") !== record.nextBranch) throw new Error("Unauthorized branch drift");
  const root = reportingDirectory(worker.session), pointerFile = join(root, "current.json"), lock = join(root, "control.lock");
  mkdirSync(lock, { mode: 0o700 });
  try {
    own(ctx, mine, mine); current(record); liveRegistration(mine); liveRegistration(worker);
    const previous = readJSON(pointerFile);
    if (previous.revision !== input.expectedRevision) throw new Error("Exact current reporting revision required; no blind retry");
    const old = readJSON(previous.request);
    phaseBranch(old, readJSON(record.receipt));
    const revision = randomUUID(), directory = join(root, "revisions", revision), path = join(directory, "request.json");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const request = { ...old, revision, worker, coordinator: mine, previous, scope: "Same-session phase reporting renewal only. No assignment replay or additional permission." };
    immutable(path, request);
    atomicJSON(pointerFile, { revision, feature: record.feature, request: path });
    for (const role of ["worker", "coordinator"]) immutable(join(stateRoot(), "inbox", request[role].epoch, revision + ".binding.json"), { revision, request: path, target: request[role], role });
    immutable(join(stateRoot(), "inbox", mine.epoch, revision + ".renew.json"), { target: mine, request: path });
    return { id: record.id, stage: "renewal-pending", directory, revision, note: "Reporting only; no brief or saved report replay." };
  } finally { rmdirSync(lock); }
}

export async function pollRenewals(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, stillCurrent: () => boolean) {
  if (mine.role !== "coordinator") return;
  for (const file of readdirSync(join(stateRoot(), "inbox", mine.epoch)).filter(f => f.endsWith(".renew.json"))) {
    const envelope = readJSON(join(stateRoot(), "inbox", mine.epoch, file));
    if (!matchesDestination(envelope, mine)) continue;
    const request = readJSON(envelope.request), directory = dirname(envelope.request);
    if (existsSync(join(directory, "ready.json")) || existsSync(join(directory, "blocked.json"))) continue;
    try {
      await validateRequest(pi, ctx, mine, request, "coordinator");
      if (!stillCurrent()) return;
      const stage = existsSync(join(directory, "commit.json")) ? "active" : "prepared";
      if (!ackBinding(request, { path: envelope.request, revision: request.revision }, stage)) continue;
      if (stage === "prepared") immutable(join(directory, "commit.json"), { feature: request.feature, revision: request.revision });
      else immutable(join(directory, "ready.json"), { feature: request.feature, revision: request.revision, worker_epoch: request.worker.epoch, coordinator_epoch: request.coordinator.epoch, status: "ready" });
    } catch (error) { immutable(join(directory, "blocked.json"), { error: String(error) }); }
  }
}

export function installPhaseTool(pi: ExtensionAPI, registration: () => any) {
  const act = async (input: any, ctx: ExtensionContext) => String(input.action).startsWith("restack-") ? controlRestack(pi, ctx, registration(), input) : input.action === "status" ? phaseStatus(input.id) :
    input.action === "recover" ? recoverPhase(pi, ctx, registration(), input) : input.action === "renew" ? renewPhase(pi, ctx, registration(), input) :
    input.action === "inspect" ? inspectPhaseContext(pi, ctx, registration(), input) : input.action === "start" ? startPhase(pi, ctx, registration(), input) : Promise.reject(new Error("Unknown phase action"));
  pi.registerCommand("feature-phase", {
    description: "Same-session phases and phased-stack restack/adoption: /feature-phase JSON; explicit bounded authorization required",
    handler: async (args, ctx) => {
      try { const result = await act(JSON.parse(args), ctx); pi.sendMessage({ customType: "feature-phase-result", content: JSON.stringify(result, null, 2).slice(0, 16000), display: true }, { triggerTurn: false }); }
      catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });
  pi.registerTool({ name: "feature_phase", label: "Feature phase", executionMode: "sequential",
    promptSnippet: "Advance an authorized feature phase, or inspect/coordinate explicit phased-stack restack adoption in its existing worktree/session",
    promptGuidelines: ["Use feature_phase start only with explicit user-approved next-phase scope at a clean committed checkpoint. Restack actions are separate: inspect first, then pin inspectionFile/inspectionHash and verbatim authorization for preservation, cleaning, Stax restacking and restoration; adoption requires separate authorization after inspecting mapping/conflict evidence. Do not run recovery on an active feature merely because synthetic tests pass. Inspect context usage and explicitly assess continuity/debugging history; 70% prompts evaluation, never automatic compaction, and unknown is not zero. Preserve verbatim brief and authorization evidence separately from synthesized context. Reuse the same requestKey on uncertainty; never replay or infer commit/release/live-input permission from status."],
    description: "Same-session phase transitions or explicitly authorized phased-stack restack/adoption. Restack actions: inspect/start/status/adopt/continue/recover/renew prefixed restack-. Inspect is read-only; start requires exact inspectionFile/inspectionHash, stable requestKey and authorizationFile. Adopt/recover/continue/renew require id, expectedStage, stable requestKey and authorizationFile; renew also pins workerEpoch. restack-report-recover requires id, stable requestKey and authorizationFile and repairs notifications only, even after operation completion; never replays Git/assignments or grants acceptance or release authority. Output capped at 16 KiB.",
    parameters: { type: "object", additionalProperties: false, required: ["action"], properties: {
      action: { type: "string", enum: ["inspect", "start", "status", "recover", "renew", "restack-inspect", "restack-start", "restack-status", "restack-adopt", "restack-continue", "restack-recover", "restack-renew", "restack-cancel", "restack-report-recover"] },
      ...Object.fromEntries(["id", "resolution", "workerEpoch", "expectedStage", "requestKey", "relationship", "expectedRevision", "expectedHead", "expectedParent", "nextBranch", "handoffFile", "briefFile", "authorizationFile", "contextFile", "inspectionFile", "inspectionHash"].map(key => [key, { type: "string" }])),
      sessionMode: { type: "string", enum: ["keep", "compact"] },
      contextEvaluation: { type: "object", additionalProperties: false, required: ["usagePercent", "leaf", "continuity", "debuggingHistory", "rationale"], properties: {
        usagePercent: { type: ["number", "null"], minimum: 0 }, leaf: { type: ["string", "null"] },
        continuity: { type: "string", minLength: 1, maxLength: 4000 }, debuggingHistory: { type: "string", minLength: 1, maxLength: 4000 }, rationale: { type: "string", minLength: 1, maxLength: 4000 },
      } },

    } } as any,
    async execute(_id, input: any, _signal, _update, ctx) {
      const result = await act(input, ctx);
      const text = JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text: text.length > 16384 ? text.slice(0, 16000) + `\n[Truncated; inspect ${result.directory}]` : text }], details: { id: result.id, stage: result.stage } };
    },
  });
}
