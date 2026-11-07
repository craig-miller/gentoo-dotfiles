// Restack results use the existing coordinator inbox, not another transport.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicJSON, matchesDestination, readJSON, sameInstance, stateRoot } from "./protocol.ts";
import { liveRegistration, verifyEndpoint } from "./attachment.ts";
import { hash, restackDirectory, restackRecord } from "./restack-state.ts";

const immutable = (p: string, data: any) => writeFileSync(p, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const same = (a: any, b: any) => sameInstance(a.instance, b.instance) && ["session", "session_file", "common", "cwd", "pane", "tab", "workspace", "role"].every(k => a[k] === b[k]);
function runtime(r: any) { const p = join(restackDirectory(r.id), "runtime.json"); return existsSync(p) ? readJSON(p) : r; }
const eventsDir = (id: string) => join(restackDirectory(id), "reports");
function eventDir(id: string, event: string) {
  if (!/^[a-f0-9]{64}$/.test(event)) throw Error("Invalid operation event");
  return join(eventsDir(id), event);
}
function eventRecord(id: string, event: string) {
  const r = restackRecord(id), dir = eventDir(id, event), bytes = readFileSync(join(dir, "event.json"));
  if (readJSON(join(dir, "seal.json")).sha256 !== hash(bytes)) throw Error("Operation report changed");
  const e = JSON.parse(bytes.toString());
  if (e.operation !== id || e.id !== event || e.feature !== r.feature || hash(readFileSync(e.evidence)) !== e.evidenceHash) throw Error("Operation result evidence changed");
  return { r, e, dir };
}
function recordEvent(r: any, kind: string, evidence: string, next: string, attention: boolean) {
  const evidenceHash = hash(readFileSync(evidence)), id = hash(r.id + ":" + kind + ":" + evidenceHash), dir = eventDir(r.id, id);
  if (existsSync(join(dir, "event.json"))) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const content = `Restack ${r.id}: ${kind}.\nFeature: ${r.feature}\nEvidence: ${evidence}\nNext step: ${next}\nHuman attention required: ${attention}.\nOperation state, report delivery and human approval are distinct. This is tooling status, NOT human approval. Do not replay Git operations, assignments or saved reports. Continue already-authorized work quietly; ask Craig only for missing approval, a decision or recovery.`;
  const snapshot = join(dir, "evidence.json");
  writeFileSync(snapshot, readFileSync(evidence), { flag: "wx", mode: 0o600 });
  immutable(join(dir, "event.json"), { id, operation: r.id, feature: r.feature, kind, evidence: snapshot, sourceEvidence: evidence, evidenceHash, next, attention, content });
  immutable(join(dir, "seal.json"), { sha256: hash(readFileSync(join(dir, "event.json"))) });
}
function discover(r: any, now: number) {
  const dir = restackDirectory(r.id), p = (n: string) => join(dir, n + ".json");
  if (existsSync(p("completed"))) recordEvent(r, "adoption-completed", p("completed"), "Reservation released. Report the result; rerun automated and affected live/review checks within existing authorization. Ask only for missing permissions.", false);
  else if (existsSync(p("cancelled"))) recordEvent(r, "cancelled", p("cancelled"), "Reservation released before cleaning; retained evidence is not cleanup authorization.", false);
  else if (existsSync(p("stopped")) && !readJSON(p("stopped")).recovered) {
    const stop = readJSON(p("stopped")), evidence = p("failure-" + stop.event);
    recordEvent(r, "blocked", evidence, `Worker remains reserved: ${stop.error}. Inspect evidence and request explicit recovery/decision; do not retry side effects.`, true);
  } else if (existsSync(p("restored")) && !existsSync(p("adoption"))) recordEvent(r, "awaiting-adoption", p("restored"), "Candidate restored; worker remains reserved. Inspect mapping/conflict evidence and ask Craig for adoption approval.", true);
  else if (existsSync(p("adoption")) && !existsSync(p("binding"))) recordEvent(r, "activation-incomplete", p("adoption"), "Worker remains reserved: adoption has no reporting binding. Request correlated recovery, not another adoption/Git execution.", true);
  else if (existsSync(p("binding")) && now - statSync(p("binding")).mtimeMs > 30_000) recordEvent(r, "waiting-for-acknowledgements", p("binding"), "Worker remains reserved: reporting activation has not completed within 30 seconds. Inspect endpoint/ACK state and coordinate recovery; do not replay operations.", true);
  else if (!existsSync(p("restored")) && !existsSync(p("adoption"))) {
    const markers = ["record", "reserved", "preserved", "clean-claim", "cleaned", "execute-claim", "executed", "mapping", "restore-claim"].filter(n => existsSync(p(n)));
    const latest = markers.reverse().sort((a, b) => statSync(p(b)).mtimeMs - statSync(p(a)).mtimeMs)[0];
    const limit = latest === "record" ? 30_000 : 360_000; // Executor allows 330 seconds; do not call normal running work stalled.
    if (now - statSync(p(latest)).mtimeMs > limit) recordEvent(r, "progress-unconfirmed", p(latest), "No confirmed asynchronous progress within the bounded observation window. Worker may be idle/deferred or an execution outcome uncertain. Inspect its state and coordinate recovery; never rerun claimed side effects.", true);
  }
  // An unavailable worker can prevent even the first asynchronous step. The
  // coordinator can discover this without requiring the worker to be running.
  if (!existsSync(p("completed")) && !existsSync(p("cancelled"))) {
    try { liveRegistration(runtime(r).worker); }
    catch { recordEvent(r, "worker-unavailable", existsSync(p("runtime")) ? p("runtime") : p("record"), "Worker endpoint is unavailable/stale. Work may remain reserved. Inspect and coordinate explicit same-session/reporting recovery; do not launch a replacement.", true); }
  }
}
function obsolete(r: any, e: any) {
  const dir = restackDirectory(r.id), has = (n: string) => existsSync(join(dir, n + ".json"));
  if (e.kind === "awaiting-adoption") return has("adoption") || has("cancelled") || has("completed");
  if (e.kind === "blocked") return !has("stopped") || !!readJSON(join(dir, "stopped.json")).recovered || readJSON(join(dir, "stopped.json")).event !== readJSON(e.evidence).event;
  if (e.kind === "worker-unavailable") { try { liveRegistration(runtime(r).worker); return true; } catch { return false; } }
  if (e.kind === "progress-unconfirmed") return has("completed") || has("cancelled") || has("restored");
  if (["activation-incomplete", "waiting-for-acknowledgements"].includes(e.kind)) return has("completed") || has("cancelled");
  return false;
}
function lock(dir: string, mine: any) {
  try { mkdirSync(join(dir, "delivery.lock"), { mode: 0o700 }); immutable(join(dir, "delivery.lock", "owner.json"), mine); return true; }
  catch (e: any) { if (e.code === "EEXIST") return false; throw e; }
}
function unlock(dir: string, mine: any) {
  const held = join(dir, "delivery.lock"), owner = join(held, "owner.json");
  // A replaced runtime's finally block must not release its successor's lock.
  if (!existsSync(owner) || !matchesDestination({ target: readJSON(owner) }, mine)) return;
  unlinkSync(owner); rmdirSync(held);
}
function persisted(target: any, event: any, claim: any) {
  const bytes = readFileSync(target.session_file), header = JSON.parse(bytes.toString().split("\n", 1)[0]);
  if (header.type !== "session" || header.id !== target.session || realpathSync(header.cwd) !== target.cwd || bytes.length < claim.bytes || hash(bytes.subarray(0, claim.bytes)) !== claim.sha256) throw Error("Coordinator transcript identity/prefix changed");
  return bytes.toString().trim().split("\n").map(line => JSON.parse(line)).find(e => e.type === "custom_message" && e.customType === "feature-coordination" && e.details?.operationEvent === event.id && e.details?.operation === event.operation && e.content === event.content);
}
function reconcile(dir: string, e: any) {
  const claimFile = join(dir, "claim.json");
  if (!existsSync(claimFile) || existsSync(join(dir, "persisted.json"))) return;
  const claim = readJSON(claimFile), entry = persisted(claim.target, e, claim);
  if (entry) immutable(join(dir, "persisted.json"), { event: e.id, operation: e.operation, entry: entry.id, target: claim.target, status: "persisted", approval: false });
}
export function operationReportStatus(id: string) {
  restackRecord(id); const root = eventsDir(id);
  return existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).map(event => {
    const { dir, e } = eventRecord(id, event);
    const state = existsSync(join(dir, "persisted.json")) ? "persisted" : existsSync(join(dir, "superseded.json")) ? "superseded-without-delivery" : existsSync(join(dir, "api-submitted.json")) ? "submitted-unconfirmed" : existsSync(join(dir, "claim.json")) ? "uncertain" : existsSync(join(dir, "route.json")) ? "queued" : "retained";
    return { event, kind: e.kind, state, next: e.next, attention: e.attention, directory: dir };
  }) : [];
}
export async function pollOperationReports(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, stillCurrent: () => boolean, now = Date.now()) {
  const inbox = join(stateRoot(), "inbox", mine.epoch);
  for (const file of readdirSync(inbox).filter(n => n.endsWith(".restack.json") || n.endsWith(".operation-report.json"))) {
    const envelope = readJSON(join(inbox, file)); if (!matchesDestination(envelope, mine)) continue;
    try {
      const r = restackRecord(envelope.id); let endpoints = runtime(r);
      if (file.endsWith(".operation-report.json")) {
        const bytes = readFileSync(envelope.recovery), proof = JSON.parse(bytes.toString());
        if (hash(bytes) !== envelope.recoveryHash || proof.operation !== r.id || proof.reportOnly !== true || !matchesDestination({ target: proof.coordinator }, mine) || mine.role !== "coordinator" || !same(mine, r.coordinator)) throw Error("Report-only observation authority mismatch");
        endpoints = { ...endpoints, coordinator: mine };
      } else if (!same(mine, r[mine.role]) || !matchesDestination({ target: endpoints[mine.role] }, mine)) continue;
      discover(r, now);
      if (!existsSync(eventsDir(r.id))) continue;
      for (const id of readdirSync(eventsDir(r.id), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
        const { e, dir } = eventRecord(r.id, id); if (!lock(dir, mine)) continue;
        try {
          reconcile(dir, e);
          if (existsSync(join(dir, "persisted.json")) || existsSync(join(dir, "claim.json"))) continue;
          if (obsolete(r, e)) { if (!existsSync(join(dir, "superseded.json"))) immutable(join(dir, "superseded.json"), { event: e.id, status: "superseded-before-delivery" }); continue; }
          const routeFile = join(dir, "route.json");
          if (!existsSync(routeFile)) {
            if (!liveRegistration(endpoints.coordinator).capabilities?.includes("operation-report-v1")) throw Error("Coordinator requires operation-report-v1; separately authorize idle reload/report recovery");
            await verifyEndpoint(pi, endpoints.coordinator); if (!stillCurrent()) return;
            const route = { event: e.id, operation: r.id, target: endpoints.coordinator, generation: hash(endpoints.coordinator.epoch + e.id) };
            immutable(join(dir, "route-" + route.generation + ".json"), route); atomicJSON(routeFile, route);
          }
          const route = readJSON(routeFile), path = join(stateRoot(), "inbox", route.target.epoch, "operation-" + route.generation + ".request.json");
          if (!existsSync(path)) immutable(path, { id: "operation-" + route.generation, kind: "operation-status", feature: r.feature, target: route.target, operation: r.id, event: e.id, route: route.generation });
        } finally { unlock(dir, mine); }
      }
    } catch (error) { ctx.ui.setStatus("feature-operation-report", `Operation report retained/blocked: ${error}`); }
  }
}
// Called by the existing coordinator inbox before generic bound-status handling.
// No readyAttachment/worker-branch check: this narrow record-bound path must
// report reserved/conflicted/unavailable workers without granting execution.
export async function deliverOperationReport(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, message: any, base: string, stillCurrent: () => boolean, blocked: () => boolean) {
  const { r, e, dir } = eventRecord(message.operation, message.event);
  if (mine.role !== "coordinator" || !same(mine, r.coordinator) || !matchesDestination(message, mine) || ctx.sessionManager.getSessionId() !== mine.session || ctx.sessionManager.getSessionFile() !== mine.session_file || realpathSync(ctx.cwd) !== mine.cwd) throw Error("Operation report destination mismatch");
  if (!lock(dir, mine)) return;
  const reply = (status: string, error?: string) => atomicJSON(base + ".ack.json", { id: message.id, event: e.id, epoch: mine.epoch, status, error });
  try {
    const route = readJSON(join(dir, "route.json"));
    if (message.feature !== r.feature || message.id !== "operation-" + route.generation || route.generation !== message.route || !matchesDestination({ target: route.target }, mine)) { reply("rejected", "Report route superseded"); return; }
    reconcile(dir, e);
    if (existsSync(join(dir, "persisted.json"))) { reply("persisted"); return; }
    if (existsSync(join(dir, "claim.json"))) { reply("uncertain", "Claim exists without confirmed persistence; never resend"); return; }
    if (obsolete(r, e)) { if (!existsSync(join(dir, "superseded.json"))) immutable(join(dir, "superseded.json"), { event: e.id, status: "superseded-before-delivery" }); reply("superseded"); return; }
    if (!ctx.isIdle() || ctx.hasPendingMessages() || blocked()) { reply("queued"); return; }
    await verifyEndpoint(pi, mine);
    if (!stillCurrent() || !ctx.isIdle() || ctx.hasPendingMessages() || blocked()) return;
    if (readJSON(join(dir, "route.json")).generation !== route.generation) throw Error("Operation report route drift");
    const bytes = readFileSync(mine.session_file), header = JSON.parse(bytes.toString().split("\n", 1)[0]);
    if (header.type !== "session" || header.id !== mine.session || realpathSync(header.cwd) !== mine.cwd) throw Error("Coordinator transcript header mismatch");
    immutable(join(dir, "claim.json"), { event: e.id, target: mine, bytes: bytes.length, sha256: hash(bytes) });
    try {
      pi.sendMessage({ customType: "feature-coordination", content: e.content, display: true, details: { feature: r.feature, operation: r.id, operationEvent: e.id } }, { triggerTurn: true });
      immutable(join(dir, "api-submitted.json"), { event: e.id, status: "api-submitted", approval: false });
      reply("submitted"); reconcile(dir, e);
      if (existsSync(join(dir, "persisted.json"))) reply("persisted");
    } catch (error) { reply("uncertain", String(error)); }
  } finally { unlock(dir, mine); }
}
export async function recoverOperationReports(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  const r = restackRecord(input.id);
  if (mine?.role !== "coordinator" || !same(mine, r.coordinator) || ctx.sessionManager.getSessionId() !== mine.session || ctx.sessionManager.getSessionFile() !== mine.session_file || realpathSync(ctx.cwd) !== mine.cwd) throw Error("Same coordinator conversation/endpoint required");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.requestKey || "")) throw Error("Stable report-recovery requestKey required");
  const bytes = readFileSync(realpathSync(input.authorizationFile));
  if (!bytes.length || bytes.length > 32768 || !new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim()) throw Error("Bounded verbatim report-only authorization required");
  if (!liveRegistration(mine).capabilities?.includes("operation-report-v1")) throw Error("Coordinator operation-report-v1 capability required");
  await verifyEndpoint(pi, mine); discover(r, Date.now());
  mkdirSync(eventsDir(r.id), { recursive: true, mode: 0o700 });
  const key = hash(mine.session + ":" + input.requestKey), root = eventsDir(r.id), receipt = join(root, "recovery-" + key + ".json");
  const evidence = { coordinator: mine, authorization: bytes.toString(), operation: r.id, reportOnly: true };
  if (existsSync(receipt)) {
    if (JSON.stringify(readJSON(receipt)) !== JSON.stringify(evidence)) throw Error("Conflicting report recovery requestKey");
    return { id: r.id, reports: operationReportStatus(r.id), replayed: false };
  }
  immutable(receipt, evidence);
  const observe = join(stateRoot(), "inbox", mine.epoch, r.id + "-" + key + ".operation-report.json");
  if (!existsSync(observe)) immutable(observe, { id: r.id, target: mine, recovery: receipt, recoveryHash: hash(readFileSync(receipt)) });
  for (const event of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
    const { e, dir } = eventRecord(r.id, event);
    const held = join(dir, "delivery.lock");
    if (existsSync(held)) {
      const owner = readJSON(join(held, "owner.json")), old = readJSON(join(stateRoot(), "sessions", owner.epoch + ".json"));
      const replacement = same(owner, mine) ? mine : input.workerEpoch ? liveRegistration(readJSON(join(stateRoot(), "sessions", input.workerEpoch + ".json"))) : undefined;
      if (old.live !== false || !replacement || replacement.epoch === owner.epoch || !same(owner, replacement) || (!same(owner, r.coordinator) && !same(owner, r.worker))) throw Error("Report lock owner not proven replaced; retain lock and inspect");
      await verifyEndpoint(pi, replacement);
      renameSync(held, join(dir, "retired-lock-" + key));
    }
    if (!lock(dir, mine)) throw Error("Report delivery busy; never race it");
    try {
      reconcile(dir, e);
      if (existsSync(join(dir, "claim.json")) || existsSync(join(dir, "persisted.json")) || obsolete(r, e)) continue;
      const route = { event: e.id, operation: r.id, target: mine, generation: hash(mine.epoch + e.id) };
      const path = join(dir, "route-" + route.generation + ".json"); if (!existsSync(path)) immutable(path, route);
      atomicJSON(join(dir, "route.json"), route);
      const request = join(stateRoot(), "inbox", mine.epoch, "operation-" + route.generation + ".request.json");
      if (!existsSync(request)) immutable(request, { id: "operation-" + route.generation, kind: "operation-status", feature: r.feature, target: mine, operation: r.id, event: e.id, route: route.generation });
    } finally { unlock(dir, mine); }
  }
  return { id: r.id, reports: operationReportStatus(r.id), replayed: false, note: "Notification recovery only; no Git, assignment, binding, reservation or approval changes." };
}
