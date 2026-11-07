import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { atomicJSON, herdrInstance, readJSON, stateRoot } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";
import { hash, restackDirectory } from "../../pi/dot-config/pi/extensions/feature-workflow/restack-state.ts";
import { pollOperationReports, deliverOperationReport, operationReportStatus, recoverOperationReports } from "../../pi/dot-config/pi/extensions/feature-workflow/operation-reports.ts";

async function fixture(run: (f: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "operation-report-")), env = { ...process.env };
  const socket = Bun.listen({ unix: join(dir, "socket"), socket: { data() {} } });
  Object.assign(process.env, { XDG_STATE_HOME: dir, HERDR_SOCKET_PATH: join(dir, "socket") });
  const base = { instance: herdrInstance(), cwd: dir, common: dir, workspace: "w", capabilities: ["reporting-attach-v1", "operation-report-v1"], live: true, updated: Date.now() };
  const coordinator = { ...base, epoch: randomUUID(), session: randomUUID(), session_file: join(dir, "coordinator.jsonl"), role: "coordinator", pane: "w:p1", tab: "w:t1" };
  const worker = { ...base, epoch: randomUUID(), session: randomUUID(), session_file: join(dir, "worker.jsonl"), role: "worker", pane: "w:p2", tab: "w:t2" };
  for (const e of [coordinator, worker]) writeFileSync(e.session_file, JSON.stringify({ type: "session", id: e.session, cwd: dir }) + "\n");
  const publish = () => { for (const e of [coordinator, worker]) { mkdirSync(join(stateRoot(), "sessions"), { recursive: true }); mkdirSync(join(stateRoot(), "inbox", e.epoch), { recursive: true }); atomicJSON(join(stateRoot(), "sessions", e.epoch + ".json"), { ...e, updated: Date.now() }); } }; publish();
  const receipt = join(dir, "receipt.json"), relationship = join(dir, "binding.json"); atomicJSON(receipt, {}); atomicJSON(relationship, {});
  const id = randomUUID(), operation = restackDirectory(id); mkdirSync(operation, { recursive: true });
  const r = { id, version: 1, feature: "f", worker: { ...worker }, coordinator: { ...coordinator }, receipt, receipt_sha256: hash(readFileSync(receipt)), relationship, relationship_sha256: hash(readFileSync(relationship)), seals: [] };
  atomicJSON(join(operation, "record.json"), r); atomicJSON(join(operation, "seal.json"), { sha256: hash(readFileSync(join(operation, "record.json"))) });
  for (const e of [coordinator, worker]) atomicJSON(join(stateRoot(), "inbox", e.epoch, id + ".restack.json"), { id, target: e });
  let busy = false, blocked = false, mode = "persist"; const sent: any[] = [], calls: string[] = [], status: any[] = [];
  const ctx: any = { cwd: dir, isIdle: () => !busy, hasPendingMessages: () => false, sessionManager: { getSessionId: () => coordinator.session, getSessionFile: () => coordinator.session_file }, ui: { setStatus: (...a: any[]) => status.push(a) } };
  const pi: any = { exec: async (name: string, args: string[]) => {
    calls.push(name); if (name !== "herdr") throw Error("Notification code attempted an execution side effect");
    const e = args[2] === coordinator.pane ? coordinator : worker;
    return { code: 0, stdout: JSON.stringify({ result: { agent: { agent: "pi", pane_id: e.pane, tab_id: e.tab, workspace_id: e.workspace, foreground_cwd: dir, agent_session: { value: e.session_file } } } }) };
  }, sendMessage: (message: any, options: any) => {
    sent.push({ message, options });
    if (mode !== "absent" && mode !== "delay") appendFileSync(coordinator.session_file, JSON.stringify({ type: "custom_message", id: randomUUID(), ...message }) + "\n");
    if (mode === "throw-after" || mode === "absent") throw Error("uncertain API delivery");
  } };
  const poll = async (now?: number) => { publish(); await pollOperationReports(pi, ctx, coordinator, () => true, now); };
  const deliver = async () => {
    const inbox = join(stateRoot(), "inbox", coordinator.epoch);
    for (const n of readdirSync(inbox).filter(n => n.endsWith(".request.json"))) await deliverOperationReport(pi, ctx, coordinator, readJSON(join(inbox, n)), join(inbox, n.slice(0, -13)), () => true, () => blocked);
  };
  const evidence = (name: string, value: any = {}) => atomicJSON(join(operation, name + ".json"), value);
  const authorizationFile = join(dir, "auth.md"); writeFileSync(authorizationFile, "Synthetic user: recover notification delivery only.");
  try { await run({ id, operation, coordinator, worker, dir, pi, ctx, poll, deliver, evidence, sent, calls, status, publish, authorizationFile,
    busy: (v: boolean) => busy = v, blocked: (v: boolean) => blocked = v, mode: (v: string) => mode = v }); }
  finally { socket.stop(true); process.env = env; rmSync(dir, { recursive: true }); }
}

