import { test, expect } from "bun:test";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fixture } from "./phase.test.ts";
import { atomicJSON, readJSON, stateRoot } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";
import { reportingDirectory } from "../../pi/dot-config/pi/extensions/feature-workflow/attachment.ts";
import { sendFollowup, pollFollowups, followupStatus, observeFollowup, recoverFollowup, settleFollowup } from "../../pi/dot-config/pi/extensions/feature-workflow/followup.ts";

const input = (f: any, mode: string) => ({ action: "send", mode, requestKey: "message-one", feature: readJSON(f.receipt).nonce,
  relationship: f.input.relationship, expectedRevision: f.input.expectedRevision, workerEpoch: f.worker.epoch, coordinatorEpoch: f.coordinator.epoch,
  busyPolicy: "queue", scope: "Bounded fixture task", provenance: "Synthetic user approval", authorizationFile: f.input.authorizationFile, contextFile: f.input.handoffFile });
const send = (f: any, mode: string) => sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, input(f, mode));
const boundaryFor = (mode: string) => mode === "steer" ? "turn_end" : "agent_before_settle";
const poll = (f: any, boundary?: "turn_end" | "agent_before_settle", blocked = false) => pollFollowups(f.pi, f.context(f.worker), f.worker, () => true, () => blocked, boundary);

test("both explicit modes start idle turns; missing/invalid mode and old capability refuse", async () => {
  for (const mode of ["steer", "followUp"]) await fixture(async f => {
    const options: any[] = [], original = f.pi.sendMessage;
    f.pi.sendMessage = (m: any, o: any) => { options.push(o); original(m); };
    const r = await send(f, mode); await poll(f); await poll(f);
    expect(options).toEqual([{ triggerTurn: true, deliverAs: mode }]);
    expect(followupStatus(r.id).mode).toBe(mode); expect(followupStatus(r.id).status).toBe("persisted");
    expect(f.messages[0].content).toContain(`Delivery mode: ${mode}`);
    expect(f.messages[0].content).toContain("not a new launch or phase/session control");
    expect(readFileSync(f.receipt)).toEqual(f.original);
    await expect(sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, { ...input(f, mode), mode: mode === "steer" ? "followUp" : "steer" })).rejects.toThrow("Conflicting requestKey");
  });
  await fixture(async f => {
    for (const mode of [undefined, "command", "STEER"]) await expect(send(f, mode as any)).rejects.toThrow("Explicit mode");
    f.worker.capabilities = ["followup-v1", "reporting-attach-v1"]; f.publish();
    await expect(send(f, "steer")).rejects.toThrow("worker-messaging-v1");
  });
});

test("steer claims only after current tools; followUp only at whole-run completion, never at intervening turns", async () => {
  for (const mode of ["steer", "followUp"]) await fixture(async f => {
    const r = await send(f, mode), options: any[] = [], original = f.pi.sendMessage;
    f.pi.sendMessage = (m: any, o: any) => { options.push(o); original(m); };
    f.busy(true); await poll(f);
    expect(followupStatus(r.id).status).toBe("queued"); expect(f.messages).toHaveLength(0);
    const wrongBoundary = mode === "steer" ? "agent_before_settle" : "turn_end";
    await poll(f, wrongBoundary); expect(f.messages).toHaveLength(0);
    await poll(f, boundaryFor(mode), true); expect(f.messages).toHaveLength(0);
    await Promise.all([poll(f), poll(f, boundaryFor(mode)), poll(f, boundaryFor(mode))]);
    expect(f.messages).toHaveLength(1); expect(options).toEqual([{ triggerTurn: true, deliverAs: mode }]);
    expect(followupStatus(r.id).evidence.claim.boundary).toBe(boundaryFor(mode));
    expect(followupStatus(r.id).status).toBe("persisted");
    expect((await send(f, mode)).id).toBe(r.id); await poll(f, boundaryFor(mode)); expect(f.messages).toHaveLength(1);
  });
});

