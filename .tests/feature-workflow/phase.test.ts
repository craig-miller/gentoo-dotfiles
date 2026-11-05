import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { atomicJSON, herdrInstance, readJSON, stateRoot } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";
import { pollAttachments, readyAttachment, reportingDirectory, reportAttached } from "../../pi/dot-config/pi/extensions/feature-workflow/attachment.ts";
import { startPhase, pollPhases, phaseStatus, recoverPhase, renewPhase, pollRenewals } from "../../pi/dot-config/pi/extensions/feature-workflow/phase.ts";
import { digest, phaseDirectory } from "../../pi/dot-config/pi/extensions/feature-workflow/phase-record.ts";

export async function fixture(run: (f: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "phase-test-")), env = { ...process.env };
  const socket = Bun.listen({ unix: join(dir, "socket"), socket: { data() {} } });
  Object.assign(process.env, { XDG_STATE_HOME: dir, XDG_CONFIG_HOME: join(dir, "config"), HERDR_ENV: "1", HERDR_SOCKET_PATH: join(dir, "socket") });
  const repo = join(dir, "repo"), cwd = join(dir, "worker"); mkdirSync(repo);
  const cmd = (name: string, args: string[], where = repo) => {
    const r = spawnSync(name, args, { cwd: where, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    if (r.status) throw new Error(r.stderr || r.stdout); return r.stdout.trim();
  };
  cmd("git", ["init", "-q", "-b", "main"]);
  cmd("git", ["-c", "user.name=Test", "-c", "user.email=test@invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "fixture"]);
  cmd("git", ["worktree", "add", "-qb", "feature/first", cwd]);
  const head = cmd("git", ["rev-parse", "HEAD"]), common = join(repo, ".git");
  const metadata = join(dir, "metadata.json"); writeFileSync(metadata, JSON.stringify({ parentBranchName: "main", parentBranchRevision: head, frozen: false }));
  const blob = cmd("git", ["hash-object", "-w", metadata]); cmd("git", ["update-ref", "refs/branch-metadata/feature/first", blob]);
  const trunk = join(dir, "trunk.json"); writeFileSync(trunk, JSON.stringify({ branch: "main" }));
  // Let real Stax initialize its trunk through its normal explicit setting command.
  cmd("stax", ["trunk", "main"], cwd);
  const base = { capabilities: ["reporting-attach-v1", "phase-transition-v1", "followup-v1", "worker-messaging-v1"], context: { percent: null, leaf: null }, instance: herdrInstance(), common, workspace: "w", live: true, busy: false, updated: Date.now() };
  const worker: any = { ...base, role: "worker", epoch: randomUUID(), session: randomUUID(), session_file: join(dir, "worker.jsonl"), cwd, pane: "w:p2", tab: "w:t2" };
  const coordinator: any = { ...base, role: "coordinator", epoch: randomUUID(), session: randomUUID(), session_file: join(dir, "coord.jsonl"), cwd: repo, pane: "w:p1", tab: "w:t1" };
  for (const e of [worker, coordinator]) writeFileSync(e.session_file, JSON.stringify({ type: "session", id: e.session, cwd: e.cwd }) + "\n");
  const publish = () => { for (const e of [worker, coordinator]) { mkdirSync(join(stateRoot(), "sessions"), { recursive: true }); mkdirSync(join(stateRoot(), "inbox", e.epoch), { recursive: true }); atomicJSON(join(stateRoot(), "sessions", e.epoch + ".json"), { ...e, updated: Date.now() }); } }; publish();
  const receipt = join(dir, "receipt.json"); atomicJSON(receipt, { nonce: randomUUID(), branch: "feature/first", head, base: "main", cwd, repo, session: worker.session, worker, brief: "Original\r\n  user brief" });
  const original = readFileSync(receipt);
  const revision = randomUUID(), relationship = join(reportingDirectory(worker.session), "revisions", revision, "request.json"); mkdirSync(dirname(relationship), { recursive: true });
  const request = { revision, feature: readJSON(receipt).nonce, receipt, receipt_sha256: digest(original), common, cwd, branch: "feature/first", worker: { ...worker }, coordinator: { ...coordinator } };
  atomicJSON(relationship, request); atomicJSON(join(reportingDirectory(worker.session), "current.json"), { revision, feature: request.feature, request: relationship });
  for (const role of ["worker", "coordinator"] as const) {
    atomicJSON(join(dirname(relationship), `active-${role}.json`), { revision, feature: request.feature, role, epoch: request[role].epoch, worker_epoch: worker.epoch, coordinator_epoch: coordinator.epoch, status: "active" });
  }
  atomicJSON(join(dirname(relationship), "ready.json"), { revision, feature: request.feature, worker_epoch: worker.epoch, coordinator_epoch: coordinator.epoch, status: "ready" });
  let busy = false, queued = false, failure = false, compactPending: any;
  const entries: any[] = [], messages: any[] = [], calls: any[] = [];
  const context = (e: any): any => ({ cwd: e.cwd, isIdle: () => !busy, hasPendingMessages: () => queued,
    sessionManager: { getSessionId: () => e.session, getSessionFile: () => e.session_file, getEntries: () => entries,
      getBranch: () => [{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Phase status" }] } }] },
    ui: { setStatus() {}, notify() {} }, compact: (options: any) => { compactPending = options; } });
  const pi: any = { exec: async (name: string, args: string[], options: any) => {
    calls.push([name, args]);
    if (name === "herdr") { const e = args[2] === worker.pane ? worker : coordinator; return { code: 0, stdout: JSON.stringify({ result: { agent: { agent: "pi", pane_id: e.pane, tab_id: e.tab, workspace_id: e.workspace, agent_session: { value: e.session_file }, foreground_cwd: e.cwd, agent_status: busy ? "working" : "idle" } } }) }; }
    const result = spawnSync(name, args, { cwd: options.cwd, encoding: "utf8", env: process.env });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  }, sendMessage: (message: any) => { messages.push(message); appendFileSync(worker.session_file, JSON.stringify({ type: "custom_message", id: randomUUID(), ...message }) + "\n"); if (failure) throw new Error("Crash after persisted message"); } };
  const briefFile = join(dir, "brief.md"), handoffFile = join(dir, "handoff.md"), authorizationFile = join(dir, "auth.md");
  writeFileSync(briefFile, "Plan next phase.\r\n  Verbatim.\r\n"); writeFileSync(handoffFile, "Completed fixture; no release permissions. Next phase planning only."); writeFileSync(authorizationFile, "Synthetic user: authorize phase branch and planning scope only.");
  const input = { action: "start", requestKey: "phase-two", relationship, expectedRevision: revision, expectedHead: head, expectedParent: "main", nextBranch: "feature/second", sessionMode: "keep", briefFile, handoffFile, authorizationFile,
    contextEvaluation: { usagePercent: null, leaf: null, continuity: "Continue the same feature", debuggingHistory: "Short fixture history", rationale: "Unknown usage explicitly judged; keep chosen for this fixture" } };
  const poll = async () => { publish(); for (const e of [worker, coordinator]) await pollAttachments(pi, context(e), e, () => true); await pollPhases(pi, context(worker), worker, () => true, () => false); await pollRenewals(pi, context(coordinator), coordinator, () => true); };
  const finish = async () => { for (let i = 0; i < 12; i++) await poll(); };
  const compact = (fail = false) => { if (fail) compactPending.onError(new Error("Synthetic provider failure")); else { const entry = { id: randomUUID(), type: "compaction", summary: "Preserved" }; entries.push(entry); appendFileSync(worker.session_file, JSON.stringify(entry) + "\n"); compactPending.onComplete({}); } };
  try { await run({ dir, pi, worker, coordinator, context, input, poll, finish, compact, cmd, receipt, original, messages, calls, publish, head,
    busy: (value: boolean) => { busy = value; worker.busy = value; publish(); }, queued: () => queued = true, uncertain: () => failure = true }); }
  finally { socket.stop(true); process.env = env; rmSync(dir, { recursive: true }); }
}

test("real Stax phase uses same worktree, preserves launch/transcript and delivers once after both ACKs", async () => {
  await fixture(async f => {
    const result = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input);
    expect(result.stage).toBe("requested"); await f.finish();
    expect(phaseStatus(result.id).stage).toBe("submitted"); expect(f.messages).toHaveLength(1);
    expect(f.messages[0].content).toContain("Plan next phase.\r\n  Verbatim.\r\n");
    expect(f.messages[0].content).toContain("No implicit commit");
    expect(readFileSync(f.receipt)).toEqual(f.original);
    expect(f.cmd("git", ["branch", "--show-current"], f.worker.cwd)).toBe("feature/second");
    expect(f.cmd("git", ["rev-parse", "HEAD"], f.worker.cwd)).toBe(f.head);
    expect(f.calls.filter((c: any) => c[0] === "stax")).toEqual([["stax", ["create", "feature/second", "--prefix", ""]]]);
    expect((await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input)).id).toBe(result.id);
    await f.finish(); expect(f.messages).toHaveLength(1);
    const pointer = readJSON(join(reportingDirectory(f.worker.session), "current.json")); readyAttachment(pointer.request);
    await reportAttached(f.pi, f.context(f.worker), f.worker, false, () => true);
    const next = { ...f.input, requestKey: "phase-three", relationship: pointer.request, expectedRevision: pointer.revision, expectedParent: "feature/first", nextBranch: "feature/third" };
    const second = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, next); await f.finish();
    expect(phaseStatus(second.id).stage).toBe("submitted"); expect(f.messages).toHaveLength(2);
  });
});

test("dirty tree/index, busy/queued, HEAD/parent/revision drift refuse before branching", async () => {
  for (const kind of ["dirty", "index", "busy", "head", "parent", "revision"]) await fixture(async f => {
    const input = { ...f.input };
    if (["dirty", "index"].includes(kind)) { writeFileSync(join(f.worker.cwd, "dirty"), "preserve"); if (kind === "index") f.cmd("git", ["add", "dirty"], f.worker.cwd); }
    if (kind === "busy") f.busy(true);
    if (kind === "head") input.expectedHead = "a".repeat(40);
    if (kind === "parent") input.expectedParent = "other";
    if (kind === "revision") input.expectedRevision = "wrong";
    await expect(startPhase(f.pi, f.context(f.coordinator), f.coordinator, input)).rejects.toThrow();
    expect(f.calls.filter((c: any) => c[0] === "stax")).toHaveLength(0);
  });
  await fixture(async f => { const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input); f.queued(); await f.poll(); expect(phaseStatus(r.id).blocked).toBeTruthy(); expect(f.messages).toHaveLength(0); });
});

test("compaction is callback-correlated; no branch until completion, failure requires explicit recovery", async () => {
  for (const failure of [false, true]) await fixture(async f => {
    const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, { ...f.input, sessionMode: "compact" });
    await f.poll(); await f.poll(); await f.poll();
    expect(phaseStatus(r.id).stage).toBe("compaction-pending-or-uncertain"); expect(f.messages).toHaveLength(0);
    f.compact(failure);
    if (failure) {
      await f.finish(); expect(phaseStatus(r.id).stage).toBe("compaction-failed");
      await recoverPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStage: "compaction-failed", resolution: "keep-after-failed-compaction", authorizationFile: f.input.authorizationFile });
    }
    await f.finish(); expect(phaseStatus(r.id).stage).toBe("submitted"); expect(f.messages).toHaveLength(1);
    expect(readFileSync(f.receipt)).toEqual(f.original);
  });
});

