// Read-only restack evidence shared by admission, reporting and phase readers.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readJSON, stateRoot } from "./protocol.ts";

export const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export function restackDirectory(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid restack ID");
  return join(stateRoot(), "restacks", id);
}
export const restackPointer = (session: string) => join(stateRoot(), "reporting", hash(session), "restack-current.json");
export function restackRecord(id: string) {
  const dir = restackDirectory(id), bytes = readFileSync(join(dir, "record.json"));
  if (readJSON(join(dir, "seal.json")).sha256 !== hash(bytes)) throw Error("Restack operation seal changed");
  const r = JSON.parse(bytes.toString());
  if (r.version !== 1 || r.id !== id || hash(readFileSync(r.receipt)) !== r.receipt_sha256) throw Error("Restack/launch identity changed");
  if (hash(readFileSync(r.relationship)) !== r.relationship_sha256) throw Error("Original reporting relationship changed");
  for (const s of r.seals) if (hash(readFileSync(s.path)) !== s.sha256) throw Error("Original phase evidence changed");
  return r;
}
export function currentRestack(session: string): any | undefined {
  const path = restackPointer(session);
  return existsSync(path) ? restackRecord(readJSON(path).id) : undefined;
}
export function restackReserved(session: string) {
  const r = currentRestack(session);
  return !!r && !existsSync(join(restackDirectory(r.id), "completed.json")) && !existsSync(join(restackDirectory(r.id), "cancelled.json"));
}
export function assertNotRestacking(session: string) {
  if (restackReserved(session)) throw Error("Restack reserved/pending; use its correlated status/recovery, not phase/follow-up/renewal");
}
export function adoption(r: any) {
  const dir = restackDirectory(r.id), bytes = readFileSync(join(dir, "adoption.json"));
  if (readJSON(join(dir, "adoption-seal.json")).sha256 !== hash(bytes)) throw Error("Adoption seal changed");
  const a = JSON.parse(bytes.toString());
  if (a.id !== r.id || a.record_sha256 !== hash(readFileSync(join(dir, "record.json"))) || a.mapping_sha256 !== hash(readFileSync(join(dir, "mapping.json"))) || a.restored_sha256 !== hash(readFileSync(join(dir, "restored.json")))) throw Error("Adoption evidence changed");
  return a;
}
export function validateAdoption(request: any, pending = false) {
  const latest = currentRestack(request.worker.session);
  if (!latest) { if (request.adoption) throw Error("Unknown adoption"); return; }
  if (existsSync(join(restackDirectory(latest.id), "cancelled.json"))) return;
  // During reservation only the exact proposed binding can be prepared. Old
  // reporting is paused; no ordinary reader silently adopts pending state.
  if (request.adoption !== latest.id) throw Error("Restack adoption reporting mismatch");
  const seen = new Set<string>(); let r = latest;
  while (r) {
    if (seen.has(r.id)) throw Error("Adoption chain cycle"); seen.add(r.id);
    const a = adoption(r);
    if (r.id === latest.id && request.adoption_sha256 !== hash(readFileSync(join(restackDirectory(r.id), "adoption.json")))) throw Error("Reporting does not pin the adoption digest");
    if (r.feature !== request.feature || r.common !== request.common || r.cwd !== request.cwd || r.worker.session !== request.worker.session || r.worker.session_file !== request.worker.session_file || r.receipt !== request.receipt || r.receipt_sha256 !== request.receipt_sha256 || a.branch !== request.branch && r.id === latest.id && request.phase === r.phase) throw Error("Adoption relationship mismatch");
    const done = join(restackDirectory(r.id), "completed.json");
    if (!pending || r.id !== latest.id) {
      if (!existsSync(done)) throw Error("Restack activation incomplete");
      const completed = readJSON(done);
      if (completed.id !== r.id || completed.adoption_sha256 !== hash(readFileSync(join(restackDirectory(r.id), "adoption.json")))) throw Error("Restack completion evidence changed");
    }
    r = r.previousAdoption ? restackRecord(r.previousAdoption) : undefined;
  }
}
export function effectiveCheckpoint(request: any, original: string) {
  validateAdoption(request);
  const chain: any[] = []; let r = request.adoption ? restackRecord(request.adoption) : undefined;
  while (r) { chain.unshift(r); r = r.previousAdoption ? restackRecord(r.previousAdoption) : undefined; }
  let head = original;
  for (const item of chain) {
    const a = adoption(item);
    head = a.checkpoints[head] ?? head;
  }
  return head;
}
