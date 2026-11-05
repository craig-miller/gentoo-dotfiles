import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function contextObservation(ctx: ExtensionContext) {
  let usage;
  try { usage = ctx.getContextUsage?.(); } catch { /* Unknown is not zero. */ }
  const percent = typeof usage?.percent === "number" && Number.isFinite(usage.percent) && usage.percent >= 0 ? usage.percent : null;
  return { percent, tokens: usage?.tokens ?? null, contextWindow: usage?.contextWindow ?? null,
    leaf: ctx.sessionManager.getLeafId?.() ?? null, observedAt: Date.now(),
    guidance: percent === null ? "unknown: coordinator judgment required" : percent >= 70 ? "evaluate, NOT automatic compaction" : "keep by default; evaluate continuity and debugging history" };
}

export function evaluateContext(input: any, observation: any, decision: string) {
  if (!observation || !Object.hasOwn(observation, "percent") || !Object.hasOwn(observation, "leaf")) throw new Error("Worker context telemetry unavailable; safely load current candidate before evaluation");
  if (!input || !Object.hasOwn(input, "usagePercent") || !Object.hasOwn(input, "leaf") ||
      input.usagePercent !== observation.percent || input.leaf !== observation.leaf) throw new Error("Explicit context evaluation must match current usage (including unknown/null) and leaf; inspect again");
  for (const key of ["continuity", "debuggingHistory", "rationale"]) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 4000) throw new Error(`Context evaluation requires bounded ${key}`);
  }
  if (!["keep", "compact"].includes(decision)) throw new Error("Explicit keep/compact decision required; 70% never selects automatically");
  return { usagePercent: input.usagePercent, leaf: input.leaf, continuity: input.continuity,
    debuggingHistory: input.debuggingHistory, rationale: input.rationale, decision, observation };
}
