import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJSON, matchesDestination, readJSON, stateRoot } from "./protocol.ts";
import { liveRegistration, readyAttachment, reportingDirectory, validateRequest, verifyEndpoint } from "./attachment.ts";
import { digest, reportingPhaseReady } from "./phase-record.ts";

const ceiling = "This is an attributed coordinator follow-up, not a new launch or phase/session control. Execute only the explicit user-authorized bounded scope within the existing feature. Synthesized context and agent status are not human approval. This operation grants no broader commit, integration, release, push, cleanup, installation, reload, configuration or live app/provider-input permissions. Preserve existing approval ceilings and transcripts; stop on conflict.";
const immutable = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
export function followupDirectory(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid follow-up ID");
  return join(stateRoot(), "followups", id);
}
const marker = (r: any, name: string) => join(followupDirectory(r.id), name + ".json");
const has = (r: any, name: string) => existsSync(marker(r, name));
const slot = (session: string) => join(reportingDirectory(session), "followup-current.json");
const readText = (path: string, limit: number) => {
  const bytes = readFileSync(realpathSync(path));
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (!text.trim() || bytes.length > limit) throw new Error(`Nonempty UTF-8 file, maximum ${limit} bytes, required`);
  return text;
};
function record(id: string) {
  const directory = followupDirectory(id), bytes = readFileSync(join(directory, "record.json"));
  if (digest(bytes) !== readJSON(join(directory, "seal.json")).sha256) throw new Error("Follow-up record changed");
  const r = JSON.parse(bytes.toString());
  if (r.id !== id || r.version !== 1) throw new Error("Follow-up record identity mismatch");
  return r;
}
function state(r: any, status: string, extra: any = {}) {
  const path = marker(r, "status");
  if (existsSync(path)) { const old = readJSON(path); if (old.status === status && old.error === extra.error) return; }
  const value = { id: r.id, status, at: Date.now(), ...extra };
  immutable(join(followupDirectory(r.id), `event-${randomUUID()}.json`), value);
  atomicJSON(path, value);
}
export function activeFollowup(session: string) {
  if (!existsSync(slot(session))) return undefined;
  const r = record(readJSON(slot(session)).id);
  const s = has(r, "status") ? readJSON(marker(r, "status")).status : "uncertain";
  return has(r, "settled") || ["rejected", "cancelled"].includes(s) ? undefined : r;
}
function own(ctx: ExtensionContext, mine: any, expected: any) {
  if (!mine || mine.role !== expected.role || !matchesDestination({ target: expected }, mine) ||
      ctx.sessionManager.getSessionId() !== expected.session || ctx.sessionManager.getSessionFile() !== expected.session_file || realpathSync(ctx.cwd) !== expected.cwd) throw new Error("Follow-up runtime identity changed");
}
function binding(r: any) {
  if (digest(readFileSync(r.receipt)) !== r.receipt_sha256) throw new Error("Original launch receipt changed");
  if (digest(readFileSync(r.relationship)) !== r.relationship_sha256) throw new Error("Follow-up binding source changed");
  const request = readyAttachment(r.relationship);
  const pointer = readJSON(join(reportingDirectory(r.worker.session), "current.json"));
  if (pointer.request !== r.relationship || request.revision !== r.revision || request.feature !== r.feature ||
      !matchesDestination({ target: r.worker }, request.worker) || !matchesDestination({ target: r.coordinator }, request.coordinator)) throw new Error("Follow-up reporting identity/revision changed");
  reportingPhaseReady(request);
  return request;
}
async function validate(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, r: any, role: string) {
  own(ctx, mine, r[role]);
  const request = binding(r);
  for (const endpoint of [r.worker, r.coordinator]) if (!liveRegistration(endpoint).capabilities?.includes("worker-messaging-v1")) throw new Error("Both endpoints require worker-messaging-v1; candidate loading/reload needs separate approval");
  await validateRequest(pi, ctx, mine, request, role);
  binding(r); own(ctx, mine, r[role]);
}
export function followupStatus(id: string) {
  const r = record(id), directory = followupDirectory(id);
  const evidence: any = {};
  for (const name of ["status", "claim", "submitted", "persisted", "settle-claim", "settled", "report"]) if (has(r, name)) evidence[name] = readJSON(marker(r, name));
  if (evidence.report?.acknowledgement && existsSync(evidence.report.acknowledgement)) {
    const ack = readJSON(evidence.report.acknowledgement);
    evidence.coordinatorAcknowledgement = ack.id === `followup-${r.id}` && ack.feature === r.feature && ack.epoch === r.coordinator.epoch ? ack : { status: "uncertain", error: "Coordinator acknowledgement correlation mismatch" };
  }
  let validity = "current";
  try { binding(r); } catch (error) { validity = String(error); }
  return { id, directory, mode: r.mode ?? "legacy-idle-followUp", status: evidence.status?.status ?? "uncertain", validity, evidence,
    note: "Accepted/queued is not API delivery. Submitted is API return only. Persisted proves the exact message, not completed work or human approval. Never replay a claim." };
}
export function followupPrompt(r: any) {
  return [ceiling, `Operation: ${r.id}\nOriginal feature: ${r.feature}\nReporting revision: ${r.revision}\nCoordinator: ${r.coordinator.session} (${r.coordinator.epoch})\nWorker: ${r.worker.session} (${r.worker.epoch})\nWorktree: ${r.cwd}\nAuthorized branch: ${r.branch}${r.mode ? `\nDelivery mode: ${r.mode}` : ""}`,
    `Bounded scope: ${r.scope}\nAuthorization provenance: ${r.provenance}\nVerify cwd/branch/session before changes; stop on mismatch.`,
    "--- USER AUTHORIZATION (verbatim) ---", r.authorization, "--- END USER AUTHORIZATION ---",
    "--- SYNTHESIZED FOLLOW-UP CONTEXT (not additional authorization) ---", r.context || "(none)",
    `Original launch receipt (unchanged): ${r.receipt}\nReport blockers/results here; only this pinned coordinator may receive this operation's report.`].join("\n\n");
}
function transcriptBytes(worker: any) {
  const bytes = readFileSync(worker.session_file), header = JSON.parse(bytes.toString("utf8").split("\n", 1)[0]);
  if (header.type !== "session" || header.id !== worker.session || realpathSync(header.cwd) !== worker.cwd) throw new Error("Follow-up transcript session/worktree identity changed");
  return bytes;
}
function initialTranscript(worker: any) { const bytes = transcriptBytes(worker); return { bytes: bytes.length, sha256: digest(bytes) }; }
function preservedTranscript(r: any) {
  const bytes = transcriptBytes(r.worker);
  if (bytes.length < r.transcript.bytes || digest(bytes.subarray(0, r.transcript.bytes)) !== r.transcript.sha256) throw new Error("Original transcript prefix changed since follow-up admission");
  return bytes;
}
function terminal(r: any) { return has(r, "settled") || (has(r, "status") && ["rejected", "cancelled"].includes(readJSON(marker(r, "status")).status)); }

