import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Reviews, reportText, type Request } from "./lifecycle.ts";
import { Reporter } from "./reporting.ts";

export default function (pi: ExtensionAPI) {
  const reviews = new Reviews(pi);
  let reporter: Reporter | undefined, timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => { reporter?.stop(); reporter = undefined; if (timer) clearInterval(timer); timer = undefined; };
  pi.on("session_shutdown", stop);
  pi.on("session_start", (_event, ctx) => {
    stop();
    if (process.env.HERDR_ENV !== "1" || !ctx.sessionManager.getSessionFile() || !["tui", "rpc"].includes(ctx.mode)) return;
    reporter = new Reporter(pi, ctx);
    timer = setInterval(() => { void reporter?.tick(); }, 1500);
    timer.unref?.();
  });
  pi.on("ui_prompt_start", () => { if (reporter) reporter.blockedUI = true; });
  pi.on("ui_prompt_end", () => { if (reporter) reporter.blockedUI = false; });
  pi.on("agent_settled", () => { void reporter?.tick(); });

  pi.registerTool({
    name: "feature_review", label: "Feature review",
    description: "Open an explicitly scoped frozen Git worktree-vs-base review in a separate Herdr tab; retrieve status/feedback, verify source drift, or request owned-runner close by durable ID. Requires tuicr, Herdr and Node. Completion reports automatically start a Pi turn; review is never approval. Output limited to 16k characters/500 lines; full receipts retained privately.",
    promptSnippet: "Open frozen scoped reviews; retrieve feedback and verify reviewed source",
    promptGuidelines: ["Use feature_review instead of writing ad hoc review launchers. For open specify an exact Git root, explicit base, exact changed file paths (including selected new files), and a stable requestKey. Reuse that key on uncertain results; never duplicate an uncertain launch.",
      "feature_review status is never human approval. Use feature_review verify immediately before asking for commit approval; source must match and the snapshot must be intact. Do not infer commit, integration, installation, push or cleanup permission."],
    executionMode: "sequential",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("open"), Type.Literal("status"), Type.Literal("feedback"), Type.Literal("verify"), Type.Literal("close")]),
      id: Type.Optional(Type.String()), repo: Type.Optional(Type.String()), base: Type.Optional(Type.String()),
      paths: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 128 })), requestKey: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      const result = await reviews.act(params, ctx, signal);
      return { content: [{ type: "text", text: reportText(result, result.directory ?? "review receipt") }], details: { id: result.id, identity: result.identity, approval: false }, isError: Boolean("error" in result && result.error) };
    },
  });
  pi.registerCommand("review", {
    description: 'Same lifecycle as feature_review. Usage: /review {"action":"open","repo":"/repo","base":"main","paths":["file"],"requestKey":"review-1"} or /review status|feedback|verify|close ID',
    handler: async (args, ctx) => {
      try {
        const parts = args.trim().split(/\s+/);
        const request: Request = args.trim().startsWith("{") ? JSON.parse(args) : { action: parts[0] as Request["action"], id: parts[1] };
        if (!args.trim() || (!args.trim().startsWith("{") && (parts.length !== 2 || !["status", "feedback", "verify", "close"].includes(parts[0])))) throw Error('Use /review {"action":"open","repo":"/repo","base":"main","paths":["file"],"requestKey":"review-1"} or /review status|feedback|verify|close ID. Legacy implicit whole-checkout review is intentionally unsupported.');
        const result = await reviews.act(request, ctx);
        pi.sendMessage({ customType: "feature-review-command", display: true, content: reportText(result, result.directory ?? "review receipt") }, { triggerTurn: false });
      } catch (e) { ctx.ui.notify(String(e), "error"); }
    },
  });
}
