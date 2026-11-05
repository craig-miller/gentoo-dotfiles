import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCoordination } from "../../pi/dot-config/pi/extensions/feature-workflow/coordination.ts";
import { enrollmentIntent, enrollmentType, explicitEnrollment, verifyEnrollment } from "../../pi/dot-config/pi/extensions/feature-workflow/enrollment.ts";
import { herdrInstance, atomicJSON, stateRoot } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";
import { readyAttachment, reportingDirectory } from "../../pi/dot-config/pi/extensions/feature-workflow/attachment.ts";
import { fixture as phaseFixture } from "./phase.test.ts";
import { startPhase } from "../../pi/dot-config/pi/extensions/feature-workflow/phase.ts";

async function fixture(run: (f: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "enrollment-")), env = { ...process.env }, argv = process.argv;
  const oldInterval = globalThis.setInterval, oldClear = globalThis.clearInterval;
  const socket = Bun.listen({ unix: join(dir, "socket"), socket: { data() {} } });
  Object.assign(process.env, { HERDR_ENV: "1", HERDR_SOCKET_PATH: join(dir, "socket"), HERDR_PANE_ID: "w:p1", HERDR_TAB_ID: "w:t1", HERDR_WORKSPACE_ID: "w", XDG_STATE_HOME: dir });
  process.argv = ["bun", "test"];
  const entries: any[] = [], calls: any[] = [], notices: any[] = [], commands: any = {}, events: any = {}, hooks: any = {};
  let flag: any, gitCode = 0, timers = 0, activeTimers = 0;
  globalThis.setInterval = (() => { timers++; activeTimers++; return timers; }) as any;
  globalThis.clearInterval = (() => { activeTimers--; }) as any;
  const ctx: any = { cwd: dir, model: {}, isIdle: () => true, hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "session", getSessionFile: () => join(dir, "session.jsonl"), getSessionName: () => "Documents", getEntries: () => entries },
    ui: { notify: (...args: any[]) => notices.push(args), setStatus() {} } };
  const pi: any = { registerFlag() {}, getFlag: () => flag, registerCommand: (name: string, value: any) => commands[name] = value.handler,
    on: (name: string, fn: any) => { hooks[name] = fn; events[name] = name === 'session_start' ? async (...args: any[]) => { await fn(...args); await get.ready(); } : fn; }, appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
    exec: async (name: string, args: string[]) => { calls.push([name, args]); return name === "git" ? { code: gitCode, stdout: dir } :
      { code: 0, stdout: JSON.stringify({ result: { agent: { agent: "pi", pane_id: "w:p1", tab_id: "w:t1", workspace_id: "w", foreground_cwd: dir, agent_session: { value: join(dir, "session.jsonl") } } } }) }; },
    sendMessage() { throw new Error("Enrollment must not send messages"); }, sendUserMessage() { throw new Error("Enrollment must not start work"); } };
  const get = installCoordination(pi);
  const request = () => ({ nonce: "feature", role: "worker", session: "session", session_file: join(dir, "session.jsonl"), cwd: dir, common: dir,
    pane: "w:p1", tab: "w:t1", workspace: "w", instance: herdrInstance() });
  try { await run({ dir, pi, ctx, get, entries, calls, notices, commands, events, hooks, request, setFlag: (x: any) => flag = x, setGit: (x: number) => gitCode = x,
    timers: () => timers, activeTimers: () => activeTimers }); }
  finally { events.session_shutdown(); globalThis.setInterval = oldInterval; globalThis.clearInterval = oldClear; process.env = env; process.argv = argv; socket.stop(true); rmSync(dir, { recursive: true }); }
}

test("ordinary Git/Herdr, non-Git and non-Herdr sessions have no registration, Git probing or inbox timer", async () => {
  for (const kind of ["git", "non-git", "non-herdr", "old-auto", "old-role-only"]) await fixture(async f => {
    if (kind === "non-git") f.setGit(128);
    if (kind === "non-herdr") process.env.HERDR_ENV = "0";
    if (kind === "old-role-only") f.entries.push({ type: "custom", customType: "feature-workflow-role", data: { role: "worker" } });
    if (kind === "old-auto") { mkdirSync(join(stateRoot(), "sessions"), { recursive: true }); atomicJSON(join(stateRoot(), "sessions", "old.json"), { ...f.request(), role: "coordinator", live: true }); }
    await f.events.session_start({ reason: "startup" }, f.ctx);
    expect(f.get()).toBeUndefined(); expect(f.calls).toHaveLength(0); expect(f.timers()).toBe(0);
    expect(existsSync(join(stateRoot(), "inbox"))).toBe(false);
    if (kind !== "old-auto") expect(existsSync(stateRoot())).toBe(false);
  });
});

