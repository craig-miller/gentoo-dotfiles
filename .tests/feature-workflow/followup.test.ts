import { test, expect } from "bun:test";
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture } from "./phase.test.ts";
import { atomicJSON, readJSON, stateRoot } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";
import { reportingDirectory, validBoundMessage } from "../../pi/dot-config/pi/extensions/feature-workflow/attachment.ts";
import { startPhase, renewPhase } from "../../pi/dot-config/pi/extensions/feature-workflow/phase.ts";
import { sendFollowup, pollFollowups, followupStatus, followupDirectory, observeFollowup, settleFollowup, recoverFollowup } from "../../pi/dot-config/pi/extensions/feature-workflow/followup.ts";

const input = (f: any, changes: any = {}) => ({ action: "send", requestKey: "followup-one", feature: readJSON(f.receipt).nonce,
  relationship: f.input.relationship, expectedRevision: f.input.expectedRevision, workerEpoch: f.worker.epoch, coordinatorEpoch: f.coordinator.epoch,
  mode: "followUp", busyPolicy: "queue", scope: "Implement only the authorized supplement", provenance: "Synthetic user message 1", authorizationFile: f.input.authorizationFile,
  contextFile: f.input.handoffFile, ...changes });
const poll = (f: any, ctx = f.context(f.worker), blocked = () => false) => pollFollowups(f.pi, ctx, f.worker, () => true, blocked);
function settledContext(f: any) {
  const ctx = f.context(f.worker);
  ctx.sessionManager.getBranch = () => [...readFileSync(f.worker.session_file, "utf8").trim().split("\n").map(line => JSON.parse(line)),
    { id: "answer", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Supplement evidence; not approval" }] } }];
  return ctx;
}

test("legacy follow-up preserves authorization/transcript/receipt, uses custom API once and pins settled reporting", async () => {
  await fixture(async f => {
    writeFileSync(f.input.authorizationFile, '/new\r\n  User authorizes bounded work only.\r\n');
    writeFileSync(join(f.worker.cwd, "progress"), "Existing uncommitted work");
    f.cmd("git", ["add", "progress"], f.worker.cwd);
    const treeStatus = f.cmd("git", ["status", "--porcelain"], f.worker.cwd);
    const before = readFileSync(f.worker.session_file), request = input(f);
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, request);
    expect(r.status).toBe("accepted"); await poll(f);
    expect(followupStatus(r.id).status).toBe("submitted");
    observeFollowup(f.context(f.worker), f.worker);
    expect(followupStatus(r.id).status).toBe("persisted");
    expect(f.messages).toHaveLength(1); expect(f.messages[0].customType).toBe("feature-followup");
    expect(f.messages[0].content).toContain('/new\r\n  User authorizes bounded work only.\r\n');
    expect(f.messages[0].content).toContain('not additional authorization');
    expect(readFileSync(f.worker.session_file).subarray(0, before.length)).toEqual(before);
    expect(readFileSync(f.receipt)).toEqual(f.original);
    expect(f.cmd("git", ["status", "--porcelain"], f.worker.cwd)).toBe(treeStatus);
    expect(f.cmd("git", ["rev-parse", "HEAD"], f.worker.cwd)).toBe(f.head);
    expect((await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, request)).id).toBe(r.id);
    expect(await settleFollowup(f.pi, settledContext(f), f.worker, false, () => true)).toBe(true);
    const status = followupStatus(r.id); expect(status.status).toBe("settled");
    const report = readJSON(status.evidence.report.path); expect(validBoundMessage(report, f.coordinator)).toBe(true);
    expect(report.content).toContain(r.id); expect(report.target.epoch).toBe(f.coordinator.epoch);
    await poll(f); await settleFollowup(f.pi, settledContext(f), f.worker, false, () => true);
    expect(f.messages).toHaveLength(1);
    expect(f.calls.every((c: any) => c[0] === "git" || (c[0] === "herdr" && c[1][0] === "agent" && c[1][1] === "get"))).toBe(true);
  });
});

test("busy, pending and modal workers explicitly queue or reject; never interrupt and recheck modal races", async () => {
  for (const kind of ["busy", "pending", "modal"]) for (const busyPolicy of ["queue", "reject"]) await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f, { busyPolicy }));
    const ctx = f.context(f.worker); let blocked = true;
    ctx.isIdle = () => kind !== "busy" || !blocked; ctx.hasPendingMessages = () => kind === "pending" && blocked;
    await poll(f, ctx, () => kind === "modal" && blocked);
    expect(followupStatus(r.id).status).toBe(busyPolicy === "queue" ? "queued" : "rejected"); expect(f.messages).toHaveLength(0);
    expect(existsSync(join(followupDirectory(r.id), "claim.json"))).toBe(false);
    blocked = false; await poll(f, ctx); await poll(f, ctx);
    expect(f.messages).toHaveLength(busyPolicy === "queue" ? 1 : 0);
  });
  await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f));
    const exec = f.pi.exec; let blocked = false;
    f.pi.exec = async (...args: any[]) => { const result = await exec(...args); blocked = true; return result; };
    await poll(f, f.context(f.worker), () => blocked);
    expect(followupStatus(r.id).status).toBe("queued"); expect(f.messages).toHaveLength(0);
  });
});

