import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export type Image = { mode: string; hash: string; bytes: number } | null;
export type FileImage = { path: string; before: Image; after: Image };
export type Snapshot = { source: string; common: string; head: string; base: string; files: FileImage[]; identity: string; baseCommit: string; tree: string; fileCount: number };
type Content = { mode: string; data: Buffer } | null;
export function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_OPTIONAL_LOCKS: "0",
    GIT_AUTHOR_NAME: "Frozen review", GIT_AUTHOR_EMAIL: "review@localhost", GIT_COMMITTER_NAME: "Frozen review", GIT_COMMITTER_EMAIL: "review@localhost",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
}
export function git(root: string, args: string[], input?: Buffer | string): Buffer {
  return execFileSync("git", ["--no-optional-locks", "-C", root, "-c", "core.fsmonitor=false", ...args],
    { env: gitEnv(), input, timeout: 10000, maxBuffer: 40 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}
const text = (root: string, args: string[]) => git(root, args).toString().trim();
export function validatePaths(paths: string[]) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 128) throw Error("Select 1–128 explicit repository-relative file paths (no directories/globs).");
  const sorted = [...paths].sort();
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (typeof p !== "string" || !p || isAbsolute(p) || /[\x00-\x1f\x7f\\]/.test(p) || p.split("/").some(c => !c || c === "." || c === ".." || c.toLowerCase() === ".git" || c === ".gitattributes"))
      throw Error(`Unsafe/unsupported path: ${JSON.stringify(p)}`);
    if (sorted[i - 1] === p || sorted.some(q => q !== p && p.startsWith(q + "/"))) throw Error("Duplicate or overlapping file scope.");
  }
  return sorted;
}
function checkText(data: Buffer, path: string) {
  if (data.length > 2 * 1024 * 1024 || data.includes(0)) throw Error(`Binary or oversized file unsupported: ${path}`);
  try { new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { throw Error(`Non-UTF-8 file unsupported: ${path}`); }
}
export function workingFile(root: string, path: string): Content {
  // Pin every ancestor using directory descriptors. O_NOFOLLOW on the final
  // component alone cannot prevent an ancestor-symlink race exposing other files.
  if (process.platform !== "linux") throw Error("Safe snapshot capture currently requires Linux /proc directory descriptors.");
  const parts = path.split("/"), full = join(root, path), handles: number[] = [];
  try {
    let parent = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(parent);
    for (const component of parts.slice(0, -1)) {
      parent = openSync(`/proc/self/fd/${parent}/${component}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(parent);
      if (existsSync(`/proc/self/fd/${parent}/.git`)) throw Error(`Nested repository/submodule path unsupported: ${path}`);
    }
    const fd = openSync(`/proc/self/fd/${parent}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); handles.push(fd);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 2 * 1024 * 1024) throw Error(`Only regular UTF-8 files up to 2 MiB supported: ${path}`);
    const data = readFileSync(fd), after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || realpathSync(full) !== full) throw Error(`File changed while reading: ${path}`);
    checkText(data, path);
    return { mode: before.mode & 0o111 ? "100755" : "100644", data };
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally { for (const fd of handles.reverse()) closeSync(fd); }
}
function baseFile(root: string, base: string, path: string): Content {
  const entry = git(root, ["ls-tree", "-z", base, "--", `:(literal)${path}`]).toString();
  if (!entry) return null;
  const match = /^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(entry);
  if (!match || match[3] !== path) throw Error(`Unsupported base entry (symlink, directory, submodule): ${path}`);
  const data = git(root, ["cat-file", "blob", match[2]]); checkText(data, path);
  return { mode: match[1], data };
}
const image = (c: Content): Image => c && ({ mode: c.mode, hash: digest(c.data), bytes: c.data.length });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function indexFile(root: string, path: string, c: Content) {
  if (!c) { git(root, ["update-index", "--force-remove", "--", path]); return; }
  const oid = git(root, ["hash-object", "-w", "--stdin"], c.data).toString().trim();
  git(root, ["update-index", "--add", "--cacheinfo", c.mode, oid, path]);
}
export function createSnapshot(source: string, baseRef: string, paths: string[], destination: string, signal?: AbortSignal): Snapshot {
  source = realpathSync(source);
  if (text(source, ["rev-parse", "--show-toplevel"]) !== source) throw Error("repo must be the exact Git worktree root.");
  if (!baseRef || baseRef.startsWith("-") || /[\x00-\x20]/.test(baseRef)) throw Error("An explicit local base commit/ref is required.");
  const base = text(source, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  const head = text(source, ["rev-parse", "HEAD"]);
  const common = realpathSync(text(source, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  let bytes = 0;
  const contents = validatePaths(paths).map(path => {
    signal?.throwIfAborted();
    const before = baseFile(source, base, path), after = workingFile(source, path);
    bytes += (before?.data.length ?? 0) + (after?.data.length ?? 0);
    if (bytes > 32 * 1024 * 1024) throw Error("Scope exceeds 32 MiB.");
    return { path, before, after };
  });
  const files = contents.map(f => ({ path: f.path, before: image(f.before), after: image(f.after) }));
  if (files.some(f => equal(f.before, f.after))) throw Error("Every selected path must differ from base; remove unchanged/missing paths.");
  // A second pass detects ordinary concurrent writes. This is not a filesystem transaction;
  // callers must quiesce scoped writers and verify again before commit approval.
  if (head !== text(source, ["rev-parse", "HEAD"]) || contents.some(f => !equal(image(f.after), image(workingFile(source, f.path))))) throw Error("Source changed during snapshot capture; retry with writers idle.");
  mkdirSync(destination, { mode: 0o700 });
  git(destination, ["init", "--quiet", "--template=", "--initial-branch=review"]);
  for (const [key, value] of Object.entries({ "core.hooksPath": "/dev/null", "core.autocrlf": "false", "core.fileMode": "true", "diff.renames": "false", "core.attributesFile": "/dev/null" })) git(destination, ["config", key, value]);
  for (const f of contents) indexFile(destination, f.path, f.before);
  const baseTree = text(destination, ["write-tree"]);
  const baseCommit = git(destination, ["commit-tree", baseTree], "Frozen scoped baseline\n").toString().trim();
  git(destination, ["update-ref", "refs/heads/review", baseCommit]);
  for (const f of contents) {
    signal?.throwIfAborted(); indexFile(destination, f.path, f.after);
    if (f.after) { const full = join(destination, f.path); mkdirSync(dirname(full), { recursive: true, mode: 0o700 }); writeFileSync(full, f.after.data, { mode: 0o600 }); chmodSync(full, f.after.mode === "100755" ? 0o700 : 0o600); }
  }
  const tree = text(destination, ["write-tree"]);
  const identity = digest(JSON.stringify({ base, files, baseCommit, tree }));
  return { source, common, head, base, files, identity, baseCommit, tree, fileCount: files.length };
}
export function verifySnapshot(snapshot: Snapshot, frozen: string) {
  const drift: string[] = [];
  try {
    if (text(snapshot.source, ["rev-parse", "HEAD"]) !== snapshot.head) drift.push("HEAD");
    if (realpathSync(text(snapshot.source, ["rev-parse", "--path-format=absolute", "--git-common-dir"])) !== snapshot.common) drift.push("repository identity");
    for (const f of snapshot.files) if (!equal(image(workingFile(snapshot.source, f.path)), f.after)) drift.push(f.path);
  } catch (e) { drift.push(String(e)); }
  let intact = true;
  try {
    intact = text(frozen, ["rev-parse", "HEAD"]) === snapshot.baseCommit && text(frozen, ["write-tree"]) === snapshot.tree &&
      git(frozen, ["ls-files", "--others", "-z"]).length === 0 &&
      snapshot.files.every(f => equal(image(workingFile(frozen, f.path)), f.after)) &&
      digest(JSON.stringify({ base: snapshot.base, files: snapshot.files, baseCommit: snapshot.baseCommit, tree: snapshot.tree })) === snapshot.identity;
  } catch { intact = false; }
  return { sourceMatches: drift.length === 0, snapshotIntact: intact, drift, checkedAt: new Date().toISOString(), approval: false };
}
