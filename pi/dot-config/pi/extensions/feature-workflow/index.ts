import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { installCoordination } from "./coordination.ts";
import { installPhaseTool } from "./phase.ts";
import { installFollowupTool } from "./followup.ts";

export function splitFeatureArgs(args: string): { name: string; brief: string } {
  const match = /^\s*(\S+)(?:[ \t]|\r?\n)?([\s\S]*)$/.exec(args);
  return { name: match?.[1] ?? "", brief: match?.[2] ?? "" };
}

export default function (pi: ExtensionAPI) {
  const registration = installCoordination(pi);
  installPhaseTool(pi, registration);
  installFollowupTool(pi, registration);
  pi.registerCommand("feature", {
    description: "Start an isolated Pi feature worker: /feature <name> <brief> (multiline supported)",
    handler: async (args, ctx) => {
      if (process.env.HERDR_ENV !== "1") { ctx.ui.notify("/feature requires a Herdr-managed pane", "error"); return; }
      if (!ctx.isIdle()) { ctx.ui.notify("Wait for this session to finish before launching a feature", "warning"); return; }
      let { name, brief } = splitFeatureArgs(args);
      if (!name && ctx.hasUI) name = await ctx.ui.input("Feature name", "foo") ?? "";
      if (!name) return;
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) || name.length > 48) {
        ctx.ui.notify("Use a lowercase feature name such as email-table (maximum 48 characters)", "error"); return;
      }
      if (!brief.trim() && ctx.hasUI) {
        brief = await ctx.ui.editor("Feature brief — goals and authorized phase", "Investigate existing reusable code, design the architecture, and make a plan. Do not implement yet.") ?? "";
      }
      if (!brief.trim()) { ctx.ui.notify("A nonempty brief is required", "warning"); return; }
      if (Buffer.byteLength(brief) > 128 * 1024) { ctx.ui.notify("Brief exceeds 128 KiB", "error"); return; }
      let destination;
      try { destination = await registration.activate(ctx); }
      catch (error) { ctx.ui.notify(`Feature activation refused: ${error}`, "error"); return; }
      const directory = join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "feature-workflow", "requests", randomUUID());
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, "brief.md");
      writeFileSync(path, brief, { mode: 0o600, flag: "wx" });
      pi.sendUserMessage([
        "Use the feature-workflow skill to launch a fresh independent worker. This session is the orchestrator: do not implement or build the feature here.",
        `Feature name: ${name}`,
        `Original brief file (preserve verbatim): ${JSON.stringify(path)}`,
        `Source cwd: ${JSON.stringify(ctx.cwd)}`,
        `Explicit existing coordinator: pass --coordinator ${destination.epoch}. Do not create a second coordinator or infer ownership from focus.`,
        "Read the skill in ~/.config/agents/skills/feature-workflow/SKILL.md. Inspect repository instructions and base. Supply relevant agreed conversation decisions in a separate context file, not by rewriting the brief. If scope is sufficient, launch through feature-start; otherwise ask only the missing question. Report the launcher receipt and stop; a startup failure is not permission to take over the feature.",
      ].join("\n\n"));
    },
  });
}
