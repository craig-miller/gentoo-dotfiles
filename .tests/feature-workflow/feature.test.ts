import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import feature, { splitFeatureArgs } from "../../pi/dot-config/pi/extensions/feature-workflow/index.ts";
import { herdrInstance } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";
import worker, { taskPrompt } from "../../pi/dot-config/pi/extensions/feature-workflow/worker.ts";

const pause = () => new Promise((resolve) => setTimeout(resolve, 180));

test("slash parsing preserves multiline brief/quotes rather than shell splitting", () => {
  const brief = 'Plan foo.\n\n  - reuse "existing" code\n  - never run $(this)\n';
  expect(splitFeatureArgs("foo " + brief)).toEqual({ name: "foo", brief });
  expect(splitFeatureArgs("foo\n" + brief)).toEqual({ name: "foo", brief });
  expect(splitFeatureArgs("foo")).toEqual({ name: "foo", brief: "" });
});

test("task prompt separates exact brief and context, with planning ceiling", () => {
  const brief = 'Investigate\n  "foo"\n';
  const text = taskPrompt({ brief, context: "Agreed constraints", cwd: "/worker", branch: "feature/foo" });
  expect(text).toContain("--- USER BRIEF (verbatim) ---\n\n" + brief);
  expect(text).toContain("not implementation");
  expect(text).toContain("not additional authorization");
});

