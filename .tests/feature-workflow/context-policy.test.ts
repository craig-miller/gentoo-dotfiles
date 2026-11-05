import { test, expect } from "bun:test";
import { contextObservation, evaluateContext } from "../../pi/dot-config/pi/extensions/feature-workflow/context-policy.ts";
import { startPhase, inspectPhaseContext, phaseStatus } from "../../pi/dot-config/pi/extensions/feature-workflow/phase.ts";
import { fixture } from "./phase.test.ts";

const observation = (usage: any) => contextObservation({ getContextUsage: () => usage, sessionManager: { getLeafId: () => "leaf" } } as any);
const assessment = (percent: any) => ({ usagePercent: percent, leaf: "leaf", continuity: "Same implementation context remains useful", debuggingHistory: "Preserve unresolved failure hypotheses", rationale: "Coordinator assessed the reviewed/committed boundary" });

test("70% prompts judgment, never compaction; below keeps by default and unknown is not zero", () => {
  for (const percent of [0, 69.9, 70, 90, null]) {
    const value = observation({ percent, tokens: percent === null ? null : 500 });
    expect(value.percent).toBe(percent);
    expect(value.guidance).toContain(percent === null ? "unknown" : percent >= 70 ? "NOT automatic" : "keep by default");
    for (const decision of ["keep", "compact"]) expect(evaluateContext(assessment(percent), value, decision).decision).toBe(decision);
  }
  expect(observation(undefined).percent).toBe(null);
  expect(observation({ percent: NaN }).percent).toBe(null);
  expect(() => evaluateContext(assessment(0), observation(undefined), "keep")).toThrow("including unknown");
  expect(() => evaluateContext(assessment(70), observation({ percent: 70 }), "auto")).toThrow("Explicit keep/compact");
  for (const key of ["usagePercent", "leaf", "continuity", "debuggingHistory", "rationale"]) {
    const input: any = assessment(null); delete input[key];
    expect(() => evaluateContext(input, observation(undefined), "keep")).toThrow();
  }
});

test("phase admission requires persisted explicit evaluation; worker rejects observation drift before branching", async () => {
  await fixture(async f => {
    const inspected = await inspectPhaseContext(f.pi, f.context(f.coordinator), f.coordinator, f.input);
    expect(inspected.observation.percent).toBe(null);
    await expect(startPhase(f.pi, f.context(f.coordinator), f.coordinator, { ...f.input, contextEvaluation: undefined })).rejects.toThrow("context evaluation");
    f.worker.context = { percent: 70, leaf: "leaf" }; f.publish();
    const result = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, { ...f.input, contextEvaluation: assessment(70) });
    // The worker context now differs from the explicitly assessed observation.
    await f.poll();
    expect(phaseStatus(result.id).blocked.error).toContain("context evaluation");
    expect(f.calls.some((c: any) => c[0] === "stax")).toBe(false); expect(f.messages).toHaveLength(0);
  });
});