test("uncertain persisted delivery is reconciled, never replayed; unauthorized branch still refuses", async () => {
  await fixture(async f => {
    const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input); f.uncertain(); await f.finish();
    expect(phaseStatus(r.id).stage).toBe("uncertain-assignment-delivery"); expect(f.messages).toHaveLength(1);
    await recoverPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStage: "uncertain-assignment-delivery", authorizationFile: f.input.authorizationFile });
    await f.finish(); expect(f.messages).toHaveLength(1); expect(phaseStatus(r.id).stage).toBe("submitted");
    const pointer = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    f.cmd("git", ["checkout", "-qb", "unauthorized"], f.worker.cwd);
    await expect(renewPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, workerEpoch: f.worker.epoch, expectedRevision: pointer.revision })).rejects.toThrow("branch drift");
  });
});

test("interrupted branch is verified without rerunning Stax; stale epoch and reporting drift fail closed", async () => {
  await fixture(async f => {
    const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input);
    const exec = f.pi.exec;
    f.pi.exec = async (...args: any[]) => { const result = await exec(...args); if (args[0] === "stax") return { ...result, code: 1, stderr: "Synthetic interruption after branch creation" }; return result; };
    await f.finish(); expect(phaseStatus(r.id).stage).toBe("uncertain-branch");
    await recoverPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStage: "uncertain-branch", authorizationFile: f.input.authorizationFile });
    await f.finish(); expect(phaseStatus(r.id).stage).toBe("submitted"); expect(f.calls.filter((c: any) => c[0] === "stax")).toHaveLength(1);
  });
  for (const kind of ["epoch", "revision", "branch"]) await fixture(async f => {
    const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input); await f.poll();
    if (kind === "epoch") { f.worker.epoch = randomUUID(); f.publish(); }
    if (kind === "revision") atomicJSON(join(reportingDirectory(f.worker.session), "current.json"), { revision: "other" });
    if (kind === "branch") f.cmd("git", ["checkout", "-qb", "drift"], f.worker.cwd);
    await f.finish(); expect(f.messages).toHaveLength(0); expect(f.calls.filter((c: any) => c[0] === "stax")).toHaveLength(0);
    if (kind !== "epoch") expect(phaseStatus(r.id).blocked).toBeTruthy();
    else await expect(recoverPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStage: "requested", authorizationFile: f.input.authorizationFile })).rejects.toThrow();
  });
});