test("authorized intermediate continuation is quiet; restored boundary reliably triggers coordinator turn once and confirms persistence", async () => {
  await fixture(async f => {
    for (const stage of ["reserved", "preserved", "cleaned", "executed", "mapping"]) { f.evidence(stage); await f.poll(); await f.deliver(); }
    expect(f.sent).toHaveLength(0); expect(operationReportStatus(f.id)).toEqual([]);
    f.evidence("restored"); await f.poll(); f.busy(true); await f.deliver(); expect(f.sent).toHaveLength(0);
    f.busy(false); f.blocked(true); await f.deliver(); expect(f.sent).toHaveLength(0);
    f.blocked(false); await f.deliver(); await f.poll(); await f.deliver();
    expect(f.sent).toHaveLength(1); expect(f.sent[0].options.triggerTurn).toBe(true);
    expect(f.sent[0].message.content).toContain("ask Craig for adoption approval");
    expect(operationReportStatus(f.id)[0].state).toBe("persisted");
    expect(f.calls.every((n: string) => n === "herdr")).toBe(true);
  });
});

test("blocked and completed results wake coordinator; obsolete unclaimed approval requests are suppressed", async () => {
  await fixture(async f => {
    f.evidence("restored"); await f.poll();
    f.evidence("adoption"); f.evidence("completed"); await f.poll(); await f.deliver();
    expect(f.sent).toHaveLength(1); expect(f.sent[0].message.content).toContain("adoption-completed");
    expect(operationReportStatus(f.id).some((r: any) => r.state === "superseded-without-delivery")).toBe(true);
  });
  await fixture(async f => {
    const failure = { event: randomUUID(), error: "Git stopped: resolve conflict" };
    f.evidence("failure-" + failure.event, failure); f.evidence("stopped", failure); await f.poll(); await f.deliver();
    expect(f.sent[0].message.content).toContain("Worker remains reserved"); expect(f.sent[0].message.content).toContain(failure.error);
    await f.poll(); await f.deliver(); expect(f.sent).toHaveLength(1);
  });
});

test("uncertain API outcomes reconcile exact persistence, never replay absent/unknown delivery", async () => {
  for (const mode of ["throw-after", "absent"]) await fixture(async f => {
    f.evidence("restored"); await f.poll(); f.mode(mode); await f.deliver(); await f.poll(); await f.deliver();
    expect(f.sent).toHaveLength(1);
    expect(operationReportStatus(f.id)[0].state).toBe(mode === "throw-after" ? "persisted" : "uncertain");
    await recoverOperationReports(f.pi, f.ctx, f.coordinator, { id: f.id, requestKey: "report-recover", authorizationFile: f.authorizationFile });
    await f.deliver(); expect(f.sent).toHaveLength(1);
  });
});

test("reload requires explicit report-only routing recovery, including completed operations and old unclaimed queue", async () => {
  await fixture(async f => {
    f.evidence("completed"); await f.poll(); const old = { ...f.coordinator };
    atomicJSON(join(stateRoot(), "sessions", old.epoch + ".json"), { ...old, live: false });
    f.coordinator.epoch = randomUUID(); f.publish();
    const input = { id: f.id, requestKey: "reload-report", authorizationFile: f.authorizationFile };
    await recoverOperationReports(f.pi, f.ctx, f.coordinator, input); await f.deliver();
    expect(f.sent).toHaveLength(1); expect(operationReportStatus(f.id)[0].state).toBe("persisted");
    await recoverOperationReports(f.pi, f.ctx, f.coordinator, input); await f.deliver(); expect(f.sent).toHaveLength(1);
    expect(existsSync(join(f.operation, "runtime.json"))).toBe(false);
    expect(existsSync(join(f.operation, "binding.json"))).toBe(false);
  });
});