export async function sendFollowup(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  if (mine?.role !== "coordinator" || !/^[a-zA-Z0-9_-]{1,80}$/.test(input.requestKey || "")) throw new Error("Registered coordinator and stable requestKey required");
  if (!["steer", "followUp"].includes(input.mode)) throw new Error("Explicit mode steer/followUp required");
  if (!["queue", "reject"].includes(input.busyPolicy)) throw new Error("Explicit busyPolicy queue/reject required");
  for (const key of ["scope", "provenance"]) if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 4000) throw new Error(`Bounded ${key} required`);
  const authorization = readText(input.authorizationFile, 32 * 1024), context = input.contextFile ? readText(input.contextFile, 128 * 1024) : "";
  const hash = digest(mine.session + ":" + input.requestKey), id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  const directory = followupDirectory(id), fingerprint = digest(JSON.stringify({ input: Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))), authorization, context }));
  const duplicate = () => { const r = record(id); if (r.fingerprint !== fingerprint) throw new Error(`Conflicting requestKey; inspect ${directory}`); return followupStatus(id); };
  if (existsSync(directory)) return duplicate();
  const relationship = realpathSync(input.relationship), request = readyAttachment(relationship);
  if (request.feature !== input.feature || request.revision !== input.expectedRevision || request.worker.epoch !== input.workerEpoch || request.coordinator.epoch !== input.coordinatorEpoch) throw new Error("Explicit feature, reporting revision and endpoint epochs must match");
  const r = { version: 1, id, fingerprint, feature: request.feature, revision: request.revision, relationship,
    relationship_sha256: digest(readFileSync(relationship)), receipt: request.receipt, receipt_sha256: request.receipt_sha256,
    worker: request.worker, coordinator: request.coordinator, cwd: request.cwd, branch: request.branch, phase: request.phase ?? null,
    scope: input.scope, provenance: input.provenance, authorization, context, mode: input.mode, busyPolicy: input.busyPolicy, ceiling, transcript: initialTranscript(request.worker), created: Date.now() };
  await validate(pi, ctx, mine, r, "coordinator");
  const root = reportingDirectory(r.worker.session), lock = join(root, "control.lock");
  mkdirSync(lock, { mode: 0o700 });
  let created = false;
  try {
    if (existsSync(directory)) return duplicate();
    binding(r); own(ctx, mine, r.coordinator);
    const conflict = activeFollowup(r.worker.session);
    if (conflict) throw new Error(`Conflicting follow-up ${conflict.id}; inspect/cancel unclaimed work explicitly, never silently supersede`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    immutable(join(directory, "record.json"), r);
    immutable(join(directory, "seal.json"), { sha256: digest(readFileSync(join(directory, "record.json"))) });
    created = true;
    atomicJSON(slot(r.worker.session), { id });
    state(r, "accepted");
    immutable(join(stateRoot(), "inbox", r.worker.epoch, id + ".followup.json"), { id, target: r.worker });
  } catch (error) {
    if (created) { state(r, "rejected", { error: String(error) }); return followupStatus(id); }
    throw error;
  } finally { rmdirSync(lock); }
  return followupStatus(id);
}