test("wrong feature/epochs/revision and stale session/pane/server/branch/source reject without delivery", async () => {
  for (const key of ["feature", "workerEpoch", "coordinatorEpoch", "expectedRevision"]) await fixture(async f => {
    await expect(sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f, { [key]: "wrong" }))).rejects.toThrow(); expect(f.messages).toHaveLength(0);
  });
  for (const kind of ["epoch", "session", "pane", "server", "branch", "receipt", "revision", "binding", "transcript"]) await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f));
    if (kind === "epoch") atomicJSON(join(stateRoot(), "sessions", f.worker.epoch + ".json"), { ...f.worker, live: false });
    if (kind === "session" || kind === "pane") {
      const exec = f.pi.exec; f.pi.exec = async (...args: any[]) => {
        const result = await exec(...args); if (args[0] === "herdr") { const data = JSON.parse(result.stdout); if (kind === "session") data.result.agent.agent_session.value = "/replaced.jsonl"; else data.result.agent.pane_id = "other"; result.stdout = JSON.stringify(data); } return result;
      };
    }
    if (kind === "server") process.env.HERDR_SOCKET_PATH = join(f.dir, "absent.sock");
    if (kind === "branch") f.cmd("git", ["checkout", "-qb", "unauthorized"], f.worker.cwd);
    if (kind === "receipt") appendFileSync(f.receipt, " ");
    if (kind === "transcript") writeFileSync(f.worker.session_file, JSON.stringify({ type: "session", id: "replacement", cwd: f.worker.cwd }) + "\n");
    if (kind === "binding") appendFileSync(f.input.relationship, " ");
    if (kind === "revision") atomicJSON(join(reportingDirectory(f.worker.session), "current.json"), { revision: "changed", request: f.input.relationship });
    await poll(f); expect(followupStatus(r.id).status).toBe("rejected"); expect(f.messages).toHaveLength(0);
  });
});

test("duplicate/concurrent keys stay idempotent; conflicts cannot overwrite admitted work", async () => {
  await fixture(async f => {
    const request = input(f);
    const [a, b] = await Promise.all([sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, request), sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, request)]);
    expect(a.id).toBe(b.id);
    await expect(sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f, { requestKey: "other" }))).rejects.toThrow("Conflicting follow-up");
    await expect(sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f, { scope: "Different work" }))).rejects.toThrow("Conflicting requestKey");
    expect(followupStatus(a.id).status).toBe("accepted"); await poll(f); await poll(f); expect(f.messages).toHaveLength(1);
  });
});

test("uncertain claim is never replayed; recovery only confirms exact persistence or cancels unclaimed work", async () => {
  for (const persisted of [false, true]) await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f));
    if (persisted) f.uncertain(); else f.pi.sendMessage = (message: any) => { f.messages.push(message); throw new Error("interrupted before persistence"); };
    await poll(f); expect(followupStatus(r.id).status).toBe("uncertain");
    await expect(recoverFollowup(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStatus: "uncertain", resolution: "cancel-unclaimed", authorizationFile: f.input.authorizationFile })).rejects.toThrow("Claimed");
    const recovery = recoverFollowup(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStatus: "uncertain", resolution: "confirm-persisted", authorizationFile: f.input.authorizationFile });
    if (persisted) expect((await recovery).status).toBe("persisted"); else await expect(recovery).rejects.toThrow("No exact persisted");
    await poll(f); await poll(f); expect(f.messages).toHaveLength(1);
  });
  await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f));
    const old = f.coordinator.epoch; atomicJSON(join(stateRoot(), "sessions", old + ".json"), { ...f.coordinator, live: false });
    f.coordinator.epoch = randomUUID(); f.publish();
    expect((await recoverFollowup(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStatus: "accepted", resolution: "cancel-unclaimed", authorizationFile: f.input.authorizationFile })).status).toBe("cancelled");
    await poll(f); expect(f.messages).toHaveLength(0);
  });
});

test("phase progression refuses pending follow-ups; completed/renewed phase bindings allow follow-ups", async () => {
  await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f));
    await expect(startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input)).rejects.toThrow("Follow-up");
    await recoverFollowup(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStatus: "accepted", resolution: "cancel-unclaimed", authorizationFile: f.input.authorizationFile });
    const phase = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input); await f.finish();
    const pointer = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    f.worker.epoch = randomUUID(); f.coordinator.epoch = randomUUID(); f.publish();
    await renewPhase(f.pi, f.context(f.coordinator), f.coordinator, { id: phase.id, expectedRevision: pointer.revision, workerEpoch: f.worker.epoch }); await f.finish();
    const renewed = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    const next = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f, { requestKey: "after-phase", relationship: renewed.request, expectedRevision: renewed.revision }));
    await poll(f); await poll(f); expect(followupStatus(next.id).status).toBe("persisted"); expect(f.messages).toHaveLength(2);
  });
});

test("revision drift during validation and before settlement never reroutes the operation/report", async () => {
  await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f));
    const exec = f.pi.exec; f.pi.exec = async (...args: any[]) => { const result = await exec(...args); atomicJSON(join(reportingDirectory(f.worker.session), "current.json"), { revision: "other", request: f.input.relationship }); return result; };
    await poll(f); expect(followupStatus(r.id).status).toBe("rejected"); expect(f.messages).toHaveLength(0);
  });
  await fixture(async f => {
    const r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f)); await poll(f); observeFollowup(f.context(f.worker), f.worker);
    atomicJSON(join(reportingDirectory(f.worker.session), "current.json"), { revision: "other", request: f.input.relationship });
    expect(await settleFollowup(f.pi, settledContext(f), f.worker, false, () => true)).toBe(true);
    expect(followupStatus(r.id).evidence.report.status).toBe("retained");
    expect(readdirSync(join(stateRoot(), "inbox", f.coordinator.epoch)).filter(name => name.endsWith(".request.json"))).toHaveLength(0);
  });
});
