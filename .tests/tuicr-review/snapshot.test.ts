import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, chmodSync, symlinkSync, unlinkSync, renameSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSnapshot, git, verifySnapshot, validatePaths } from "../../pi/dot-config/pi/extensions/tuicr-review/snapshot.ts";

export function fixture() {
  const parent = resolve(import.meta.dir, ".tmp"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "snapshot-")), source = join(root, "source"); mkdirSync(source);
  git(source, ["init", "-q", "--template=", "--initial-branch=main"]);
  writeFileSync(join(source, "chosen.txt"), "baseline\n"); writeFileSync(join(source, "unrelated.txt"), "private baseline\n");
  git(source, ["add", "."]); git(source, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"]);
  writeFileSync(join(source, "chosen.txt"), "selected edit\n"); writeFileSync(join(source, "unrelated.txt"), "UNRELATED SECRET\n");
  git(source, ["add", "unrelated.txt"]); writeFileSync(join(source, "untracked.txt"), "UNTRACKED SECRET\n");
  const frozen = join(root, "snapshot");
  return { root, source, frozen, cleanup: () => rmSync(root, { recursive: true }) };
}

test("selected modified/new/deleted/mode/rename files only; source index/worktree unchanged", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.source, "new file.txt"), "new text\n"); chmodSync(join(f.source, "chosen.txt"), 0o755);
    const index = readFileSync(join(f.source, ".git/index"));
    const beforeStatus = git(f.source, ["status", "--porcelain=v1", "-uall"]);
    const snapshot = createSnapshot(f.source, "HEAD", ["chosen.txt", "new file.txt"], f.frozen);
    expect(snapshot.fileCount).toBe(2); expect(snapshot.files[0].after?.mode).toBe("100755");
    expect(git(f.frozen, ["ls-tree", "-r", "--name-only", "HEAD"]).toString()).toBe("chosen.txt\n");
    expect(git(f.frozen, ["ls-files"]).toString()).toBe("chosen.txt\nnew file.txt\n");
    expect(existsSync(join(f.frozen, "unrelated.txt"))).toBe(false);
    expect(readFileSync(join(f.source, ".git/index"))).toEqual(index);
    expect(git(f.source, ["status", "--porcelain=v1", "-uall"])).toEqual(beforeStatus);
    expect(verifySnapshot(snapshot, f.frozen)).toMatchObject({ sourceMatches: true, snapshotIntact: true });
    writeFileSync(join(f.source, "unrelated.txt"), "different unrelated bytes\n");
    expect(verifySnapshot(snapshot, f.frozen).sourceMatches).toBe(true);
    writeFileSync(join(f.source, "chosen.txt"), "drift\n");
    expect(verifySnapshot(snapshot, f.frozen)).toMatchObject({ sourceMatches: false, drift: ["chosen.txt"] });
    writeFileSync(join(f.frozen, "chosen.txt"), "tampered\n");
    expect(verifySnapshot(snapshot, f.frozen).snapshotIntact).toBe(false);
  } finally { f.cleanup(); }
  const d = fixture();
  try {
    renameSync(join(d.source, "chosen.txt"), join(d.source, "renamed.txt"));
    const snapshot = createSnapshot(d.source, "HEAD", ["chosen.txt", "renamed.txt"], d.frozen);
    expect(snapshot.files[0].after).toBeNull(); expect(snapshot.files[1].before).toBeNull();
    expect(verifySnapshot(snapshot, d.frozen)).toMatchObject({ sourceMatches: true, snapshotIntact: true });
  } finally { d.cleanup(); }
});

test("unsafe scope, directories, binary, invalid UTF8, symlink, ancestor symlink rejected", () => {
  for (const paths of [[], ["../secret"], ["/abs"], ["a/../b"], ["a//b"], [".git/config"], ["a/.gitattributes"], ["a", "a"], ["a", "a/b"], ["a\nb"]]) expect(() => validatePaths(paths)).toThrow();
  for (const kind of ["binary", "utf8", "symlink", "parent", "directory", "unchanged", "base-symlink", "nested-repo"]) {
    const f = fixture();
    try {
      let path = "chosen.txt";
      if (kind === "binary") writeFileSync(join(f.source, path), Buffer.from([0, 1]));
      if (kind === "utf8") writeFileSync(join(f.source, path), Buffer.from([0xff]));
      if (kind === "symlink") { unlinkSync(join(f.source, path)); symlinkSync("unrelated.txt", join(f.source, path)); }
      if (kind === "parent") { symlinkSync(f.root, join(f.source, "link")); path = "link/outside.txt"; }
      if (kind === "directory") { path = "directory"; mkdirSync(join(f.source, path)); }
      if (kind === "nested-repo") { mkdirSync(join(f.source, "nested")); git(join(f.source, "nested"), ["init", "-q", "--template="]); path = "nested/file"; writeFileSync(join(f.source, path), "nested contents"); }
      if (kind === "unchanged") writeFileSync(join(f.source, path), "baseline\n");
      if (kind === "base-symlink") { symlinkSync("unrelated.txt", join(f.source, "link")); git(f.source, ["add", "link"]); git(f.source, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "link"]); unlinkSync(join(f.source, "link")); path = "link"; }
      expect(() => createSnapshot(f.source, "HEAD", [path], f.frozen)).toThrow();
    } finally { f.cleanup(); }
  }
});

test("source HEAD change, executable mode drift, and isolated index tampering are detected", () => {
  const f = fixture();
  try {
    const m = createSnapshot(f.source, "HEAD", ["chosen.txt"], f.frozen);
    chmodSync(join(f.source, "chosen.txt"), 0o755); expect(verifySnapshot(m, f.frozen).drift).toContain("chosen.txt");
    chmodSync(join(f.source, "chosen.txt"), 0o644);
    git(f.source, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "unrelated staged"]);
    expect(verifySnapshot(m, f.frozen).drift).toContain("HEAD");
    writeFileSync(join(f.frozen, "unexpected"), "not reviewed"); expect(verifySnapshot(m, f.frozen).snapshotIntact).toBe(false);
    unlinkSync(join(f.frozen, "unexpected"));
    git(f.frozen, ["read-tree", "HEAD"]); expect(verifySnapshot(m, f.frozen).snapshotIntact).toBe(false);
  } finally { f.cleanup(); }
});
