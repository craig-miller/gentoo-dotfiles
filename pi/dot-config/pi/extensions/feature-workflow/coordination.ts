import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJSON, stateRoot, readJSON, matchesDestination, herdrInstance, sameInstance } from "./protocol.ts";

import { hasAttachment, pollAttachments, reportAttached, validBoundMessage, validateRequest } from "./attachment.ts";
import { pollPhases, pollRenewals, phaseReserved, acknowledgePendingPhase } from "./phase.ts";
import { contextObservation } from "./context-policy.ts";
import { enrollmentIntent, explicitEnrollment, verifyEnrollment, enrollmentType } from "./enrollment.ts";
import { pollFollowups, observeFollowup, settleFollowup } from "./followup.ts";

// Same-user private receipt transport. Epochs are runtime lifetimes, never repository ownership.
export function installCoordination(pi: ExtensionAPI) {
  // Pi flags are extension-scoped: index cannot read worker.ts's feature-request flag.
  pi.registerFlag("feature-role", { description: "Launcher-owned session role", type: "string" });
  let registration: any, timer: ReturnType<typeof setInterval> | undefined, generation = 0, polling = false, blockedUI = false;
  const stop = () => {
    generation++;
    if (timer) clearInterval(timer);
    timer = undefined;
    if (registration) atomicJSON(join(stateRoot(), "sessions", registration.epoch + ".json"), { ...registration, live: false });
    registration = undefined;
  };
  pi.on("session_shutdown", stop);
  const reserved = () => registration?.role === "worker" && phaseReserved(registration.session);
  pi.on("input", (_event, ctx) => {
    if (reserved()) { ctx.ui.notify("Phase transition reserved: inspect/recover it through the coordinator before new work", "warning"); return { action: "handled" }; }
  });
  pi.on("session_before_switch", () => reserved() ? { cancel: true } : undefined);
  pi.on("session_before_fork", () => reserved() ? { cancel: true } : undefined);
  pi.on("session_before_tree", () => reserved() ? { cancel: true } : undefined);
  pi.on("user_bash", () => { if (reserved()) throw new Error("Phase transition reserved; shell input refused"); });
  // message_end runs BEFORE persistence in Pi. Acknowledge only from boundaries
  // that can observe the exact saved custom entry, never from an event alone.
  pi.on("context", (_event, ctx) => { acknowledgePendingPhase(ctx, registration); observeFollowup(ctx, registration); });
  pi.on("tool_call", (_event, ctx) => {
    acknowledgePendingPhase(ctx, registration);
    observeFollowup(ctx, registration);
    return reserved() ? { block: true, reason: "Phase transition reserved; no concurrent work", terminate: true } : undefined;
  });
  pi.on("turn_end", async (event, ctx) => {
    const mine = registration, gen = generation;
    if (mine && event.outcome === "completed") await pollFollowups(pi, ctx, mine, () => generation === gen && registration === mine, () => blockedUI, "turn_end");
  });
  pi.on("agent_before_settle", async (event, ctx) => {
    const mine = registration, gen = generation;
    if (mine && event.outcome === "completed") await pollFollowups(pi, ctx, mine, () => generation === gen && registration === mine, () => blockedUI, "agent_before_settle");
  });
  pi.on("agent_settled", async (event, ctx) => {
    const mine = registration, gen = generation;
    acknowledgePendingPhase(ctx, mine);
    if (mine && !(await settleFollowup(pi, ctx, mine, event.aborted, () => generation === gen && registration === mine))) {
      await reportAttached(pi, ctx, mine, event.aborted, () => generation === gen && registration === mine);
    }
  });
  pi.on("ui_prompt_start", () => { blockedUI = true; });
  pi.on("ui_prompt_end", () => { blockedUI = false; });
  const start = async (ctx: ExtensionContext, intent: any, bootstrap = false) => {
    const gen = generation;
    const enrollment = await verifyEnrollment(pi, ctx, intent, () => gen === generation, bootstrap);
    if (gen !== generation) throw new Error("Session changed during feature activation");
    if (!intent.persisted) pi.appendEntry(enrollmentType, enrollment);
    const mine = { ...enrollment, version: 2, enrollment,
      capabilities: ["coordination-opt-in-v1", "reporting-attach-v1", "phase-transition-v1", "followup-v1", "worker-messaging-v1"], epoch: randomUUID(),
      provider: ctx.model?.provider, model: ctx.model?.id, live: true };
    const root = stateRoot();
    mkdirSync(join(root, "sessions"), { recursive: true, mode: 0o700 });
    const inbox = join(root, "inbox", mine.epoch);
    mkdirSync(inbox, { recursive: true, mode: 0o700 });
    const heartbeat = () => atomicJSON(join(root, "sessions", mine.epoch + ".json"), {
      ...mine, provider: ctx.model?.provider, model: ctx.model?.id,
      name: ctx.sessionManager.getSessionName(), context: contextObservation(ctx), updated: Date.now(), busy: !ctx.isIdle() || ctx.hasPendingMessages() || blockedUI,
    });
    heartbeat();
    registration = mine;
    const poll = async () => {
      if (polling || generation !== gen) return;
      polling = true;
      try {
        if (!sameInstance(mine.instance, herdrInstance())) { stop(); return; }
        heartbeat();
        await pollAttachments(pi, ctx, mine, () => generation === gen && registration === mine);
        await pollPhases(pi, ctx, mine, () => generation === gen && registration === mine, () => blockedUI);
        await pollRenewals(pi, ctx, mine, () => generation === gen && registration === mine);
        await pollFollowups(pi, ctx, mine, () => generation === gen && registration === mine, () => blockedUI);
        if (generation !== gen || reserved()) return;
        for (const file of readdirSync(inbox).filter(f => f.endsWith(".request.json")).sort()) {
          const base = join(inbox, file.slice(0, -13)), ack = base + ".ack.json", claim = base + ".claim.json";
          if (existsSync(claim)) continue; // Includes uncertain delivery; never replay.
          const message = readJSON(join(inbox, file));
          const reply = (status: string, error?: string) => atomicJSON(ack, { id: message.id, feature: message.feature, epoch: mine.epoch, status, error });
          if (!matchesDestination(message, mine) || ctx.sessionManager.getSessionId() !== mine.session) {
            writeFileSync(claim, "rejected", { flag: "wx", mode: 0o600 }); reply("rejected", "Stale destination"); continue;
          }
          const validRelationship = () => {
            if (message.kind === "bound-status") return validBoundMessage(message, mine);
            const relationship = readJSON(message.relationship);
            const ownerSession = relationship.session || relationship.worker?.session;
            if (ownerSession && hasAttachment(ownerSession)) return false; // No late old-owner assignments/status after rebind.
            return ["assignment", "launch-status", "status"].includes(message.kind) &&
              relationship.nonce === message.feature && matchesDestination({ target: relationship.coordinator }, mine) &&
              (message.kind !== "status" || (message.sender?.session && message.sender?.epoch && !hasAttachment(message.sender.session) &&
                relationship.worker?.session === message.sender.session && relationship.worker?.epoch === message.sender.epoch));
          };
          if (!validRelationship()) {
            writeFileSync(claim, "rejected", { flag: "wx", mode: 0o600 }); reply("rejected", "Relationship mismatch"); continue;
          }
          if (!ctx.isIdle() || ctx.hasPendingMessages() || blockedUI) {
            reply("queued"); ctx.ui.setStatus("feature-inbox", "Feature update queued (waiting for idle)"); continue;
          }
          const live = await pi.exec("herdr", ["agent", "get", mine.pane], { timeout: 5000 });
          if (generation !== gen) return;
          if (!sameInstance(mine.instance, herdrInstance())) { stop(); return; }
          const agent = live.code === 0 ? JSON.parse(live.stdout).result?.agent : undefined;
          if (agent?.agent !== "pi" || agent?.agent_session?.value !== mine.session_file || agent?.pane_id !== mine.pane) {
            writeFileSync(claim, "rejected", { flag: "wx", mode: 0o600 }); reply("rejected", "Pane occupant changed"); continue;
          }
          if (!ctx.isIdle() || ctx.hasPendingMessages() || blockedUI) { reply("queued"); continue; }
          if (message.kind === "bound-status" && readJSON(message.relationship).phase) {
            try { await validateRequest(pi, ctx, mine, readJSON(message.relationship), "coordinator"); }
            catch (error) { writeFileSync(claim, "rejected", { flag: "wx", mode: 0o600 }); reply("rejected", String(error)); continue; }
            if (generation !== gen) return;
            if (!ctx.isIdle() || ctx.hasPendingMessages() || blockedUI) { reply("queued"); continue; }
          }
          if (!validRelationship()) { reply("rejected", "Reporting binding changed before delivery");
            writeFileSync(claim, "rejected", { flag: "wx", mode: 0o600 }); continue; }
          writeFileSync(claim, JSON.stringify({ id: message.id }), { flag: "wx", mode: 0o600 });
          try {
            pi.sendMessage({ customType: "feature-coordination", content: message.content, display: true,
              details: { feature: message.feature, revision: message.revision, id: message.id, sender: message.sender } }, { triggerTurn: true });
            reply("submitted"); // API acceptance, not model completion or human approval.
            ctx.ui.setStatus("feature-inbox", undefined);
          } catch (error) { reply("uncertain", String(error)); }
        }
      } catch (error) { ctx.ui.setStatus("feature-inbox", `Feature inbox blocked: ${error}`); }
      finally { polling = false; }
    };
    timer = setInterval(() => { void poll(); }, 1000);
    return registration;
  };
  let activation: Promise<any> | undefined;
  const activate = async (ctx: ExtensionContext, role = "coordinator", receipt?: string) => {
    const gen = generation, session = ctx.sessionManager.getSessionId(), file = ctx.sessionManager.getSessionFile();
    if (activation) await activation;
    if (gen !== generation || session !== ctx.sessionManager.getSessionId() || file !== ctx.sessionManager.getSessionFile()) throw new Error("Session changed during activation wait");
    if (registration) {
      if (registration.role !== role || registration.session !== ctx.sessionManager.getSessionId() || registration.session_file !== ctx.sessionManager.getSessionFile()) throw new Error("Cannot reclassify an enrolled feature session");
      return registration;
    }
    const task = start(ctx, explicitEnrollment(ctx, role, receipt)); activation = task;
    try { return await task; } finally { if (activation === task) activation = undefined; }
  };
  pi.registerCommand("feature-coordinate", {
    description: "Opt this session into coordination; optional: worker /absolute/original-receipt.json. Metadata only, no launch/input/focus.",
    handler: async (args, ctx) => {
      try {
        const text = args.trim();
        if (text && !text.startsWith("worker ")) throw new Error("Use /feature-coordinate or /feature-coordinate worker /absolute/receipt.json");
        const mine = await activate(ctx, text ? "worker" : "coordinator", text ? text.slice(7).trim() : undefined);
        ctx.ui.notify(`Feature ${mine.role} enrolled. Epoch: ${mine.epoch}. Attachment/renewal remains explicit; no work launched.`, "info");
      } catch (error) { ctx.ui.notify(String(error), "error"); }
    },
  });
  pi.on("session_start", (event, ctx) => {
    stop(); blockedUI = false;
    if (process.env.HERDR_ENV !== "1" || !ctx.sessionManager.getSessionFile()) return;
    try {
      const intent = enrollmentIntent(pi, ctx, event.reason);
      if (!intent) return; // Ordinary Git/Herdr sessions have no registration or timer.
      const gen = generation;
      // Do not block later session_start hooks (including Herdr's publisher).
      const task = start(ctx, intent, true).catch(error => {
        if (gen === generation) ctx.ui.notify(`Feature enrollment refused: ${error}`, "error");
      });
      activation = task;
      void task.finally(() => { if (activation === task) activation = undefined; });
    } catch (error) { ctx.ui.notify(`Feature enrollment refused: ${error}`, "error"); }
  });
  return Object.assign(() => registration, { activate, ready: () => activation });
}

