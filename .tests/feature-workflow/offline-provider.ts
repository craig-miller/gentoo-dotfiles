// Test-only deterministic provider. No network, credentials or real inference.
// An explicit private tool-run fixture exercises real bounded sleep/printf tools.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  let delay = 0, timer: ReturnType<typeof setInterval> | undefined;
  let scenario: { id: string; messageId: string; step: number; directory: string } | undefined;
  const trace = (event: any) => {
    if (scenario) appendFileSync(join(scenario.directory, scenario.id + '.trace.jsonl'), JSON.stringify(event) + '\n');
  };
  pi.on('tool_execution_start', event => { trace({ type: 'tool-start', id: event.toolCallId }); });
  pi.on('tool_execution_end', event => { trace({ type: 'tool-end', id: event.toolCallId, isError: event.isError }); });
  pi.on('agent_settled', event => { trace({ type: 'settled', aborted: event.aborted }); scenario = undefined; });
  pi.registerCommand("offline-reload", { description: "Disposable test-only reload", handler: async (_args, ctx) => { await ctx.reload(); } });
  pi.registerCommand("offline-modal", { description: "Disposable blocking-UI fixture", handler: async (_args, ctx) => {
    await ctx.ui.confirm("Synthetic phase/follow-up test", "Private test modal; automatically closes", { timeout: 6000 });
  } });
  pi.on("session_shutdown", () => { if (timer) clearInterval(timer); timer = undefined; });
  pi.on("session_start", (_event, ctx) => {
    const directory = join(process.env.XDG_STATE_HOME!, 'offline-controls', ctx.sessionManager.getSessionId());
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    timer = setInterval(() => {
      if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
      for (const file of readdirSync(directory).filter(f => f.endsWith('.json'))) {
        const path = join(directory, file);
        if (existsSync(path + '.claim')) continue;
        const request = JSON.parse(readFileSync(path, 'utf8'));
        writeFileSync(path + '.claim', 'claimed', { flag: 'wx', mode: 0o600 });
        if (request.action === 'followup') pi.sendUserMessage('/feature-followup ' + JSON.stringify(request.input), { expandPromptTemplates: true });
        else if (request.action === 'tool-run' && /^[a-z0-9-]+$/.test(request.id)) {
          scenario = { id: request.id, messageId: request.messageId, step: 0, directory };
          pi.sendUserMessage('Offline fixture: deterministic bounded tool sequence, no live actions.');
        }
        else if (request.action === 'modal') pi.sendUserMessage('/offline-modal', { expandPromptTemplates: true });
        else if (request.action === 'phase') pi.sendUserMessage('/feature-phase ' + JSON.stringify(request.input), { expandPromptTemplates: true });
        else if (request.action === 'reload') pi.sendUserMessage('/offline-reload', { expandPromptTemplates: true });
        else { delay = request.delay || 0; pi.sendUserMessage('Offline fixture: return a deterministic read-only status.'); }
        break;
      }
    }, 100);
  });
  pi.on("session_before_compact", (_event, ctx) => {
    if (existsSync(join(process.env.XDG_STATE_HOME!, 'offline-controls', ctx.sessionManager.getSessionId(), 'fail-compaction'))) return { cancel: true };
  });
  pi.on("project_trust", () => ({ trusted: "yes", remember: false })); // Disposable fixture only.
  pi.registerProvider("feature-offline", {
    baseUrl: "http://unused.invalid", apiKey: "offline-fixture", api: "feature-offline",
    models: ["worker", "coordinator"].map(id => ({ id, name: id, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1024 })),
    streamSimple(model, context, options) {
      const step = scenario?.step;
      if (scenario) {
        trace({ type: 'provider', step, seen: JSON.stringify(context.messages).includes('Operation: ' + scenario.messageId) });
        scenario.step++;
      }
      const stream = createAssistantMessageEventStream();
      const wait = delay; delay = 0;
      const finish = () => {
        const output: any = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "pending", timestamp: Date.now() };
        if (options?.signal?.aborted) {
          output.stopReason = 'aborted'; output.errorMessage = 'Fixture aborted';
          stream.push({ type: 'error', reason: 'aborted', error: output }); stream.end(); return;
        }
        stream.push({ type: "start", partial: output });
        if (scenario && step !== undefined && step < 2) {
          for (const [i, seconds] of (step === 0 ? [6, 8] : [2]).entries()) {
            const toolCall: any = { type: 'toolCall', id: `fixture-${scenario.id}-${step}-${i}`, name: 'bash', arguments: { command: `sleep ${seconds}; printf 'FIXTURE_TOOL_FINISHED\\n'`, timeout: 20 } };
            output.content.push(toolCall);
            stream.push({ type: 'toolcall_start', contentIndex: i, partial: output });
            stream.push({ type: 'toolcall_end', contentIndex: i, toolCall, partial: output });
          }
          output.stopReason = 'toolUse';
          stream.push({ type: 'done', reason: 'toolUse', message: output }); stream.end(); return;
        }
        output.content.push({ type: "text", text: "" });
        stream.push({ type: "text_start", contentIndex: 0, partial: output });
        const text = `OFFLINE_${model.id.toUpperCase()}_OK: readiness fixture, not human approval`;
        output.content[0].text = text;
        stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
        stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
        output.stopReason = "stop";
        stream.push({ type: "done", reason: "stop", message: output });
        stream.end();
      };
      if (wait) setTimeout(finish, wait); else queueMicrotask(finish);
      return stream;
    },
  });
}