test("explicit command enrolls once without work; exact enrollment survives reload/resume but not new/fork", async () => {
  await fixture(async f => {
    await f.events.session_start({ reason: "startup" }, f.ctx); expect(f.get()).toBeUndefined();
    await f.commands['feature-coordinate']('', f.ctx);
    const first = f.get(); expect(first.role).toBe("coordinator"); expect(first.enrollment.source).toBe("explicit-command");
    await Promise.all([f.get.activate(f.ctx), f.get.activate(f.ctx)]);
    expect(f.get().epoch).toBe(first.epoch); expect(f.entries).toHaveLength(1); expect(f.timers()).toBe(1);
    for (const reason of ["reload", "resume"]) {
      await f.events.session_start({ reason }, f.ctx);
      expect(f.get().role).toBe("coordinator"); expect(f.get().epoch).not.toBe(first.epoch); expect(f.activeTimers()).toBe(1);
      expect(f.entries).toHaveLength(1);
    }
    for (const reason of ["new", "fork"]) {
      await f.events.session_start({ reason }, f.ctx); expect(f.get()).toBeUndefined(); expect(f.activeTimers()).toBe(0);
    }
  });
});

test("bootstrap releases sequential lifecycle hooks, waits for exact publication, and cancels on shutdown", async () => {
  for (const cancel of [false, true]) await fixture(async f => {
    const exec = f.pi.exec; let published = false;
    f.pi.exec = async (name: string, args: string[]) => name === 'herdr' && !published ? { code: 0, stdout: '{"result":{}}' } : exec(name, args);
    f.setFlag('coordinator');
    await f.hooks.session_start({ reason: 'startup' }, f.ctx);
    expect(f.get()).toBeUndefined(); expect(f.entries).toHaveLength(0); expect(f.timers()).toBe(0);
    if (cancel) {
      const activation = f.get.activate(f.ctx);
      f.hooks.session_shutdown();
      await expect(activation).rejects.toThrow('Session changed');
      expect(f.get()).toBeUndefined(); expect(f.entries).toHaveLength(0); expect(f.timers()).toBe(0);
    } else {
      published = true; await f.get.ready();
      expect(f.get().role).toBe('coordinator'); expect(f.timers()).toBe(1);
    }
  });
});

test("deliberate launcher roles and exact legacy requests enroll; inherited flags never enroll another conversation", async () => {
  for (const role of ["worker", "coordinator"]) await fixture(async f => {
    f.setFlag(role); await f.events.session_start({ reason: "startup" }, f.ctx);
    expect(f.get().role).toBe(role); expect(f.entries[0].customType).toBe(enrollmentType);
    f.ctx.sessionManager.getSessionId = () => "new-session";
    for (const reason of ["new", "fork", "resume", "reload"]) { await f.events.session_start({ reason }, f.ctx); expect(f.get()).toBeUndefined(); }
  });
  await fixture(async f => {
    const path = join(f.dir, "request.json"); writeFileSync(path, JSON.stringify(f.request())); process.argv.push("--feature-request", path);
    await f.events.session_start({ reason: "reload" }, f.ctx); expect(f.get().role).toBe("worker");
    f.ctx.sessionManager.getSessionId = () => "other"; f.setFlag("worker");
    await f.events.session_start({ reason: "reload" }, f.ctx); expect(f.get()).toBeUndefined();
  });
});

test("explicit legacy attachment bootstrap validates receipt and cannot reclassify or adopt mismatched identities", async () => {
  for (const bad of [null, "session", "instance", "common", "pane", "role"]) await fixture(async f => {
    const request = f.request();
    if (bad === "instance") request.instance = { ...request.instance, inode: "replaced" };
    else if (bad) request[bad] = "wrong";
    const path = join(f.dir, "receipt.json"); writeFileSync(path, JSON.stringify(request));
    await f.commands['feature-coordinate']('worker ' + path, f.ctx);
    if (bad) { expect(f.get()).toBeUndefined(); expect(f.timers()).toBe(0); }
    else { expect(f.get().role).toBe("worker"); await expect(f.get.activate(f.ctx, "coordinator")).rejects.toThrow("reclassify"); }
  });
  await fixture(async f => { f.setGit(128); await f.commands['feature-coordinate']('', f.ctx); expect(f.get()).toBeUndefined(); expect(f.entries).toHaveLength(0); });
});

