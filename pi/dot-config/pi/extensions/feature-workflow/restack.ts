import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJSON, matchesDestination, readJSON, sameInstance, stateRoot } from "./protocol.ts";
import { liveRegistration, readyAttachment, reportingDirectory, validateRequest, verifyEndpoint } from "./attachment.ts";
import { phaseDirectory, phaseRecord } from "./phase-record.ts";
import { activeFollowup } from "./followup.ts";
import { operationReportStatus, recoverOperationReports } from "./operation-reports.ts";
import { adoption, assertNotRestacking, currentRestack, effectiveCheckpoint, hash, restackDirectory, restackPointer, restackRecord } from "./restack-state.ts";

const immutable = (path: string, value: any) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const at = (r: any, name: string) => join(restackDirectory(r.id), name + ".json");
const has = (r: any, name: string) => existsSync(at(r, name));
const put = (r: any, name: string, data: any) => immutable(at(r, name), data);
function auth(path: string) {
  const bytes = readFileSync(realpathSync(path));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim() || bytes.length > 32 * 1024) throw Error("Nonempty bounded verbatim authorization required");
  return text;
}
function own(ctx: ExtensionContext, mine: any, expected: any) {
  if (!matchesDestination({ target: expected }, mine) || mine.role !== expected.role || ctx.sessionManager.getSessionId() !== expected.session || ctx.sessionManager.getSessionFile() !== expected.session_file || realpathSync(ctx.cwd) !== expected.cwd) throw Error("Restack endpoint mismatch");
}
const same = (a: any, b: any) => sameInstance(a.instance, b.instance) && ["session", "session_file", "common", "cwd", "pane", "tab", "workspace", "role"].every(k => a[k] === b[k]);
async function executor(pi: ExtensionAPI, action: string, args: string[]) {
  const result = await pi.exec("feature-restack-git", [action, ...args], { timeout: 330_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.killed || result.truncated) throw Error("Git executor outcome uncertain; inspect durable claim, never repeat");
  let reply; try { reply = JSON.parse(result.stdout); } catch { throw Error(`Invalid executor response: ${result.stderr}`); }
  if (result.code || !reply.ok) throw Error(reply.error || result.stderr || "Restack executor failed");
  return reply.result;
}
async function git(pi: ExtensionAPI, cwd: string, ...args: string[]) {
  const r = await pi.exec("git", args, { cwd, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  if (r.code || r.killed || r.truncated) throw Error(r.stderr || "Git verification failed"); return r.stdout.trim();
}
async function endpoints(pi: ExtensionAPI, r: any) {
  for (const role of ["worker", "coordinator"]) {
    const live = liveRegistration(r[role]);
    if (!live.capabilities?.includes("phase-restack-v1")) throw Error("Both endpoints need phase-restack-v1; separately approve loading/reload");
    const agent = await verifyEndpoint(pi, r[role]);
    if (role === "worker" && (live.busy || !["idle", "done"].includes(agent.agent_status))) throw Error("Worker must be idle without queued work/UI");
  }
}
function originals(request: any) {
  if (!request.phase) throw Error("First version requires a completed phased feature");
  const seals: any[] = [], phases: any[] = []; const seen = new Set<string>(); let id = request.phase;
  while (id) {
    if (seen.has(id)) throw Error("Phase cycle"); seen.add(id);
    const r = phaseRecord(id), dir = phaseDirectory(id);
    if (!existsSync(join(dir, "delivered.json"))) throw Error("Incomplete phase transition");
    for (const name of ["record", "seal", "branched", "delivered", "binding"]) {
      const path = join(dir, name + ".json"); seals.push({ path, sha256: hash(readFileSync(path)) });
    }
    phases.push({ id, branch: r.branch, head: r.head, nextBranch: r.nextBranch }); id = r.previousPhase;
  }
  seals.push({ path: request.receipt, sha256: request.receipt_sha256 });
  return { seals, phases };
}
export async function inspectRestack(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  const relationship = realpathSync(input.relationship), request = readyAttachment(relationship);
  own(ctx, mine, request.coordinator); assertNotRestacking(request.worker.session);
  if (request.revision !== input.expectedRevision) throw Error("Exact reporting revision required");
  await validateRequest(pi, ctx, mine, request, "coordinator"); await endpoints(pi, request);
  if (activeFollowup(request.worker.session)) throw Error("Outstanding follow-up must settle or be explicitly cancelled");
  const launch = readJSON(request.receipt), snapshot = await executor(pi, "inspect", ["--repo", request.cwd, "--base", launch.base]);
  const history = originals(request), branches = new Map(snapshot.checkpoint.stack.map((b: any) => [b.branch, b.head]));
  for (const p of history.phases) if (branches.get(p.branch) !== effectiveCheckpoint(request, p.head)) throw Error("Sealed phase branch tip drift; cannot infer a checkpoint mapping");
  const inspection = { version: 1, relationship, relationship_sha256: hash(readFileSync(relationship)), request, ...history, snapshot };
  const dir = join(stateRoot(), "restack-inspections", randomUUID()); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "inspection.json"); immutable(path, inspection);
  return { id: undefined, directory: dir, stage: "inspection-only", inspectionFile: path, inspectionHash: hash(readFileSync(path)), snapshot, phases: history.phases,
    note: "No mutation or network access. Authorize exact preservation, cleaning, Stax restack and restoration separately from fetch/base updates. No acceptance or release authority." };
}
export function restackStatus(id: string) {
  const r = restackRecord(id), dir = restackDirectory(id);
  const stages = ["completed", "cancelled", "binding", "adoption", "restored", "mapping", "executed", "execute-claim", "cleaned", "clean-claim", "preserved", "reserved"];
  const stage = stages.find(s => has(r, s)) || "requested";
  return { id, stage, directory: dir, reports: operationReportStatus(id), stopped: stopped(r) ? readJSON(at(r, "stopped")) : undefined,
    events: readdirSync(dir).filter(n => /^(failure|recovery|continue|renew)-/.test(n)),
    note: "Status is not acceptance or approval. Retain evidence/backups. Never replay an uncertain Git operation or assignment." };
}
function key(input: any, session: string) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.requestKey || "")) throw Error("Stable requestKey required");
  return hash(session + ":" + input.requestKey);
}
function active(r: any) {
  const pointer = currentRestack(r.worker.session);
  if (pointer?.id !== r.id) throw Error("Restack superseded"); restackRecord(r.id);
}
export async function startRestack(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  if (mine?.role !== "coordinator") throw Error("Registered coordinator required");
  const k = key(input, mine.session), root = join(stateRoot(), "restack-keys"); mkdirSync(root, { recursive: true, mode: 0o700 });
  const keyfile = join(root, k + ".json"), authorization = auth(input.authorizationFile);
  const fingerprint = hash(JSON.stringify({ inspectionHash: input.inspectionHash, inspectionFile: input.inspectionFile, authorization }));
  if (existsSync(keyfile)) { const previous = readJSON(keyfile); if (previous.fingerprint !== fingerprint) throw Error("Conflicting requestKey"); return restackStatus(previous.id); }
  const bytes = readFileSync(realpathSync(input.inspectionFile));
  if (hash(bytes) !== input.inspectionHash) throw Error("Inspection changed");
  const i = JSON.parse(bytes.toString()), request = readyAttachment(i.relationship);
  own(ctx, mine, request.coordinator); assertNotRestacking(request.worker.session);
  if (hash(readFileSync(i.relationship)) !== i.relationship_sha256 || JSON.stringify(request) !== JSON.stringify(i.request)) throw Error("Reporting changed since inspection");
  await validateRequest(pi, ctx, mine, request, "coordinator"); await endpoints(pi, request);
  const snapshot = await executor(pi, "inspect", ["--repo", request.cwd, "--base", readJSON(request.receipt).base]);
  if (JSON.stringify(snapshot) !== JSON.stringify(i.snapshot)) throw Error("Source drift since inspection");
  const history = originals(request);
  if (JSON.stringify(history.seals) !== JSON.stringify(i.seals) || JSON.stringify(history.phases) !== JSON.stringify(i.phases)) throw Error("Inspection phase evidence differs from actual sealed history");
  const branches = new Map(snapshot.checkpoint.stack.map((b: any) => [b.branch, b.head]));
  for (const p of history.phases) if (branches.get(p.branch) !== effectiveCheckpoint(request, p.head)) throw Error("Sealed checkpoint tip drift at admission");
  const r: any = { version: 1, id: randomUUID(), feature: request.feature, phase: request.phase, branch: request.branch, cwd: request.cwd, common: request.common,
    base: snapshot.checkpoint.base, snapshot, worker: request.worker, coordinator: request.coordinator, receipt: request.receipt, receipt_sha256: request.receipt_sha256,
    relationship: i.relationship, relationship_sha256: i.relationship_sha256, previousRevision: request.revision, previousAdoption: request.adoption ?? null,
    phases: i.phases, seals: i.seals, authorization, inspectionHash: input.inspectionHash, created: Date.now() };
  const lock = join(reportingDirectory(r.worker.session), "control.lock"); mkdirSync(lock, { mode: 0o700 });
  try {
    readyAttachment(r.relationship); assertNotRestacking(r.worker.session);
    if (activeFollowup(r.worker.session)) throw Error("Outstanding follow-up blocks restack");
    for (const s of r.seals) if (hash(readFileSync(s.path)) !== s.sha256) throw Error("Phase evidence drift");
    mkdirSync(restackDirectory(r.id), { mode: 0o700, recursive: true });
    put(r, "record", r); put(r, "seal", { sha256: hash(readFileSync(at(r, "record"))) });
    immutable(keyfile, { id: r.id, fingerprint });
    atomicJSON(restackPointer(r.worker.session), { id: r.id });
    for (const role of ["worker", "coordinator"]) immutable(join(stateRoot(), "inbox", r[role].epoch, r.id + ".restack.json"), { id: r.id, target: r[role] });
  } finally { rmdirSync(lock); }
  return restackStatus(r.id);
}
function runtime(r: any) { return has(r, "runtime") ? readJSON(at(r, "runtime")) : { worker: r.worker, coordinator: r.coordinator }; }
function stopped(r: any) { return has(r, "stopped") && !readJSON(at(r, "stopped")).recovered; }
function fail(r: any, error: unknown) {
  const e = { id: r.id, event: randomUUID(), error: String(error), at: Date.now() };
  put(r, "failure-" + e.event, e); atomicJSON(at(r, "stopped"), e);
}
function acked(r: any, stage: string, request: any) {
  const dir = dirname(request.path);
  return ["worker", "coordinator"].every(role => {
    const path = join(dir, `${stage}-${role}.json`); if (!existsSync(path)) return false;
    const ack = readJSON(path);
    if (ack.status !== stage || ack.epoch !== request[role].epoch || ack.revision !== request.revision || ack.feature !== r.feature || ack.worker_epoch !== request.worker.epoch || ack.coordinator_epoch !== request.coordinator.epoch || ack.adoption_sha256 !== request.adoption_sha256) throw Error("Adoption endpoint acknowledgement rejected");
    return true;
  });
}
async function unchanged(pi: ExtensionAPI, r: any) {
  const m = readJSON(at(r, "mapping")), restored = readJSON(at(r, "restored"));
  if (await git(pi, r.cwd, "branch", "--show-current") !== r.branch || await git(pi, r.cwd, "rev-parse", "refs/heads/" + r.base) !== m.base_head) throw Error("Adoption branch/base drift");
  for (const b of m.new_stack) {
    if (await git(pi, r.cwd, "rev-parse", "refs/heads/" + b.branch) !== b.head || await git(pi, r.cwd, "rev-parse", "refs/branch-metadata/" + b.branch) !== b.metadata_oid) throw Error("Adoption refs/metadata drift");
  }
  // Restore's idempotent verification compares full index/working-tree content.
  const verified = await executor(pi, "restore", ["--operation", restackDirectory(r.id)]);
  if (JSON.stringify(verified) !== JSON.stringify(restored)) throw Error("Restored candidate changed");
}
export async function pollRestacks(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, stillCurrent: () => boolean, blockedUI: () => boolean) {
  for (const file of readdirSync(join(stateRoot(), "inbox", mine.epoch)).filter(n => n.endsWith(".restack.json"))) {
    const e = readJSON(join(stateRoot(), "inbox", mine.epoch, file)); if (!matchesDestination(e, mine)) continue;
    const r = restackRecord(e.id); if (has(r, "completed") || has(r, "cancelled") || stopped(r)) continue;
    try {
      active(r); const endpointsNow = runtime(r); own(ctx, mine, endpointsNow[mine.role]);
      if (!ctx.isIdle() || ctx.hasPendingMessages() || blockedUI()) continue;
      await endpoints(pi, { ...r, ...endpointsNow });
      if (!stillCurrent() || !ctx.isIdle() || ctx.hasPendingMessages() || blockedUI()) continue;
      active(r);
      if (mine.role !== "worker") continue;
      if (!has(r, "reserved")) {
        const snap = await executor(pi, "inspect", ["--repo", r.cwd, "--base", r.base]);
        if (JSON.stringify(snap) !== JSON.stringify(r.snapshot)) throw Error("Source drift before worker reservation");
        if (!stillCurrent() || !ctx.isIdle() || ctx.hasPendingMessages() || blockedUI()) continue;
        put(r, "reserved", { id: r.id, worker_epoch: r.worker.epoch }); continue;
      }
      if (!has(r, "preserved")) { await executor(pi, "preserve", ["--operation", restackDirectory(r.id)]); continue; }
      if (!has(r, "cleaned")) { await executor(pi, "clean", ["--operation", restackDirectory(r.id)]); continue; }
      if (!has(r, "executed")) { await executor(pi, "execute", ["--operation", restackDirectory(r.id)]); continue; }
      if (!has(r, "mapping")) { await executor(pi, "verify", ["--operation", restackDirectory(r.id)]); continue; }
      if (!has(r, "restored")) { await executor(pi, "restore", ["--operation", restackDirectory(r.id)]); continue; }
      // Mapping/restoration is not authority to resume. Coordinator explicitly
      // authorizes adoption after seeing changed-patch/conflict evidence.
      if (!has(r, "adoption")) continue;
      await unchanged(pi, r);
      if (!stillCurrent() || !ctx.isIdle() || ctx.hasPendingMessages() || blockedUI()) continue;
      if (!has(r, "binding")) continue;
      const lock = join(reportingDirectory(r.worker.session), "control.lock");
      try { mkdirSync(lock, { mode: 0o700 }); } catch (error: any) { if (error.code === "EEXIST") continue; throw error; }
      try {
      own(ctx, mine, runtime(r).worker); active(r);
      const binding = readJSON(at(r, "binding")), request = { ...readJSON(binding.path), path: binding.path }, dir = dirname(binding.path);
      const pointer = readJSON(join(reportingDirectory(r.worker.session), "current.json"));
      if (pointer.request !== binding.path || pointer.revision !== binding.revision) throw Error("Adoption reporting superseded");
      if (!existsSync(join(dir, "commit.json"))) {
        if (acked(r, "prepared", request)) immutable(join(dir, "commit.json"), { revision: request.revision, feature: r.feature });
      } else if (!existsSync(join(dir, "ready.json"))) {
        if (acked(r, "active", request)) immutable(join(dir, "ready.json"), { revision: request.revision, feature: r.feature, worker_epoch: request.worker.epoch, coordinator_epoch: request.coordinator.epoch, status: "ready" });
      } else {
        if (!acked(r, "active", request)) throw Error("Missing active endpoint agreement");
        adoption(r); put(r, "completed", { id: r.id, revision: request.revision, adoption_sha256: hash(readFileSync(at(r, "adoption"))), approval: false });
        ctx.ui.notify("Restack adopted; candidate restored. Rerun tests and affected live/review checks. No new task or release permissions.", "info");
      }
      } finally { rmdirSync(lock); }
    } catch (error) { fail(r, error); ctx.ui.setStatus("feature-restack", `Restack ${r.id} stopped: ${error}`); }
  }
}
function publishBinding(r: any, endpointsNow: any) {
  const old = readJSON(r.relationship), revision = randomUUID(), dir = join(reportingDirectory(r.worker.session), "revisions", revision);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); const path = join(dir, "request.json");
  const previous = readJSON(join(reportingDirectory(r.worker.session), "current.json"));
  const expected = has(r, "binding") ? readJSON(at(r, "binding")) : { path: r.relationship, revision: r.previousRevision };
  if (previous.request !== expected.path || previous.revision !== expected.revision) throw Error("Restack reporting pointer drift; no force rebind");
  const request = { ...old, revision, adoption: r.id, adoption_sha256: hash(readFileSync(at(r, "adoption"))), ...endpointsNow, previous, scope: "Restack checkpoint adoption and future reporting only. No replay, acceptance, commit or release authority." };
  immutable(path, request);
  // Binding generations are append-only; a pointer only selects one generation.
  put(r, "binding-" + revision, { path, revision }); atomicJSON(at(r, "binding"), { path, revision });
  atomicJSON(join(reportingDirectory(r.worker.session), "current.json"), { revision, feature: r.feature, request: path });
  for (const role of ["worker", "coordinator"]) immutable(join(stateRoot(), "inbox", request[role].epoch, revision + ".binding.json"), { revision, request: path, target: request[role], role });
}
export async function controlRestack(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any): Promise<any> {
  if (input.action === "restack-report-recover") return recoverOperationReports(pi, ctx, mine, input);
  if (["restack-inspect", "restack-start", "restack-status"].includes(input.action)) return controlRestackLocked(pi, ctx, mine, input);
  const r = restackRecord(input.id), lock = join(reportingDirectory(r.worker.session), "control.lock");
  if (!same(mine, r.coordinator)) throw Error("Same coordinator endpoint required");
  own(ctx, mine, mine);
  const k = key(input, mine.session), evidence = auth(input.authorizationFile);
  const fingerprint = hash(JSON.stringify({ input: Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))), evidence }));
  mkdirSync(lock, { mode: 0o700 });
  try {
    const command = at(r, "command-" + k);
    if (existsSync(command)) {
      if (readJSON(command).fingerprint !== fingerprint) throw Error("Conflicting control requestKey");
      return { ...restackStatus(r.id), command: has(r, "command-result-" + k) ? "settled" : "stopped-or-uncertain; inspect, never replay" };
    }
    put(r, "command-" + k, { fingerprint, action: input.action, evidence });
    try {
      const result = await controlRestackLocked(pi, ctx, mine, input);
      put(r, "command-result-" + k, { stage: result.stage }); return result;
    } catch (error) {
      if (has(r, "control-" + k) || has(r, "renew-" + k)) fail(r, error);
      throw error;
    }
  } finally { rmdirSync(lock); }
}
async function controlRestackLocked(pi: ExtensionAPI, ctx: ExtensionContext, mine: any, input: any) {
  if (input.action === "restack-inspect") return inspectRestack(pi, ctx, mine, input);
  if (input.action === "restack-start") return startRestack(pi, ctx, mine, input);
  if (input.action === "restack-status") return restackStatus(input.id);
  const r = restackRecord(input.id); active(r);
  if (has(r, "completed") || has(r, "cancelled")) throw Error("Restack already terminal");
  const k = key(input, mine.session), evidence = auth(input.authorizationFile);
  const previous = runtime(r);
  if (!same(mine, r.coordinator)) throw Error("Same coordinator conversation/physical endpoint required");
  own(ctx, mine, mine);
  if (input.expectedStage !== restackStatus(r.id).stage) throw Error("Exact current stage required");
  if (input.action === "restack-renew") {
    const pointer = readJSON(join(reportingDirectory(r.worker.session), "current.json"));
    if (input.expectedRevision !== pointer.revision) throw Error("Exact current reporting revision required for restack renewal");
    const worker = liveRegistration(readJSON(join(stateRoot(), "sessions", input.workerEpoch + ".json")));
    if (!same(worker, r.worker)) throw Error("Same worker conversation/physical endpoint required");
    await endpoints(pi, { ...r, worker, coordinator: mine });
    const event = { worker, coordinator: mine, evidence, previous, id: r.id };
    put(r, "renew-" + k, event); atomicJSON(at(r, "runtime"), { worker, coordinator: mine });
    for (const role of ["worker", "coordinator"] as const) {
      const path = join(stateRoot(), "inbox", event[role].epoch, r.id + ".restack.json");
      if (!existsSync(path)) immutable(path, { id: r.id, target: event[role] });
    }
    if (has(r, "binding")) { await unchanged(pi, r); publishBinding(r, { worker, coordinator: mine }); }
    if (has(r, "stopped")) { put(r, "recovery-" + k, readJSON(at(r, "stopped"))); atomicJSON(at(r, "recovered"), { k }); }
    // Stopped marker remains immutable evidence in failure-*; current stop is a
    // selector cleared only after this explicit correlated recovery.
    if (has(r, "stopped")) atomicJSON(at(r, "stopped"), { ...readJSON(at(r, "stopped")), recovered: k });
    return restackStatus(r.id);
  }
  own(ctx, mine, previous.coordinator); await endpoints(pi, { ...r, ...previous });
  const eventFile = at(r, "control-" + k), fingerprint = hash(JSON.stringify({ action: input.action, expectedStage: input.expectedStage, evidence, resolution: input.resolution }));
  if (existsSync(eventFile)) { if (readJSON(eventFile).fingerprint !== fingerprint) throw Error("Conflicting recovery requestKey"); return restackStatus(r.id); }
  put(r, "control-" + k, { fingerprint, action: input.action, evidence });
  if (input.action === "restack-adopt") {
    if (!has(r, "restored") || stopped(r)) throw Error("Verified restoration and reconciled operation required before adoption");
    await unchanged(pi, r);
    if (!has(r, "adoption")) {
      const m = readJSON(at(r, "mapping")), checkpoints = { ...m.mapping };
      for (const b of m.old_stack) {
        if (checkpoints[b.head] && checkpoints[b.head] !== m.tips[b.branch]) throw Error("Ambiguous shared checkpoint");
        checkpoints[b.head] = m.tips[b.branch];
      }
      put(r, "adoption", { id: r.id, branch: r.branch, record_sha256: hash(readFileSync(at(r, "record"))), mapping_sha256: hash(readFileSync(at(r, "mapping"))),
        restored_sha256: hash(readFileSync(at(r, "restored"))), checkpoints, authorization: evidence, changed_patches: m.changed_patches,
        revalidation_required: true, approval: false });
      put(r, "adoption-seal", { sha256: hash(readFileSync(at(r, "adoption"))) });
    }
    if (!has(r, "binding")) publishBinding(r, previous);
  } else if (input.action === "restack-cancel") {
    if (has(r, "clean-claim") || has(r, "execute-claim") || has(r, "adoption")) throw Error("Cancellation is only supported before candidate cleaning; retain and reconcile later operations");
    const pointer = readJSON(join(reportingDirectory(r.worker.session), "current.json"));
    if (pointer.request !== r.relationship || pointer.revision !== r.previousRevision) throw Error("Reporting drift before cancellation");
    put(r, "cancelled", { id: r.id, authorization: evidence, no_git_mutation: true });
  } else if (input.action === "restack-continue") {
    if (!stopped(r)) throw Error("Only explicitly stopped conflicts can continue");
    const result = await executor(pi, "continue", ["--operation", restackDirectory(r.id), "--continuation", k]);
    if (result.exit !== 0) throw Error("Continuation stopped; inspect retained execution evidence");
    await executor(pi, "verify", ["--operation", restackDirectory(r.id)]);
    put(r, "recovery-" + k, { evidence, stopped: readJSON(at(r, "stopped")) });
    atomicJSON(at(r, "stopped"), { recovered: k });
  } else if (input.action === "restack-recover") {
    if (!stopped(r)) throw Error("No stopped operation to reconcile");
    if (has(r, "restored")) {
      await unchanged(pi, r);
      if (has(r, "adoption")) adoption(r);
      if (has(r, "binding")) publishBinding(r, previous);
    } else if (has(r, "execute-claim")) {
      // Verify actual result; NEVER execute again. A missing execution result
      // after a successful crash is reconciled as evidence, not a rerun.
      await executor(pi, "verify", ["--operation", restackDirectory(r.id)]);
      if (!has(r, "executed")) put(r, "executed", { reconciled: true, evidence });
      if (has(r, "restore-claim")) await executor(pi, "restore", ["--operation", restackDirectory(r.id)]);
    } else if (has(r, "clean-claim") && !has(r, "cleaned")) throw Error("Interrupted cleaning requires manual reconciliation against the bundle; automatic replay unsupported");
    else if (has(r, "preserved")) await executor(pi, "preserve", ["--operation", restackDirectory(r.id)]);
    put(r, "recovery-" + k, { evidence, stopped: readJSON(at(r, "stopped")) }); atomicJSON(at(r, "stopped"), { recovered: k });
  } else throw Error("Unsupported restack control action");
  return restackStatus(r.id);
}