function persistedEntry(r: any) {
  if (!has(r, "claim")) return undefined;
  const claim = readJSON(marker(r, "claim")), bytes = preservedTranscript(r);
  if (bytes.length < claim.bytes || digest(bytes.subarray(0, claim.bytes)) !== claim.sha256) throw new Error("Original transcript prefix changed");
  return bytes.toString("utf8").trim().split("\n").map(line => JSON.parse(line)).find(e => e.type === "custom_message" && e.customType === "feature-followup" &&
    e.details?.id === r.id && e.details?.revision === r.revision && (!r.mode || e.details?.mode === r.mode) && e.content === followupPrompt(r));
}
export function observeFollowup(ctx: ExtensionContext, mine: any) {
  if (mine?.role !== "worker") return;
  const r = activeFollowup(mine.session);
  if (!r || has(r, "persisted") || !has(r, "claim")) return;
  own(ctx, mine, r.worker);
  try {
    const entry = persistedEntry(r);
    if (!entry) return;
    binding(r);
    immutable(marker(r, "persisted"), { id: r.id, entry: entry.id, revision: r.revision });
    state(r, "persisted", { entry: entry.id });
  } catch (error) { state(r, "uncertain", { error: String(error) }); }
}

type DeliveryBoundary = "turn_end" | "agent_before_settle";
// Timer and actionable boundary hooks may overlap. Serialize per runtime, then
// revalidate; a timer must not race a boundary into a second claim or rejection.
const polling = new WeakMap<object, Promise<void>>();
export async function pollFollowups(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, stillCurrent: () => boolean, blockedUI: () => boolean, boundary?: DeliveryBoundary) {
  while (polling.has(mine)) await polling.get(mine);
  if (!stillCurrent()) return;
  const task = deliverFollowups(pi, ctx, mine, stillCurrent, blockedUI, boundary);
  polling.set(mine, task);
  try { await task; } finally { if (polling.get(mine) === task) polling.delete(mine); }
}
async function deliverFollowups(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, stillCurrent: () => boolean, blockedUI: () => boolean, boundary?: DeliveryBoundary) {
  if (mine.role !== "worker") return;
  for (const file of readdirSync(join(stateRoot(), "inbox", mine.epoch)).filter(f => f.endsWith(".followup.json"))) {
    const envelope = readJSON(join(stateRoot(), "inbox", mine.epoch, file)), r = record(envelope.id);
    if (terminal(r) || has(r, "persisted")) continue;
    try {
      if (!matchesDestination(envelope, mine) || activeFollowup(mine.session)?.id !== r.id) throw new Error("Follow-up destination/operation superseded");
      own(ctx, mine, r.worker);
      if (has(r, "claim")) {
        observeFollowup(ctx, mine);
        // API queue acceptance while streaming is not a missing ACK timeout.
        // Once idle, absence of exact persistence is uncertain, never a retry.
        if (!has(r, "persisted") && (!has(r, "submitted") || ctx.isIdle())) state(r, "uncertain", { error: "Claim without proven persistence; never replay" });
        continue;
      }
      await validate(pi, ctx, mine, r, "worker");
      if (!stillCurrent()) return;
      const atBoundary = r.busyPolicy === "queue" && ((r.mode === "steer" && boundary === "turn_end") || (r.mode === "followUp" && boundary === "agent_before_settle"));
      // External durable queue until the requested safe point. All current
      // tools finish before turn_end; followUp waits through the whole run.
      // Old mode-less receipts retain their original idle-only semantics.
      const busy = () => (!ctx.isIdle() && !atBoundary) || ctx.hasPendingMessages() || blockedUI() || ctx.signal?.aborted === true;
      if (busy()) { state(r, r.busyPolicy === "queue" ? "queued" : "rejected", { error: "Worker busy/pending/UI-blocked; no interruption" }); continue; }
      const lock = join(reportingDirectory(mine.session), "control.lock");
      mkdirSync(lock, { mode: 0o700 });
      try {
        binding(r); own(ctx, mine, r.worker);
        if (terminal(r) || activeFollowup(mine.session)?.id !== r.id) continue;
        if (busy()) { state(r, r.busyPolicy === "queue" ? "queued" : "rejected", { error: "Worker became busy; no interruption" }); continue; }
        const bytes = preservedTranscript(r), deliveryBoundary = ctx.isIdle() ? "idle" : boundary;
        immutable(marker(r, "claim"), { id: r.id, revision: r.revision, epoch: mine.epoch, mode: r.mode ?? "followUp", boundary: deliveryBoundary, bytes: bytes.length, sha256: digest(bytes) });
        pi.sendMessage({ customType: "feature-followup", content: followupPrompt(r), display: true, details: { id: r.id, feature: r.feature, revision: r.revision, sender: r.coordinator, mode: r.mode ?? "followUp" } }, { triggerTurn: true, deliverAs: r.mode ?? "followUp" });
        immutable(marker(r, "submitted"), { id: r.id, status: "api-submitted", mode: r.mode ?? "followUp", boundary: deliveryBoundary });
        if (!has(r, "persisted")) state(r, "submitted");
      } finally { rmdirSync(lock); }
    } catch (error) { state(r, has(r, "claim") ? "uncertain" : "rejected", { error: String(error) }); }
  }
}

