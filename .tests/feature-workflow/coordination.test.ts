import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCoordination, reportWorker } from "../../pi/dot-config/pi/extensions/feature-workflow/coordination.ts";
import { reportingDirectory } from "../../pi/dot-config/pi/extensions/feature-workflow/attachment.ts";
import { atomicJSON } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";

async function fixture(run: (f: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "coord-test-")), previous = { ...process.env };
  const socket = Bun.listen({ unix: join(directory, 'herdr.sock'), socket: { data() {} } });
  process.env.HERDR_SOCKET_PATH = join(directory, 'herdr.sock');
  Object.assign(process.env, { XDG_STATE_HOME: directory, HERDR_ENV: "1", HERDR_PANE_ID: "w:p1", HERDR_TAB_ID: "w:t1", HERDR_WORKSPACE_ID: "w" });
  const events: any = {}, messages: any[] = [], statuses: any[] = [];
  let busy = false, occupant = "/session.jsonl", fail = false, tick: any;
  const oldInterval = globalThis.setInterval, oldClear = globalThis.clearInterval;
  globalThis.setInterval = ((fn: any) => { tick = fn; return 1; }) as any;
  globalThis.clearInterval = (() => {}) as any;
  const ctx: any = { cwd: directory, model: { provider: "p", id: "m" }, isIdle: () => !busy, hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "session", getSessionFile: () => "/session.jsonl", getSessionName: () => "Coordinator", getEntries: () => [] },
    ui: { setStatus: (...args: any[]) => statuses.push(args), notify: () => {} } };
  const pi: any = { registerFlag: () => {}, appendEntry: () => {}, on: (name: string, fn: any) => events[name] = fn, getFlag: () => undefined,
    exec: async (cmd: string) => cmd === "git" ? { code: 0, stdout: directory } : { code: 0, stdout: JSON.stringify({ result: { agent: { agent: "pi", pane_id: "w:p1", agent_session: { value: occupant } } } }) },
    sendMessage: (m: any) => { if (fail) throw Error("uncertain"); messages.push(m); } };
  const get = installCoordination(pi);
  const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const poll = async () => { tick(); await new Promise(resolve => setTimeout(resolve, 5)); };
  const enqueue = (id = "message", changes: any = {}) => {
    const target = get();
    const receipt = join(directory, "receipt.json");
    atomicJSON(receipt, { nonce: "feature", coordinator: target, worker: { session: "worker", epoch: "worker-epoch" } });
    const base = join(directory, "feature-workflow/inbox", target.epoch, id);
    atomicJSON(base + ".request.json", { id, feature: "feature", target, kind: "assignment", relationship: receipt,
      content: "Plan only", ...changes });
    return { base, receipt, ack: () => read(base + ".ack.json") };
  };
  try {
    await events.session_start({ reason: "startup" }, ctx);
    await run({ get, events, ctx, pi, directory, messages, statuses, poll, enqueue, read,
      busy: (value: boolean) => busy = value, occupant: (value: string) => occupant = value, fail: () => fail = true });
  } finally {
    events.session_shutdown(); globalThis.setInterval = oldInterval; globalThis.clearInterval = oldClear;
    socket.stop(true); process.env = previous; rmSync(directory, { recursive: true });
  }
}

test("busy and UI-blocked destination visibly queues, submits once only after idle", async () => {
  await fixture(async ({ enqueue, busy, poll, messages, events, statuses }) => {
    const request = enqueue(); busy(true); await poll();
    expect(request.ack().status).toBe("queued"); expect(messages.length).toBe(0);
    busy(false); events.ui_prompt_start(); await poll(); expect(messages.length).toBe(0);
    events.ui_prompt_end(); await poll(); expect(messages.length).toBe(1);
    expect(request.ack().status).toBe("submitted");
    expect(messages[0].customType).toBe("feature-coordination");
    await poll(); expect(messages.length).toBe(1); expect(statuses.length).toBeGreaterThan(0);
  });
});

test("stale epoch, wrong relationship, replaced pane reject rather than fallback", async () => {
  for (const variant of ["epoch", "feature", "occupant", "worker", "instance"]) await fixture(async ({ enqueue, get, poll, occupant, messages }) => {
    const changes = variant === "instance" ? { target: { ...get(), instance: { ...get().instance, inode: 'different-server' } } } : variant === "epoch" ? { target: { ...get(), epoch: "old" } } : variant === "feature" ? { feature: "other" } :
      variant === "worker" ? { kind: "status", sender: { session: "worker", epoch: "other" } } : {};
    const request = enqueue("message", changes);
    if (variant === "occupant") occupant("/replacement.jsonl");
    await poll(); expect(request.ack().status).toBe("rejected"); expect(messages).toHaveLength(0);
  });
});