test("API submission is not persistence; later transcript persistence acknowledges delivery without another turn", async () => {
  await fixture(async f => {
    f.evidence("restored"); await f.poll(); f.mode("delay"); await f.deliver();
    expect(operationReportStatus(f.id)[0].state).toBe("submitted-unconfirmed");
    const message = f.sent[0].message;
    appendFileSync(f.coordinator.session_file, JSON.stringify({ type: "custom_message", id: randomUUID(), ...message }) + "\n");
    await f.poll(); await f.deliver(); expect(operationReportStatus(f.id)[0].state).toBe("persisted"); expect(f.sent).toHaveLength(1);
  });
});

test("report-only recovery retires only a proven replaced lock owner; foreign destinations and changed evidence reject", async () => {
  await fixture(async f => {
    f.evidence("restored"); await f.poll(); const report = operationReportStatus(f.id)[0], held = join(report.directory, "delivery.lock");
    mkdirSync(held); atomicJSON(join(held, "owner.json"), f.coordinator);
    const input = { id: f.id, requestKey: "busy", authorizationFile: f.authorizationFile };
    await expect(recoverOperationReports(f.pi, f.ctx, f.coordinator, input)).rejects.toThrow("not proven replaced");
    const old = { ...f.coordinator }; atomicJSON(join(stateRoot(), "sessions", old.epoch + ".json"), { ...old, live: false });
    f.coordinator.epoch = randomUUID(); f.publish();
    await recoverOperationReports(f.pi, f.ctx, f.coordinator, { ...input, requestKey: "replaced" }); await f.deliver();
    expect(f.sent).toHaveLength(1); expect(existsSync(held)).toBe(false);
  });
  await fixture(async f => {
    f.evidence("restored"); await f.poll();
    await expect(recoverOperationReports(f.pi, f.ctx, { ...f.coordinator, session: "foreign" }, { id: f.id, requestKey: "foreign", authorizationFile: f.authorizationFile })).rejects.toThrow();
    writeFileSync(join(operationReportStatus(f.id)[0].directory, "evidence.json"), "{}"); await expect(f.deliver()).rejects.toThrow("evidence changed"); expect(f.sent).toHaveLength(0);
  });
});

test("unexplained idle/reserved waits surface once; normal bounded executor runtime stays quiet", async () => {
  await fixture(async f => {
    await f.poll(Date.now() + 31_000); await f.deliver();
    expect(f.sent[0].message.content).toContain("progress-unconfirmed");
    await f.poll(Date.now() + 32_000); await f.deliver(); expect(f.sent).toHaveLength(1);
  });
  await fixture(async f => {
    f.evidence("reserved"); f.evidence("execute-claim"); await f.poll(Date.now() + 31_000); await f.deliver(); expect(f.sent).toHaveLength(0);
    await f.poll(Date.now() + 361_000); await f.deliver(); expect(f.sent[0].message.content).toContain("progress-unconfirmed");
  });
});

test("worker disconnection and missing activation ACKs surface bounded actionable waits without executing anything", async () => {
  await fixture(async f => {
    atomicJSON(join(stateRoot(), "sessions", f.worker.epoch + ".json"), { ...f.worker, live: false });
    await pollOperationReports(f.pi, f.ctx, f.coordinator, () => true); await f.deliver();
    expect(f.sent[0].message.content).toContain("worker-unavailable");
  });
  await fixture(async f => {
    f.evidence("adoption"); f.evidence("binding"); await f.poll(); expect(f.sent).toHaveLength(0);
    await f.poll(Date.now() + 31_000); await f.deliver();
    expect(f.sent[0].message.content).toContain("waiting-for-acknowledgements");
  });
});