async function fixture(run: (f: any) => Promise<void>, changes: any = {}) {
  const directory = mkdtempSync(join(tmpdir(), "feature-bridge-test-"));
  const previous = { ...process.env };
  const socket = Bun.listen({ unix: join(directory, 'herdr.sock'), socket: { data() {} } });
  process.env.HERDR_SOCKET_PATH = join(directory, 'herdr.sock');
  Object.assign(process.env, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2", HERDR_TAB_ID: "w1:t2", HERDR_WORKSPACE_ID: "w1" });
  const request = { instance: herdrInstance(), nonce: "unique", cwd: directory, branch: "feature/foo", head: "abc", session: "new", parent_session: "old", provider: "openai-codex", model: "gpt-6-astra", pane: "w1:p2", tab: "w1:t2", workspace: "w1", brief: "Investigate reuse. Do not implement.", base: "main", ...changes };
  writeFileSync(join(directory, "request.json"), JSON.stringify(request));
  const events: any = {};
  const messages: string[] = [];
  const ctx: any = { cwd: directory, model: { provider: "openai-codex", id: "gpt-6-astra" }, sessionManager: { getSessionId: () => "new", getSessionFile: () => "/tmp/new.jsonl", getEntries: () => [] }, isIdle: () => true, hasPendingMessages: () => false, ui: { notify: () => {} } };
  const pi: any = { registerFlag: () => {}, getFlag: () => join(directory, "request.json"), on: (name: string, callback: any) => events[name] = callback, exec: async (_cmd: string, args: string[]) => ({ code: 0, stdout: args[0] === "branch" ? "feature/foo\n" : "abc\n" }), sendUserMessage: (text: string) => messages.push(text) };
  worker(pi);
  const read = (name: string) => JSON.parse(readFileSync(join(directory, name), "utf8"));
  const release = (nonce = "unique") => writeFileSync(join(directory, "release.json"), JSON.stringify({ nonce }));
  try { await run({ events, messages, ctx, pi, directory, read, release }); }
  finally { events.session_shutdown(); socket.stop(true); process.env = previous; rmSync(directory, { recursive: true }); }
}

test("no submission until verified release, API delivers once without editor input", async () => {
  await fixture(async ({ events, messages, ctx, read, release }) => {
    await events.session_start({ reason: "startup" }, ctx);
    expect(read("ready.json").session).toBe("new");
    await pause();
    expect(messages).toHaveLength(0);
    release();
    await pause();
    expect(messages).toHaveLength(1);
    expect(read("delivery.json").status).toBe("submitted");
    await pause();
    expect(messages).toHaveLength(1);
    await events.session_start({ reason: "reload" }, ctx);
    await pause();
    expect(messages).toHaveLength(1);
  });
});

test("wrong model produces failed readiness, never starts work", async () => {
  await fixture(async ({ events, ctx, read, messages }) => {
    await events.session_start({ reason: "startup" }, ctx);
    expect(read("ready.json").error).toContain("model");
    expect(messages).toHaveLength(0);
  }, { model: "wrong" });
});

test("wrong nonce, changed session, and busy worker refuse release", async () => {
  for (const variant of ["nonce", "session", "busy"]) {
    await fixture(async ({ events, ctx, release, read, messages }) => {
      await events.session_start({ reason: "startup" }, ctx);
      if (variant === "session") ctx.sessionManager.getSessionId = () => "other";
      if (variant === "busy") ctx.isIdle = () => false;
      release(variant === "nonce" ? "wrong" : "unique");
      await pause();
      expect(read("delivery.json").status).toBe("failed");
      expect(messages).toHaveLength(0);
    });
  }
});

test("failed delivery retains claim and cannot auto-replay", async () => {
  await fixture(async ({ events, ctx, pi, release, read, directory }) => {
    pi.sendUserMessage = () => { throw new Error("uncertain delivery"); };
    await events.session_start({ reason: "startup" }, ctx);
    release(); await pause();
    expect(existsSync(join(directory, "claimed.json"))).toBe(true);
    expect(read("delivery.json").status).toBe("failed");
    await events.session_start({ reason: "startup" }, ctx);
    expect(read("ready.json").error).toContain("already claimed");
  });
});

test("shutdown cancels pending release", async () => {
  await fixture(async ({ events, ctx, release, messages }) => {
    await events.session_start({ reason: "startup" }, ctx);
    events.session_shutdown(); release(); await pause();
    expect(messages).toHaveLength(0);
  });
});

test("slash command saves exact brief and routes only orchestration into current session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "feature-slash-test-"));
  const previous = { ...process.env };
  const socket = Bun.listen({ unix: join(directory, 'herdr.sock'), socket: { data() {} } });
  process.env.HERDR_SOCKET_PATH = join(directory, 'herdr.sock');
  process.env.HERDR_ENV = "1"; process.env.XDG_STATE_HOME = directory;
  let handler: any; const messages: string[] = [];
  const events: any = {};
  feature({ registerTool: () => {}, registerFlag: () => {}, on: (name: string, fn: any) => events[name] = fn, getFlag: () => undefined,
    exec: async () => ({ code: 0, stdout: directory }),
    registerCommand: (_name: string, def: any) => handler = def.handler, sendUserMessage: (m: string) => messages.push(m) } as any);
  const brief = 'Investigate foo\n\n  - "reuse"\n';
  const ctx: any = { cwd: directory, isIdle: () => true, hasPendingMessages: () => false, hasUI: false, ui: { notify: () => {} },
    sessionManager: { getSessionId: () => "caller", getSessionFile: () => "/caller.jsonl", getSessionName: () => "Caller", getEntries: () => [] } };
  try {
    await events.session_start({ reason: "startup" }, ctx);
    await handler("foo " + brief, ctx);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("do not implement or build the feature here");
    const path = JSON.parse(messages[0].match(/Original brief file \(preserve verbatim\): (.+)/)![1]);
    expect(readFileSync(path, "utf8")).toBe(brief);
    expect(messages[0]).toContain("Explicit existing coordinator: pass --coordinator");
  } finally { events.session_shutdown(); socket.stop(true); process.env = previous; rmSync(directory, { recursive: true }); }
});

test("slash command cancellation and busy checks never dispatch", async () => {
  let handler: any; const messages: any[] = [];
  feature({ registerTool: () => {}, registerFlag: () => {}, on: () => {}, registerCommand: (_name: string, def: any) => handler = def.handler, sendUserMessage: (m: any) => messages.push(m) } as any);
  const old = process.env.HERDR_ENV; process.env.HERDR_ENV = "1";
  const ctx: any = { isIdle: () => false, hasUI: true, ui: { notify: () => {}, input: async () => undefined, editor: async () => undefined } };
  try {
    await handler("foo plan", ctx);
    ctx.isIdle = () => true;
    await handler("", ctx);
    await handler("foo", ctx);
    await handler("../bad plan", ctx);
    expect(messages).toHaveLength(0);
  } finally { if (old === undefined) delete process.env.HERDR_ENV; else process.env.HERDR_ENV = old; }
});