test("stale durable enrollment and conflicting role evidence fail closed rather than falling back to flags", async () => {
  for (const field of ["pane", "cwd", "common", "session_file", "instance", "role"]) await fixture(async f => {
    await f.commands['feature-coordinate']('', f.ctx);
    if (field === "instance") f.entries[0].data.instance = { ...f.entries[0].data.instance, inode: "replaced" };
    else f.entries[0].data[field] = "wrong";
    f.setFlag("coordinator"); await f.events.session_start({ reason: "reload" }, f.ctx);
    expect(f.get()).toBeUndefined(); expect(f.activeTimers()).toBe(0);
  });
  await fixture(async f => {
    const path = join(f.dir, "request.json"); writeFileSync(path, JSON.stringify(f.request())); process.argv.push("--feature-request", path); f.setFlag("coordinator");
    await f.events.session_start({ reason: "startup" }, f.ctx); expect(f.get()).toBeUndefined(); expect(f.entries).toHaveLength(0);
  });
});

test("completed current attachments migrate both roles, including phase bindings, without renewing or replaying", async () => {
  for (const phase of [false, true]) await phaseFixture(async f => {
    if (phase) { await startPhase(f.pi, f.context(f.coordinator), f.coordinator, f.input); await f.finish(); }
    const pointerPath = join(reportingDirectory(f.worker.session), "current.json");
    const pointer = JSON.parse(await Bun.file(pointerPath).text());
    for (const endpoint of [f.worker, f.coordinator]) {
      const ctx = f.context(endpoint); ctx.sessionManager.getEntries = () => [];
      const intent = enrollmentIntent({ getFlag: () => undefined } as any, ctx, "reload");
      expect(intent?.role).toBe(endpoint.role); expect(intent?.source).toBe("verified-attachment");
      Object.assign(process.env, { HERDR_PANE_ID: endpoint.pane, HERDR_TAB_ID: endpoint.tab, HERDR_WORKSPACE_ID: endpoint.workspace });
      expect((await verifyEnrollment(f.pi, ctx, intent)).role).toBe(endpoint.role);
    }
    atomicJSON(join(stateRoot(), "sessions", f.worker.epoch + ".json"), { ...f.worker, live: false });
    expect(enrollmentIntent({ getFlag: () => undefined } as any, f.context(f.coordinator), "reload")?.role).toBe("coordinator");
    expect(() => readyAttachment(pointer.request)).toThrow("stale"); // Enrollment is not reporting renewal.
    expect(f.messages).toHaveLength(phase ? 1 : 0);
  });
});

test("attachment migration rechecks current proof after asynchronous endpoint verification", async () => {
  await phaseFixture(async f => {
    const ctx = f.context(f.coordinator), intent = enrollmentIntent({ getFlag: () => undefined } as any, ctx, 'reload');
    Object.assign(process.env, { HERDR_PANE_ID: f.coordinator.pane, HERDR_TAB_ID: f.coordinator.tab, HERDR_WORKSPACE_ID: f.coordinator.workspace });
    const exec = f.pi.exec;
    f.pi.exec = async (...args: any[]) => { const result = await exec(...args); if (args[0] === 'herdr') unlinkSync(join(reportingDirectory(f.worker.session), 'current.json')); return result; };
    await expect(verifyEnrollment(f.pi, ctx, intent)).rejects.toThrow('Attachment changed');
  });
});

test("old minimal receipts can explicitly enroll exact legacy workers without weakening branch checks", async () => {
  await phaseFixture(async f => {
    const ctx = f.context(f.worker), path = join(f.dir, 'minimal-receipt.json');
    Object.assign(process.env, { HERDR_PANE_ID: f.worker.pane, HERDR_TAB_ID: f.worker.tab, HERDR_WORKSPACE_ID: f.worker.workspace });
    writeFileSync(path, JSON.stringify({ nonce: 'legacy', session: f.worker.session, cwd: f.worker.cwd, repo: f.coordinator.cwd,
      branch: 'feature/first', worker: { session_file: f.worker.session_file } }));
    expect((await verifyEnrollment(f.pi, ctx, explicitEnrollment(ctx, 'worker', path))).role).toBe('worker');
    f.cmd('git', ['checkout', '-qb', 'unauthorized'], f.worker.cwd);
    await expect(verifyEnrollment(f.pi, ctx, explicitEnrollment(ctx, 'worker', path))).rejects.toThrow('branch changed');
  });
});

test("partial, unacknowledged, changed or superseded attachment records never grandfather automatic coordinators", async () => {
  for (const fault of ["pointer", "ready", "ack", "receipt"]) await phaseFixture(async f => {
    const root = reportingDirectory(f.worker.session), path = f.input.relationship, directory = path.slice(0, path.lastIndexOf('/'));
    if (fault === "pointer") atomicJSON(join(root, "current.json"), { revision: "other", feature: "other", request: path });
    if (fault === "ready") unlinkSync(join(directory, "ready.json"));
    if (fault === "ack") unlinkSync(join(directory, "active-worker.json"));
    if (fault === "receipt") writeFileSync(f.receipt, "{}");
    expect(enrollmentIntent({ getFlag: () => undefined } as any, f.context(f.coordinator), "reload")).toBeUndefined();
  });
});