test("uncertain delivery retains claim, no retry; reload/resume/fork never replay old queue", async () => {
  await fixture(async ({ enqueue, fail, poll, messages }) => {
    const request = enqueue(); fail(); await poll();
    expect(request.ack().status).toBe("uncertain"); expect(existsSync(request.base + ".claim.json")).toBe(true);
    await poll(); expect(messages).toHaveLength(0);
  });
  for (const reason of ["reload", "resume", "fork"]) await fixture(async ({ enqueue, busy, poll, get, events, ctx, messages }) => {
    const old = get().epoch, request = enqueue(); busy(true); await poll();
    events.session_shutdown(); await events.session_start({ reason }, ctx); busy(false); await poll();
    expect(get().epoch).not.toBe(old); expect(request.ack().status).toBe("queued"); expect(messages).toHaveLength(0);
  });
});

test("bound reports queue while busy, and queued legacy/old-revision messages reject after rebind", async () => {
  await fixture(async ({ get, directory, enqueue, busy, poll, messages }) => {
    const target = get();
    const worker = { ...target, role: 'worker', session: 'worker', session_file: '/worker.jsonl', epoch: 'worker-epoch', pane: 'w:p2', live: true, updated: Date.now() };
    atomicJSON(join(directory, 'feature-workflow/sessions', worker.epoch + '.json'), worker);
    const root = reportingDirectory(worker.session), transaction = join(root, 'revisions/rev-one');
    mkdirSync(transaction, { recursive: true });
    const path = join(transaction, 'request.json');
    const request = { feature: 'feature', revision: 'rev-one', worker, coordinator: target };
    atomicJSON(path, request);
    atomicJSON(join(root, 'current.json'), { feature: 'feature', revision: 'rev-one', request: path });
    atomicJSON(join(transaction, 'ready.json'), { ...request, status: 'ready', worker_epoch: worker.epoch, coordinator_epoch: target.epoch });
    for (const role of ['worker', 'coordinator'] as const) atomicJSON(join(transaction, `active-${role}.json`),
      { feature: 'feature', revision: 'rev-one', role, epoch: request[role].epoch, status: 'active', worker_epoch: worker.epoch, coordinator_epoch: target.epoch });
    const report = enqueue('bound', { kind: 'bound-status', revision: 'rev-one', sender: worker, relationship: path });
    busy(true); await poll(); expect(report.ack().status).toBe('queued'); expect(messages).toHaveLength(0);
    atomicJSON(join(root, 'current.json'), { feature: 'feature', revision: 'rev-two', request: path });
    await poll(); expect(report.ack().status).toBe('rejected');
    const legacy = enqueue('legacy', { kind: 'status', sender: { session: 'worker', epoch: 'worker-epoch' } });
    busy(false); await poll(); expect(legacy.ack().status).toBe('rejected'); expect(messages).toHaveLength(0);
  });
});

test("worker role is extension-scoped, persisted across resume, and migrates legacy requests", async () => {
  await fixture(async ({ events, ctx, pi, get, directory }) => {
    const entries: any[] = [];
    ctx.sessionManager.getEntries = () => entries;
    pi.appendEntry = (customType: string, data: any) => entries.push({ type: 'custom', customType, data });
    pi.getFlag = (name: string) => name === 'feature-role' ? 'worker' : undefined;
    await events.session_start({ reason: 'startup' }, ctx);
    expect(get().role).toBe('worker');
    expect(entries).toHaveLength(1);
    pi.getFlag = () => undefined;
    await events.session_start({ reason: 'resume' }, ctx);
    expect(get().role).toBe('worker');
    entries.length = 0;
    const previous = process.argv;
    const request = join(directory, 'legacy-request.json');
    writeFileSync(request, JSON.stringify({ session: 'session', role: 'worker' }));
    process.argv = [...previous, '--feature-request', request];
    try {
      await events.session_start({ reason: 'reload' }, ctx);
      expect(get().role).toBe('worker');
      expect(entries).toHaveLength(1);
    } finally { process.argv = previous; }
  });
});

test("worker reports use correlated custom status, not human approval or terminal keys", async () => {
  await fixture(async ({ enqueue, get, ctx, pi, poll, messages }) => {
    const assignment = enqueue(); await poll(); messages.length = 0;
    const workerCtx = { ...ctx, sessionManager: { ...ctx.sessionManager, getSessionId: () => "worker" } };
    await reportWorker(pi, workerCtx, { coordinator: get(), nonce: "feature", relationship: assignment.receipt,
      worker_epoch: "worker-epoch", branch: "feature/test" }, "Ready for review");
    await poll(); expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("NOT Craig's approval");
    expect(messages[0].details.sender.epoch).toBe("worker-epoch");
  });
});
