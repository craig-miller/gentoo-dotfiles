import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { atomicJSON, herdrInstance, sameInstance } from "./protocol.ts";
export { atomicJSON } from "./protocol.ts";
import { dirname, join } from "node:path";
import { reportWorker } from "./coordination.ts";
import { hasAttachment } from "./attachment.ts";

export function taskPrompt(request: any): string {
  return [
    "You are the verified independent feature worker. Execute only the authorized scope below.",
    `Worktree: ${request.cwd}\nBranch: ${request.branch}\nIntegration base: ${request.base}`,
    "Read the shared feature-workflow skill at ~/.config/agents/skills/feature-workflow/SKILL.md as the assigned worker, not as a coordinator. Do not launch another feature worker. Respect project instructions already supplied by Pi.",
    "First use your own bash tool to check cwd, branch, PI_SESSION_ID, PI_PROVIDER and PI_MODEL against this assignment. Stop on a mismatch. Keep build artifacts independently writable in your worktree; coordinate shared dependencies rather than changing them implicitly.",
    `Expected PI_SESSION_ID: ${request.session}\nExpected PI_PROVIDER: ${request.provider}\nExpected PI_MODEL: ${request.model}`,
    "Planning/investigation requests authorize that work now, not implementation. If implementation is not explicitly authorized, investigate existing reusable code, propose architecture and a plan, then stop for review. Do not merely acknowledge a planning request and wait.",
    "No implicit commit, merge, push, cleanup, live app input or configuration changes. This is a fresh session; no previous conversation was resumed.",
    `Explicit coordinator: ${JSON.stringify(request.coordinator || null)}. Report readiness, blockers and requests here; the bridge forwards your settled response without changing focus. Worker status never grants human approval.`,
    "--- USER BRIEF (verbatim) ---", request.brief, "--- END USER BRIEF ---",
    "--- OPTIONAL ORCHESTRATOR CONTEXT (not additional authorization) ---", request.context || "(none)",
    "--- END CONTEXT ---",
  ].join("\n\n");
}

// Explicitly loaded by feature-start; not an auto-discovered global extension.
export default function (pi: ExtensionAPI) {
  pi.registerFlag("feature-request", { description: "Private feature launcher request", type: "string" });
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let activeRequest: any;
  pi.on("agent_settled", async (event, ctx) => {
    if (!activeRequest?.coordinator || hasAttachment(ctx.sessionManager.getSessionId())) return;
    const entries = ctx.sessionManager.getBranch();
    const last = [...entries].reverse().find((e: any) => e.type === "message" && e.message.role === "assistant") as any;
    const content = last?.message.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || "Worker settled without a text response";
    const report = `${event.aborted ? "Aborted; inspect before continuing.\n" : ""}${content}`;
    atomicJSON(join(dirname(String(pi.getFlag("feature-request"))), "last-report.json"), { session: activeRequest.session, report });
    try { await reportWorker(pi, ctx, activeRequest, report); }
    catch (error) { ctx.ui.notify(`Coordinator report deferred: ${error}. Report retained in last-report.json.`, "error"); }
  });
  const stop = () => { generation++; if (timer) clearInterval(timer); timer = undefined; };
  pi.on("session_shutdown", stop);
  pi.on("session_start", async (event, ctx) => {
    stop();
    activeRequest = undefined;
    if (event.reason !== "startup") return; // Never replay on reload/resume/fork.
    const requestPath = pi.getFlag("feature-request");
    if (typeof requestPath !== "string" || !requestPath) return;
    const directory = dirname(requestPath);
    const epoch = generation;
    let request: any;
    try {
      request = JSON.parse(readFileSync(requestPath, "utf8"));
      const roleIndex = process.argv.indexOf("--feature-role");
      const roleFlag = roleIndex >= 0 ? process.argv[roleIndex + 1] : process.argv.find(a => a.startsWith("--feature-role="))?.slice("--feature-role=".length);
      if (!["worker", "coordinator"].includes(request.role || "worker") || (roleFlag !== undefined && roleFlag !== (request.role || "worker"))) throw new Error("Launcher request/role conflict");
      if (existsSync(join(directory, "claimed.json"))) throw new Error("Handoff already claimed; no automatic replay");
      const git = async (...args: string[]) => {
        const result = await pi.exec("git", args, { cwd: ctx.cwd, timeout: 5000 });
        if (result.code !== 0) throw new Error(result.stderr || "Git identity lookup failed");
        return result.stdout.trim();
      };
      const observed = {
        nonce: request.nonce, epoch: randomUUID(), instance: herdrInstance(), cwd: realpathSync(ctx.cwd),
        branch: await git("branch", "--show-current"), head: await git("rev-parse", "HEAD"),
        session: ctx.sessionManager.getSessionId(), session_file: ctx.sessionManager.getSessionFile(),
        provider: ctx.model?.provider, model: ctx.model?.id,
        pane: process.env.HERDR_PANE_ID, tab: process.env.HERDR_TAB_ID,
        workspace: process.env.HERDR_WORKSPACE_ID,
      };
      for (const key of ["cwd", "branch", "head", "session", "provider", "model", "pane", "tab", "workspace"] as const) {
        if (observed[key] !== request[key]) throw new Error(`Worker identity mismatch: ${key}`);
      }
      if (!sameInstance(observed.instance, request.instance)) throw new Error("Herdr instance mismatch");
      if (process.env.HERDR_ENV !== "1" || observed.session === request.parent_session) throw new Error("Not an independent Herdr worker");
      if (ctx.sessionManager.getEntries().some((entry) => entry.type === "message")) throw new Error("Session is not fresh");
      if (epoch !== generation) return;
      atomicJSON(join(directory, "ready.json"), observed);
      if (request.role === "coordinator") return; // Assignment arrives only after worker verification through the inbox.
      const deadline = Date.now() + 120_000;
      timer = setInterval(() => {
        try {
          if (Date.now() > deadline) throw new Error("Launcher did not release the brief before timeout");
          const release = join(directory, "release.json");
          if (!existsSync(release)) return;
          if (JSON.parse(readFileSync(release, "utf8")).nonce !== request.nonce) throw new Error("Release nonce mismatch");
          if (!sameInstance(request.instance, herdrInstance())) throw new Error("Herdr instance changed before release");
          if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error("Worker is busy; refusing task injection");
          if (ctx.sessionManager.getSessionId() !== request.session || ctx.model?.id !== request.model || ctx.model?.provider !== request.provider) throw new Error("Worker identity changed before release");
          // Claim BEFORE delivery; an interruption is uncertain, never auto-replayed.
          writeFileSync(join(directory, "claimed.json"), JSON.stringify({ nonce: request.nonce }), { flag: "wx", mode: 0o600 });
          stop();
          activeRequest = { ...request, worker_epoch: observed.epoch };
          pi.sendUserMessage(taskPrompt(request)); // API delivery bypasses modal editor/paste entirely.
          atomicJSON(join(directory, "delivery.json"), { nonce: request.nonce, status: "submitted" });
        } catch (error) {
          stop();
          atomicJSON(join(directory, "delivery.json"), { nonce: request.nonce, status: "failed", error: String(error) });
          ctx.ui.notify(`Feature handoff stopped: ${error}`, "error");
        }
      }, 100);
    } catch (error) {
      if (epoch !== generation) return;
      atomicJSON(join(directory, "ready.json"), { nonce: request?.nonce, error: String(error) });
      ctx.ui.notify(`Feature identity check failed: ${error}`, "error");
    }
  });
}
