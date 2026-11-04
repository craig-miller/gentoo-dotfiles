// Test-only deterministic provider. No network, tools, credentials, or real model inference.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  let delay = 0, timer: ReturnType<typeof setInterval> | undefined;
  pi.registerCommand("offline-reload", { description: "Disposable test-only reload", handler: async (_args, ctx) => { await ctx.reload(); } });
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
        if (request.action === 'reload') pi.sendUserMessage('/offline-reload', { expandPromptTemplates: true });
        else { delay = request.delay || 0; pi.sendUserMessage('Offline fixture: return a deterministic read-only status.'); }
        break;
      }
    }, 100);
  });
  pi.on("project_trust", () => ({ trusted: "yes", remember: false })); // Disposable fixture only.
  pi.registerProvider("feature-offline", {
    baseUrl: "http://unused.invalid", apiKey: "offline-fixture", api: "feature-offline",
    models: ["worker", "coordinator"].map(id => ({ id, name: id, reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1024 })),
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      const wait = delay; delay = 0;
      const finish = () => {
        const output: any = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "pending", timestamp: Date.now() };
        stream.push({ type: "start", partial: output });
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