// Reporting is pinned to the follow-up binding, never silently rerouted by a
// concurrent attachment. An aborted/settled run is not proof that scope is done.
export async function settleFollowup(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, aborted: boolean, stillCurrent: () => boolean) {
  if (mine.role !== "worker") return false;
  const r = activeFollowup(mine.session);
  if (!r || !has(r, "claim")) return false;
  own(ctx, mine, r.worker); observeFollowup(ctx, mine);
  if (!has(r, "persisted")) return true; // Uncertain operation owns this report; retain it, never reroute.
  const branch = ctx.sessionManager.getBranch() as any[];
  const index = branch.findIndex(e => e.id === readJSON(marker(r, "persisted")).entry);
  const assistant = index >= 0 ? branch.slice(index + 1).reverse().find(e => e.type === "message" && e.message.role === "assistant") : undefined;
  if (!assistant && !aborted) return true;
  if (has(r, "settle-claim")) return true;
  immutable(marker(r, "settle-claim"), { id: r.id, epoch: mine.epoch });
  const text = assistant?.message.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || "Settled without assistant text";
  immutable(marker(r, "settled"), { id: r.id, aborted, assistant: assistant?.id, text });
  state(r, "settled", { aborted, note: "Run settled, not task completion or approval" });
  try {
    await validate(pi, ctx, mine, r, "worker");
    if (!stillCurrent()) throw new Error("Runtime changed before follow-up reporting");
    binding(r);
    const id = `followup-${r.id}`, path = join(stateRoot(), "inbox", r.coordinator.epoch, id + ".request.json");
    immutable(path, { id, kind: "bound-status", feature: r.feature, revision: r.revision, target: r.coordinator, sender: mine, relationship: r.relationship,
      content: `Follow-up ${r.id} settled${aborted ? " (aborted)" : ""}. Agent status only, NOT human approval or proof of task completion. No additional permissions.\n\n${text}` });
    immutable(marker(r, "report"), { id: r.id, status: "queued", path, acknowledgement: path.replace(".request.json", ".ack.json") });
  } catch (error) { immutable(marker(r, "report"), { id: r.id, status: "retained", error: String(error) }); }
  return true;
}

