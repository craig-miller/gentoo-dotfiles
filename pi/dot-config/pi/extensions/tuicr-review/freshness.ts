import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { digest } from "./snapshot.ts";

export type Freshness = { checkpoint: string; synchronization: string; checkpointHash: string; synchronizationHash: string };
function file(path: string) {
  if (!isAbsolute(path)) throw Error("Freshness evidence paths must be absolute");
  const canonical = realpathSync(path), stat = statSync(canonical);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw Error("Freshness evidence must be a bounded regular file");
  return { path: canonical, hash: digest(readFileSync(canonical)) };
}
export function pinFreshness(checkpoint?: string, synchronization?: string): Freshness | undefined {
  if (!checkpoint && !synchronization) return undefined; // Generic document reviews are unaffected.
  if (!checkpoint || !synchronization) throw Error("Feature review requires both featureCheckpoint and syncEvidence");
  const c = file(checkpoint), s = file(synchronization);
  return { checkpoint: c.path, synchronization: s.path, checkpointHash: c.hash, synchronizationHash: s.hash };
}
export async function checkFreshness(pi: ExtensionAPI, source: string, base: string, proof?: Freshness) {
  if (!proof) return undefined;
  if (JSON.stringify(pinFreshness(proof.checkpoint, proof.synchronization)) !== JSON.stringify(proof)) throw Error("Pinned freshness evidence changed; do not reuse an uncertain review request key");
  const result = await pi.exec("feature-preflight", ["--repo", source, "--base", base, "--stage", "review",
    "--accepted-checkpoint", proof.checkpoint, "--sync-evidence", proof.synchronization], { cwd: source, timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.code !== 0 || result.killed || result.truncated) throw Error(`Feature freshness gate blocked (exit ${result.code}):\n${result.stdout.slice(0, 12000)}\n${result.stderr.slice(0, 2000)}`);
  const report = JSON.parse(result.stdout);
  if (report.version !== 1 || report.stage !== "review" || report.gate !== "ready" || report.checkpoint?.repo !== source || report.checkpoint?.base !== base || report.approval !== false) throw Error("Invalid/mismatched feature freshness report");
  if (JSON.stringify(pinFreshness(proof.checkpoint, proof.synchronization)) !== JSON.stringify(proof)) throw Error("Freshness evidence changed during verification");
  return report;
}
