import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readJSON, stateRoot } from "./protocol.ts";
import { assertNotRestacking, validateAdoption } from "./restack-state.ts";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const phaseDirectory = (id: string) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid phase ID");
  return join(stateRoot(), "phases", id);
};
export function phaseRecord(id: string) {
  const directory = phaseDirectory(id), bytes = readFileSync(join(directory, "record.json"));
  const seal = readJSON(join(directory, "seal.json"));
  if (seal.sha256 !== digest(bytes)) throw new Error("Phase record changed");
  const record = JSON.parse(bytes.toString());
  if (record.id !== id || record.version !== 1) throw new Error("Phase identity mismatch");
  if (digest(readFileSync(record.receipt)) !== record.receipt_sha256) throw new Error("Original receipt changed");
  return record;
}

export function reportingPhaseReady(request: any) {
  assertNotRestacking(request.worker.session);
  validateAdoption(request);
  const pointer = join(stateRoot(), "reporting", digest(request.worker.session), "phase-current.json");
  if (!existsSync(pointer)) return;
  const id = readJSON(pointer).id;
  if (request.phase !== id || !existsSync(join(phaseDirectory(id), "delivered.json"))) throw new Error("Phase transition pending or superseded; reporting paused");
}

// This is an explicit, separately sealed branch authorization, not a relaxed
// comparison against the launch receipt. Ordinary attachments still use it verbatim.
export function phaseBranch(request: any, receipt: any): string {
  validateAdoption(request, true); // Proposed bindings may prepare, not report, before adoption completes.
  if (!request.phase) return receipt.branch;
  const pointer = readJSON(join(stateRoot(), "reporting", digest(request.worker.session), "phase-current.json"));
  if (pointer.id !== request.phase) throw new Error("Phase authorization superseded");
  const seen = new Set<string>();
  let id = request.phase, expectedBranch = request.branch;
  while (id) {
    if (seen.has(id)) throw new Error("Phase chain cycle");
    seen.add(id);
    const record = phaseRecord(id);
    if (record.feature !== receipt.nonce || record.receipt !== request.receipt || record.receipt_sha256 !== request.receipt_sha256 ||
        record.worker.session !== request.worker.session || record.worker.session_file !== request.worker.session_file ||
        record.cwd !== request.cwd || record.common !== request.common || record.nextBranch !== expectedBranch) throw new Error("Phase authorization mismatch");
    const branched = readJSON(join(phaseDirectory(id), "branched.json"));
    if (branched.id !== id || branched.head !== record.head || branched.branch !== record.nextBranch || branched.parent !== record.branch) throw new Error("Phase branch not verified");
    expectedBranch = record.branch;
    id = record.previousPhase;
  }
  if (expectedBranch !== receipt.branch) throw new Error("Phase does not descend from launch branch");
  return request.branch;
}