export async function recoverFollowup(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  const r = record(input.id);
  // Same coordinator conversation only. Cancellation/reconciliation grants no
  // delivery capability to a replacement runtime; original endpoints stay frozen.
  own(ctx, mine, { ...r.coordinator, epoch: mine?.epoch });
  await verifyEndpoint(pi, mine);
  const evidence = readText(input.authorizationFile, 32 * 1024);
  const lock = join(reportingDirectory(r.worker.session), "control.lock"); mkdirSync(lock, { mode: 0o700 });
  try {
    own(ctx, mine, { ...r.coordinator, epoch: mine.epoch }); liveRegistration(mine);
    if (followupStatus(r.id).status !== input.expectedStatus) throw new Error("Recovery status changed; inspect again");
    if (terminal(r)) throw new Error("Follow-up already terminal; recovery cannot reopen it");
    if (input.resolution === "cancel-unclaimed") {
      if (has(r, "claim")) throw new Error("Claimed delivery cannot be cancelled/replayed on absence of evidence");
      immutable(join(followupDirectory(r.id), `recovery-${randomUUID()}.json`), { evidence, resolution: input.resolution, coordinator: mine });
      state(r, "cancelled");
    } else if (input.resolution === "confirm-persisted") {
      const entry = persistedEntry(r);
      if (!entry) throw new Error("No exact persisted message; delivery remains uncertain, never replay");
      immutable(join(followupDirectory(r.id), `recovery-${randomUUID()}.json`), { evidence, resolution: input.resolution, entry: entry.id, coordinator: mine });
      if (!has(r, "persisted")) immutable(marker(r, "persisted"), { id: r.id, entry: entry.id, revision: r.revision });
      state(r, "persisted", { entry: entry.id, note: "Persistence reconciled only; no replay/report/epoch adoption" });
    } else throw new Error("Use cancel-unclaimed or confirm-persisted; retries and rerouting unsupported");
  } finally { rmdirSync(lock); }
  return followupStatus(r.id);
}

export function installFollowupTool(pi: ExtensionAPI, registration: () => any) {
  const act = (input: any, ctx: ExtensionContext) => input.action === "send" ? sendFollowup(pi, ctx, registration(), input) :
    input.action === "status" ? followupStatus(input.id) : input.action === "recover" ? recoverFollowup(pi, ctx, registration(), input) : Promise.reject(new Error("Unknown follow-up action"));
  pi.registerCommand("feature-followup", { description: "Bounded steer/followUp: /feature-followup JSON (send/status/recover)", handler: async (args, ctx) => {
    try { const result = await act(JSON.parse(args), ctx); pi.sendMessage({ customType: "feature-followup-result", content: JSON.stringify(result).slice(0, 16000), display: true }, { triggerTurn: false }); }
    catch (error) { ctx.ui.notify(String(error), "error"); }
  } });
  pi.registerTool({ name: "feature_followup", label: "Feature follow-up", executionMode: "sequential",
    description: "Send an explicitly authorized bounded message through the existing worker's Pi API. Explicit mode steer (after current tool calls, before next model request) or followUp (after current work); both start a turn when idle. Busy queue/reject; no aborting tools, terminal input or phase/session control. Stable requestKey and exact feature/binding/epochs required. Status and bounded recovery never replay claims. Output capped at 16 KiB.",
    promptSnippet: "Send/status/recover a pinned coordinator-to-worker follow-up without terminal input",
    promptGuidelines: ["Use feature_followup only with actual user authorization and the exact ready reporting binding. Preserve authorization verbatim separately from context. Reuse the same requestKey on uncertainty; never replay a claim or infer release/live permissions."],
    parameters: { type: "object", additionalProperties: false, required: ["action"], properties: {
      action: { type: "string", enum: ["send", "status", "recover"] }, mode: { type: "string", enum: ["steer", "followUp"] }, busyPolicy: { type: "string", enum: ["queue", "reject"] },
      ...Object.fromEntries(["id", "requestKey", "feature", "relationship", "expectedRevision", "workerEpoch", "coordinatorEpoch", "scope", "provenance", "authorizationFile", "contextFile", "expectedStatus", "resolution"].map(k => [k, { type: "string" }])),
    } } as any,
    async execute(_id, input: any, _signal, _update, ctx) {
      const result = await act(input, ctx), text = JSON.stringify(result, null, 2);
      return { content: [{ type: "text", text: text.length > 16384 ? text.slice(0, 16000) + `\n[Truncated; inspect ${result.directory}]` : text }], details: { id: result.id, status: result.status } };
    },
  });
}
