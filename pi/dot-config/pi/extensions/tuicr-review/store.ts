import { mkdirSync, writeFileSync, readFileSync, renameSync, readdirSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { stateRoot, herdrInstance, sameInstance } from "../feature-workflow/protocol.ts";
import type { Snapshot } from "./snapshot.ts";
import type { Freshness } from "./freshness.ts";

export { herdrInstance, sameInstance };
export type Owner = { session: string; sessionFile: string; pane: string; tab: string; workspace: string; instance: ReturnType<typeof herdrInstance> };
export type Manifest = { version: 1; id: string; created: string; requestKey: string; requestHash: string; owner: Owner; snapshot: Snapshot; freshness?: Freshness; featureBase?: string };
export const root = () => join(stateRoot(), "reviews");
export function privateDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077)) throw Error(`Review state must be a private directory: ${path}`);
}
export function directory(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw Error("Invalid review UUID.");
  return join(root(), id);
}
export const read = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
export const optional = (path: string): any => existsSync(path) ? read(path) : undefined;
export function atomic(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}
export function claim(path: string, value: unknown) {
  try { writeFileSync(path, JSON.stringify(value), { mode: 0o600, flag: "wx" }); return true; }
  catch (e: any) { if (e.code === "EEXIST") return false; throw e; }
}
export function manifests(): Manifest[] {
  if (!existsSync(root())) return [];
  return readdirSync(root()).flatMap(id => {
    if (!/^[0-9a-f-]{36}$/.test(id)) return [];
    const m = optional(join(directory(id), "manifest.json"));
    return m?.version === 1 && m.id === id ? [m] : [];
  });
}
export function sameOwner(a: Owner, b: Owner) {
  return sameInstance(a.instance, b.instance) && ["session", "sessionFile", "pane", "tab", "workspace"].every(k => (a as any)[k] === (b as any)[k]);
}
export function status(id: string) {
  const dir = directory(id), manifest: Manifest | undefined = optional(join(dir, "manifest.json"));
  const launch = optional(join(dir, "launch.json")), completion = optional(join(dir, "completion.json"));
  const delivery = optional(join(dir, "delivery.json")), session = optional(join(dir, "session.json"));
  const started = optional(join(dir, "started.json"));
  return { id, identity: manifest?.snapshot.identity, fileCount: manifest?.snapshot.fileCount,
    state: completion?.state ?? (started ? "running" : launch?.state ?? "preparing"), lastKnown: !completion,
    observation: completion ? "terminal receipt" : "last-known launch/runner receipt, not proof the UI is still alive",
    launch, completion,
    progress: { reviewed: completion?.reviewed ?? session?.reviewed_count ?? null, total: manifest?.snapshot.fileCount ?? null },
    session: session ? { slug: session.slug, path: session.path } : null,
    delivery: delivery ?? { state: existsSync(join(dir, "delivery.claim")) ? "uncertain" : "pending" },
    approval: false, directory: dir };
}