test("API queue return is not persistence: delayed ACK remains submitted while busy, missing idle ACK becomes uncertain without replay", async () => {
  for (const mode of ["steer", "followUp"]) for (const persist of [true, false]) await fixture(async f => {
    const r = await send(f, mode); let queued: any;
    f.pi.sendMessage = (m: any) => { queued = m; f.messages.push(m); };
    f.busy(true); await poll(f, boundaryFor(mode)); await poll(f);
    expect(followupStatus(r.id).status).toBe("submitted");
    expect(existsSync(join(r.directory, "persisted.json"))).toBe(false);
    if (persist) appendFileSync(f.worker.session_file, JSON.stringify({ type: "custom_message", id: randomUUID(), ...queued }) + "\n");
    f.busy(false); await poll(f); await poll(f, boundaryFor(mode));
    expect(followupStatus(r.id).status).toBe(persist ? "persisted" : "uncertain"); expect(f.messages).toHaveLength(1);
    if (!persist) await expect(recoverFollowup(f.pi, f.context(f.coordinator), f.coordinator, { id: r.id, expectedStatus: "uncertain", resolution: "cancel-unclaimed", authorizationFile: f.input.authorizationFile })).rejects.toThrow("Claimed");
  });
});

test("both queued modes reject epoch/revision/phase drift at the actual delivery boundary", async () => {
  for (const mode of ["steer", "followUp"]) for (const fault of ["worker", "coordinator", "revision", "phase", "pane"]) await fixture(async f => {
    const r = await send(f, mode); f.busy(true); await poll(f);
    if (fault === "worker" || fault === "coordinator") {
      const endpoint = f[fault]; atomicJSON(join(stateRoot(), "sessions", endpoint.epoch + ".json"), { ...endpoint, live: false });
    } else if (fault === "pane") {
      const exec = f.pi.exec;
      f.pi.exec = async (...args: any[]) => {
        const result = await exec(...args);
        if (args[0] === "herdr") { const data = JSON.parse(result.stdout); data.result.agent.pane_id = "replaced"; result.stdout = JSON.stringify(data); }
        return result;
      };
    } else if (fault === "revision") atomicJSON(join(reportingDirectory(f.worker.session), "current.json"), { revision: "changed", request: f.input.relationship });
    else f.cmd("git", ["checkout", "-qb", "unauthorized-phase"], f.worker.cwd);
    await poll(f, boundaryFor(mode)); expect(followupStatus(r.id).status).toBe("rejected"); expect(f.messages).toHaveLength(0);
  });
});

test("reload never adopts/replays claimed mode deliveries; stale captured boundary is cancelled", async () => {
  for (const mode of ["steer", "followUp"]) await fixture(async f => {
    const request = input(f, mode), r = await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, request); f.busy(true);
    await pollFollowups(f.pi, f.context(f.worker), f.worker, () => false, () => false, boundaryFor(mode));
    expect(f.messages).toHaveLength(0);
    f.pi.sendMessage = (m: any) => { f.messages.push(m); throw new Error("Uncertain API side effect"); };
    await poll(f, boundaryFor(mode)); expect(followupStatus(r.id).status).toBe("uncertain");
    const old = f.worker.epoch; atomicJSON(join(stateRoot(), "sessions", old + ".json"), { ...f.worker, live: false });
    f.worker.epoch = randomUUID(); f.publish(); await poll(f, boundaryFor(mode));
    expect(f.messages).toHaveLength(1); expect(followupStatus(r.id).validity).not.toBe("current");
    expect((await sendFollowup(f.pi, f.context(f.coordinator), f.coordinator, request)).id).toBe(r.id);
  });
});

test("both modes retain uncertain API/persistence and failed coordinator acknowledgements without replay", async () => {
  for (const mode of ["steer", "followUp"]) await fixture(async f => {
    const r = await send(f, mode); f.uncertain(); f.busy(true);
    await poll(f, boundaryFor(mode)); expect(followupStatus(r.id).status).toBe("uncertain");
    // API failure after persistence is reconciled from exact evidence, never resent.
    observeFollowup(f.context(f.worker), f.worker);
    expect(followupStatus(r.id).status).toBe("persisted");
    f.busy(false);
    const ctx = f.context(f.worker);
    ctx.sessionManager.getBranch = () => [...readFileSync(f.worker.session_file, "utf8").trim().split("\n").map(line => JSON.parse(line)),
      { id: "answer", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Fixture result, not approval" }] } }];
    await settleFollowup(f.pi, ctx, f.worker, false, () => true);
    const status = followupStatus(r.id);
    expect(status.evidence.coordinatorAcknowledgement).toBeUndefined();
    atomicJSON(status.evidence.report.acknowledgement, { id: "wrong-operation", epoch: f.coordinator.epoch, feature: input(f, mode).feature, status: "submitted" });
    expect(followupStatus(r.id).evidence.coordinatorAcknowledgement.status).toBe("uncertain");
    await poll(f); expect(f.messages).toHaveLength(1);
  });
});
