import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { Reviews, ownerFor } from "../../pi/dot-config/pi/extensions/tuicr-review/lifecycle.ts";
import { Reporter } from "../../pi/dot-config/pi/extensions/tuicr-review/reporting.ts";
import { atomic, directory, read, status } from "../../pi/dot-config/pi/extensions/tuicr-review/store.ts";
import { git } from "../../pi/dot-config/pi/extensions/tuicr-review/snapshot.ts";
import { outcome } from "../../pi/dot-config/pi/extensions/tuicr-review/runner.mjs";

async function fixture(run: (f: any) => Promise<void>) {
  mkdirSync(resolve(import.meta.dir, ".tmp"), { recursive: true });
  const root = mkdtempSync(resolve(import.meta.dir, ".tmp/lifecycle-")), source = join(root, "source"); mkdirSync(source);
  const env = { ...process.env };
  const socket = Bun.listen({ unix: join(root, "herdr.sock"), socket: { data() {} } });
  let replacement: ReturnType<typeof Bun.listen> | undefined;
  Object.assign(process.env, { XDG_STATE_HOME: join(root, "state"), HERDR_ENV: "1", HERDR_SOCKET_PATH: join(root, "herdr.sock"), HERDR_PANE_ID: "w:p1", HERDR_TAB_ID: "w:t1", HERDR_WORKSPACE_ID: "w" });
  git(source, ["init", "-q", "--template=", "--initial-branch=main"]); writeFileSync(join(source, "a"), "old\n"); writeFileSync(join(source, "b"), "old\n");
  git(source, ["add", "."]); git(source, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"]);
  writeFileSync(join(source, "a"), "new\n"); writeFileSync(join(source, "b"), "new\n");
  let busy = false, pending = false, session = "session", sessionFile = "/session.jsonl", liveFile = "/session.jsonl", failSend = false, failRun = false, paneGone = false;
  const entries: any[] = [], messages: any[] = [], calls: any[] = [];
  const ctx: any = { cwd: source, mode: "tui", hasUI: true, isIdle: () => !busy, hasPendingMessages: () => pending,
    sessionManager: { getSessionId: () => session, getSessionFile: () => sessionFile, getEntries: () => entries }, ui: { setStatus() {} } };
  const pi: any = { sendMessage: (m: any, options: any) => { if (failSend) throw Error("uncertain"); messages.push({ m, options }); },
    exec: async (cmd: string, args: string[]) => {
      expect(cmd).toBe("herdr"); calls.push(args);
      const base = { code: 0, stderr: "", killed: false, truncated: false };
      if (args[0] === "agent") return { ...base, stdout: JSON.stringify({ result: { agent: { agent: "pi", pane_id: "w:p1", tab_id: "w:t1", workspace_id: "w", agent_session: { value: liveFile } } } }) };
      if (args[1] === "create") return { ...base, stdout: JSON.stringify({ result: { tab: { tab_id: "w:t2" }, root_pane: { pane_id: "w:p2", terminal_id: "terminal2" } } }) };
      if (args[1] === "run") return { ...base, code: failRun ? 1 : 0, stdout: "{}", stderr: failRun ? "timeout" : "" };
      if (args[1] === "list") return { ...base, stdout: JSON.stringify({ result: { panes: paneGone ? [] : [{ pane_id: "w:p2", terminal_id: "terminal2", tab_id: "w:t2" }] } }) };
      throw Error("Unexpected mutation: " + args.join(" "));
    } };
  const reviews = new Reviews(pi); let reporter = new Reporter(pi, ctx);
  const open = (key = "one", paths = ["a"]) => reviews.act({ action: "open", repo: source, base: "HEAD", paths, requestKey: key }, ctx);
  const complete = (id: string, reviewed = 1, comments: any[] = []) => { atomic(join(directory(id), "feedback.json"), comments); atomic(join(directory(id), "completion.json"), outcome(0, null, { reviewed_count: reviewed, file_count: 1 }, comments, 1)); };
  try { await run({ root, source, ctx, pi, reviews, open, complete, entries, messages, calls, owner: () => ownerFor(ctx), poll: () => reporter.tick(),
    restart: () => { reporter.stop(); reporter = new Reporter(pi, ctx); },
    ui: (value: boolean) => reporter.blockedUI = value,
    busy: (value: boolean) => busy = value, pending: (value: boolean) => pending = value,
    fork: () => { session = "fork"; sessionFile = "/fork.jsonl"; }, replace: () => liveFile = "/different.jsonl",
    failSend: () => failSend = true, failRun: () => failRun = true, paneGone: () => paneGone = true,
    replaceInstance: () => { process.env.HERDR_SOCKET_PATH = join(root, "other.sock"); replacement = Bun.listen({ unix: process.env.HERDR_SOCKET_PATH, socket: { data() {} } }); } }); }
  finally { reporter.stop(); socket.stop(true); replacement?.stop(true); process.env = env; rmSync(root, { recursive: true }); }
}

test("open returns immutable identity immediately, duplicate keys do not launch, overlapping reviews blocked", async () => {
  await fixture(async ({ open, calls, reviews, ctx }) => {
    const first = await open(); expect(first.identity).toHaveLength(64); expect(first.fileCount).toBe(1);
    expect(first.state).toBe("opening"); expect(first.approval).toBe(false);
    expect((await open()).id).toBe(first.id);
    await expect(open("one", ["b"])).rejects.toThrow("requestKey");
    await expect(open("two")).rejects.toThrow("overlaps");
    expect(calls.filter((a: string[]) => a[1] === "create")).toHaveLength(1);
    const second = await open("three", ["b"]); expect(second.id).not.toBe(first.id);
    expect((await reviews.act({ action: "verify", id: first.id }, ctx)).sourceMatches).toBe(true);
  });
});

test("completion queues while busy/pending/UI, starts a real turn and distinguishes API acknowledgement from persistence", async () => {
  await fixture(async ({ open, complete, poll, busy, pending, ui, entries, messages }) => {
    const r = await open(); complete(r.id); busy(true); await poll(); expect(status(r.id).delivery.state).toBe("queued");
    busy(false); pending(true); await poll(); pending(false); ui(true); await poll(); expect(messages).toHaveLength(0);
    ui(false); await poll(); expect(messages).toHaveLength(1); expect(messages[0].options.triggerTurn).toBe(true);
    expect(messages[0].m.content).toContain("NOT approval"); expect(status(r.id).delivery.state).toBe("submitted");
    await poll(); expect(messages).toHaveLength(1);
    entries.push({ type: "custom_message", ...messages[0].m }); await poll(); expect(status(r.id).delivery.state).toBe("delivered");
  });
});

test("reload resumes unclaimed completion; uncertain delivery and completed reports never replay", async () => {
  await fixture(async ({ open, complete, poll, restart, messages, failSend }) => {
    const r = await open(); complete(r.id); restart(); await poll(); expect(messages).toHaveLength(1);
    restart(); await poll(); expect(messages).toHaveLength(1);
    const second = await open("two", ["b"]); complete(second.id); failSend(); await poll();
    expect(status(second.id).delivery.state).toBe("uncertain"); restart(); await poll(); expect(messages).toHaveLength(1);
  });
  await fixture(async ({ open, complete, poll, restart, messages }) => {
    const r = await open(); complete(r.id); writeFileSync(join(directory(r.id), "delivery.claim"), "crash-before-send");
    restart(); await poll(); expect(messages).toHaveLength(0); expect(status(r.id).delivery.state).toBe("uncertain");
  });
});

test("fork/replaced origin never receives or closes another session's review; read-by-ID remains available", async () => {
  await fixture(async ({ open, complete, poll, messages, fork, reviews, ctx }) => {
    const r = await open(); complete(r.id); fork(); await poll(); expect(messages).toHaveLength(0);
    expect((await reviews.act({ action: "feedback", id: r.id }, ctx)).state).toBe("completed");
    await expect(reviews.act({ action: "close", id: r.id }, ctx)).rejects.toThrow("exact invoking");
  });
  await fixture(async ({ open, complete, poll, messages, replace }) => {
    const r = await open(); complete(r.id); replace(); await poll(); expect(messages).toHaveLength(0); expect(status(r.id).delivery.state).toBe("blocked");
  });
});

test("uncertain launch keeps durable ID and does not retry or close arbitrary tabs; close requests only runner self-close", async () => {
  await fixture(async ({ open, failRun, reviews, ctx, calls }) => {
    failRun(); const r = await open(); expect(r.state).toBe("launch_uncertain"); expect((await open()).id).toBe(r.id);
    await reviews.act({ action: "close", id: r.id }, ctx); expect(existsSync(join(directory(r.id), "cancel.request"))).toBe(true);
    expect(calls.filter((a: string[]) => a[1] === "close" || a[1] === "focus")).toHaveLength(0);
  });
});

test("tab closure is cancelled/unknown, never a zero-comment completion", async () => {
  await fixture(async ({ open, paneGone, poll }) => {
    const r = await open(), path = join(directory(r.id), "launch.json"); atomic(path, { ...read(path), at: 0 }); paneGone(); await poll();
    expect(status(r.id).completion).toMatchObject({ state: "cancelled", reviewed: null });
  });
});

test("simultaneous same-key calls launch at most once and a replacement server never inherits reports", async () => {
  await fixture(async ({ open, calls, complete, replaceInstance, poll, messages, reviews, ctx }) => {
    const attempts = await Promise.allSettled([open(), open()]);
    const first: any = attempts.find(a => a.status === "fulfilled"); expect(first).toBeDefined();
    expect(calls.filter((a: string[]) => a[1] === "create")).toHaveLength(1);
    const r = await open(); expect(r.id).toBe(first.value.id); complete(r.id);
    replaceInstance(); await poll(); expect(messages).toHaveLength(0);
    await expect(reviews.act({ action: "close", id: r.id }, ctx)).rejects.toThrow("exact invoking");
  });
});

test("verify separates completed review from source drift and never grants approval", async () => {
  await fixture(async ({ open, complete, reviews, ctx, source }) => {
    const r = await open();
    expect((await reviews.act({ action: "verify", id: r.id }, ctx)).readyForApprovalRequest).toBe(false);
    complete(r.id);
    expect(await reviews.act({ action: "verify", id: r.id }, ctx)).toMatchObject({ readyForApprovalRequest: true, approval: false });
    writeFileSync(join(source, "a"), "changed after review\n");
    expect(await reviews.act({ action: "verify", id: r.id }, ctx)).toMatchObject({ readyForApprovalRequest: false, sourceMatches: false, approval: false });
  });
});

test("all reviewed zero-comments differs from partial, failed, cancelled and ambiguous sessions", () => {
  expect(outcome(0, null, { reviewed_count: 2, file_count: 2 }, [], 2)).toMatchObject({ state: "completed", commentCount: 0, reviewed: 2 });
  expect(outcome(0, null, { reviewed_count: 1, file_count: 2 }, [], 2).state).toBe("incomplete");
  expect(outcome(1, null, { reviewed_count: 2, file_count: 2 }, [], 2).state).toBe("failed");
  expect(outcome(0, "requested", { reviewed_count: 2, file_count: 2 }, [], 2).state).toBe("cancelled");
  expect(outcome(0, null, undefined, [], 2).state).toBe("failed");
  expect(outcome(0, null, { reviewed_count: 2, file_count: 3 }, [], 2).state).toBe("failed");
});