export async function reportWorker(pi: ExtensionAPI, ctx: ExtensionContext, request: any, content: string) {
  const target = request.coordinator;
  if (!target) return;
  const root = stateRoot(), id = `${Date.now()}-${randomUUID()}`;
  const current = readJSON(join(root, "sessions", target.epoch + ".json"));
  if (!sameInstance(target.instance, herdrInstance()) || !current.live || Date.now() - current.updated > 10_000 || !matchesDestination({ target }, current)) throw new Error("Coordinator stale; report retained locally, explicit reselection required");
  const result = await pi.exec("herdr", ["agent", "get", target.pane], { timeout: 5000 });
  const agent = result.code === 0 ? JSON.parse(result.stdout).result?.agent : undefined;
  if (agent?.agent !== "pi" || agent?.agent_session?.value !== target.session_file) throw new Error("Coordinator pane was replaced/closed");
  const message = { id, feature: request.nonce, target, kind: "status", relationship: request.relationship,
    sender: { session: ctx.sessionManager.getSessionId(), epoch: request.worker_epoch, pane: process.env.HERDR_PANE_ID },
    content: `Worker report for ${request.branch}. This is agent status, NOT Craig's approval.\n\n${content}` };
  const path = join(root, "inbox", target.epoch, id + ".request.json");
  atomicJSON(path, message);
  ctx.ui.notify(`Report queued for coordinator; acknowledgement: ${path.replace(".request.json", ".ack.json")}`, "info");
}
