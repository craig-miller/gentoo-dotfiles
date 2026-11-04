import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createSnapshot, digest, validatePaths, verifySnapshot } from "./snapshot.ts";
import { collectFeedback } from "./runner.mjs";
import { atomic, claim, directory, herdrInstance, manifests, optional, privateDir, read, root, sameInstance, sameOwner, status, type Manifest, type Owner } from "./store.ts";

export type Request = { action: "open" | "status" | "feedback" | "verify" | "close"; id?: string; repo?: string; base?: string; paths?: string[]; requestKey?: string };
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function ownerFor(ctx: ExtensionContext): Owner {
  if (process.env.HERDR_ENV !== "1" || !ctx.sessionManager.getSessionFile() || !["tui", "rpc"].includes(ctx.mode)) throw Error("Opening reviews requires a persistent Pi conversation inside Herdr (TUI/RPC).");
  const { HERDR_PANE_ID: pane, HERDR_TAB_ID: tab, HERDR_WORKSPACE_ID: workspace } = process.env;
  if (!pane || !tab || !workspace) throw Error("Herdr caller identity unavailable.");
  return { session: ctx.sessionManager.getSessionId(), sessionFile: ctx.sessionManager.getSessionFile()!, pane, tab, workspace, instance: herdrInstance() };
}
export async function liveOwner(pi: ExtensionAPI, owner: Owner) {
  if (!sameInstance(owner.instance, herdrInstance())) return false;
  const result = await pi.exec("herdr", ["agent", "get", owner.pane], { timeout: 5000 });
  if (!sameInstance(owner.instance, herdrInstance())) return false;
  const agent = result.code === 0 ? JSON.parse(result.stdout).result?.agent : undefined;
  return agent?.agent === "pi" && agent?.pane_id === owner.pane && agent?.tab_id === owner.tab && agent?.workspace_id === owner.workspace && agent?.agent_session?.value === owner.sessionFile;
}
export function reportText(value: unknown, path: string) {
  const raw = JSON.stringify(value, null, 2), lines = raw.split("\n");
  const text = lines.slice(0, 500).join("\n");
  return text.length <= 16000 && lines.length <= 500 ? text : text.slice(0, 16000) + `\n[Truncated; full private receipt: ${path}]`;
}
export class Reviews {
  constructor(private pi: ExtensionAPI) {}
  async act(request: Request, ctx: ExtensionContext, signal?: AbortSignal) {
    if (request.action === "open") return this.open(request, ctx, signal);
    if (!request.id) throw Error("id is required.");
    const dir = directory(request.id), manifest: Manifest | undefined = optional(join(dir, "manifest.json"));
    if (!existsSync(dir)) throw Error("Unknown review ID.");
    if (manifest && manifest.version !== 1) throw Error("Legacy/manual review receipt; not a feature_review lifecycle record.");
    if (["status", "feedback"].includes(request.action)) {
      let feedbackError: string | undefined;
      // Explicit retrieval can recover saved tuicr feedback even after a killed runner.
      // Never reclassify an interrupted UI as successfully completed.
      if (manifest && existsSync(join(dir, "data")) && (!existsSync(join(dir, "completion.json")) || !existsSync(join(dir, "feedback.json")))) {
        try { collectFeedback(dir); } catch (e) { feedbackError = String(e); }
      }
      return { ...status(request.id), feedbackError, ...(request.action === "feedback" ? { comments: optional(join(dir, "feedback.json")) ?? null, feedbackPath: join(dir, "feedback.json") } : {}) };
    }
    if (!manifest) throw Error("Review has no completed snapshot; inspect status.");
    if (request.action === "verify") {
      const verification = verifySnapshot(manifest.snapshot, join(dir, "snapshot")), reviewState = status(request.id).state;
      const result = { id: request.id, directory: dir, identity: manifest.snapshot.identity, ...verification, reviewState,
        readyForApprovalRequest: verification.sourceMatches && verification.snapshotIntact && reviewState === "completed" };
      atomic(join(dir, "verification.json"), result); return result;
    }
    if (request.action === "close") {
      if (!sameOwner(manifest.owner, ownerFor(ctx))) throw Error("Only the exact invoking session/pane/Herdr instance may request close.");
      if (existsSync(join(dir, "completion.json"))) return { ...status(request.id), close: optional(join(dir, "close.json")) ?? { state: "retained", reason: "No live runner; will not close a possibly replaced pane." } };
      claim(join(dir, "cancel.request"), { session: manifest.owner.session, at: new Date().toISOString() });
      return { ...status(request.id), close: "requested; only the owned runner may close itself" };
    }
    throw Error("Unsupported action.");
  }
  private async open(r: Request, ctx: ExtensionContext, signal?: AbortSignal) {
    if (!r.repo || !r.base || !r.paths || !r.requestKey || !/^[A-Za-z0-9_-]{1,80}$/.test(r.requestKey)) throw Error("open requires repo, base, paths and a stable requestKey (1–80 letters/digits/_/-).");
    const owner = ownerFor(ctx), source = realpathSync(resolve(ctx.cwd, r.repo)), paths = validatePaths(r.paths);
    const requestHash = digest(JSON.stringify({ source, base: r.base, paths }));
    privateDir(root()); privateDir(join(root(), "keys")); privateDir(join(root(), "locks"));
    const key = join(root(), "keys", digest(JSON.stringify({ owner, requestKey: r.requestKey })) + ".json");
    const previous = optional(key);
    if (previous) {
      if (previous.requestHash !== requestHash) throw Error("requestKey already belongs to a different scope. Do not retry uncertain launches with a new key.");
      return { ...status(previous.id), duplicate: true };
    }
    if (!await liveOwner(this.pi, owner)) throw Error("Invoking Pi pane/session no longer matches.");
    signal?.throwIfAborted();
    const lock = join(root(), "locks", digest(source));
    try { mkdirSync(lock, { mode: 0o700 }); } catch { throw Error(`Another launch owns ${lock}. A crash leaves this lock for explicit recovery; never blindly retry.`); }
    const id = randomUUID(), dir = directory(id);
    let stage = "snapshot";
    try {
      // Also guards simultaneous extension instances that share a request key.
      const again = optional(key);
      if (again) { if (again.requestHash !== requestHash) throw Error("requestKey scope conflict"); return { ...status(again.id), duplicate: true }; }
      for (const m of manifests()) {
        if (m.snapshot.source === source && !existsSync(join(directory(m.id), "completion.json")) && m.snapshot.files.some(f => paths.includes(f.path))) throw Error(`Scope overlaps active or uncertain review ${m.id}; retrieve its status before proceeding.`);
      }
      privateDir(dir);
      claim(key, { id, requestHash });
      atomic(join(dir, "launch.json"), { state: "preparing", created: new Date().toISOString() });
      const snapshot = createSnapshot(source, r.base, paths, join(dir, "snapshot"), signal);
      const manifest: Manifest = { version: 1, id, requestHash, requestKey: r.requestKey, created: new Date().toISOString(), owner, snapshot };
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      writeFileSync(join(dir, "runner.mjs"), readFileSync(join(dirname(fileURLToPath(import.meta.url)), "runner.mjs")), { flag: "wx", mode: 0o600 });
      const verification = verifySnapshot(snapshot, join(dir, "snapshot"));
      if (!verification.sourceMatches || !verification.snapshotIntact) throw Error("Source/snapshot drifted before launch.");
      if (!await liveOwner(this.pi, owner)) throw Error("Origin changed before launch.");
      signal?.throwIfAborted();
      stage = "create";
      atomic(join(dir, "launch.json"), { state: "launch_uncertain", phase: "tab-create", at: Date.now() });
      const tab = await this.pi.exec("herdr", ["tab", "create", "--workspace", owner.workspace, "--cwd", join(dir, "snapshot"), "--label", `review ${id}`, "--focus"], { timeout: 10000 });
      if (tab.code !== 0 || tab.killed || tab.truncated) throw Error(`Tab creation uncertain: ${tab.stderr}`);
      const created = JSON.parse(tab.stdout).result;
      const launch = { state: "launch_uncertain", phase: "pane-run", tab: created.tab.tab_id, pane: created.root_pane.pane_id, terminal: created.root_pane.terminal_id, at: Date.now() };
      atomic(join(dir, "launch.json"), launch);
      if (!sameInstance(owner.instance, herdrInstance())) throw Error("Herdr instance changed during creation; no input sent.");
      // exec replaces the new shell; the runner must prove shell_pid === its PID.
      // Quoting works in fish/bash/zsh, and no source path is evaluated as shell code.
      const started = await this.pi.exec("herdr", ["pane", "run", launch.pane, `exec node ${quote(join(dir, "runner.mjs"))} ${quote(dir)}`], { timeout: 10000 });
      if (started.code !== 0 || started.killed || started.truncated) throw Error(`Runner launch uncertain: ${started.stderr}`);
      atomic(join(dir, "launch.json"), { ...launch, state: "opening", phase: "api-acknowledged" });
      return { ...status(id), notice: "Review starts asynchronously; completion is not approval. Keep selected files quiescent; verify before asking for commit approval." };
    } catch (e) {
      if (existsSync(dir)) {
        if (stage === "snapshot") atomic(join(dir, "completion.json"), { state: "failed", error: String(e), approval: false });
        else atomic(join(dir, "launch.json"), { ...optional(join(dir, "launch.json")), state: "launch_uncertain", error: String(e) });
        return { ...status(id), error: String(e) };
      }
      throw e;
    } finally { rmdirSync(lock); }
  }
}