test("API return without a persisted assignment is uncertain and cannot be replayed", async () => {
  await fixture(async f => {
    const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input);
    f.pi.sendMessage = (message: any) => f.messages.push(message); // Accepted API call, no durable entry.
    await f.finish(); expect(phaseStatus(r.id).stage).toBe("uncertain-assignment-delivery");
    await expect(recoverPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStage: "uncertain-assignment-delivery", authorizationFile: f.input.authorizationFile })).rejects.toThrow("No exact persisted assignment");
    await f.finish(); expect(f.messages).toHaveLength(1);
  });
});

test("phase record/transcript tampering and endpoint ACK mismatch never release a brief", async () => {
  for (const kind of ["record", "transcript", "ack"]) await fixture(async f => {
    const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input); await f.poll();
    if (kind === "record") { appendFileSync(join(phaseDirectory(r.id), "record.json"), " "); await expect(f.poll()).rejects.toThrow("Phase record changed"); }
    if (kind === "transcript") { writeFileSync(f.worker.session_file, "changed\n"); await f.finish(); }
    if (kind === "ack") {
      await f.poll(); await f.poll();
      const binding = readJSON(join(phaseDirectory(r.id), "binding.json"));
      atomicJSON(join(dirname(binding.path), "prepared-coordinator.json.claim"), { uncertain: true });
      atomicJSON(join(dirname(binding.path), "prepared-coordinator.json"), { status: "prepared", epoch: "wrong" });
      await f.finish();
    }
    expect(f.messages).toHaveLength(0);
  });
});

test("same-session epoch renewal retains phase authorization, no new assignment", async () => {
  await fixture(async f => {
    const r = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input); await f.finish();
    const pointer = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    f.worker.epoch = randomUUID(); f.coordinator.epoch = randomUUID(); f.publish();
    const renewal = await renewPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, workerEpoch: f.worker.epoch, expectedRevision: pointer.revision });
    await f.finish(); expect(readyAttachment(join(renewal.directory, "request.json")).phase).toBe(r.id); expect(f.messages).toHaveLength(1);
  });
});
