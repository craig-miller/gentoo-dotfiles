import { test, expect } from "bun:test";
import { writeFileSync, readFileSync, existsSync, unlinkSync, chmodSync, symlinkSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fixture } from "./phase.test.ts";
import { startPhase } from "../../pi/dot-config/pi/extensions/feature-workflow/phase.ts";
import { inspectRestack, startRestack, pollRestacks, controlRestack, restackStatus } from "../../pi/dot-config/pi/extensions/feature-workflow/restack.ts";
import { restackDirectory, restackReserved, effectiveCheckpoint } from "../../pi/dot-config/pi/extensions/feature-workflow/restack-state.ts";
import { pollAttachments, readyAttachment, reportingDirectory } from "../../pi/dot-config/pi/extensions/feature-workflow/attachment.ts";
import { readJSON } from "../../pi/dot-config/pi/extensions/feature-workflow/protocol.ts";

const helper = resolve(import.meta.dir, "../../agents/dot-local/bin/feature-restack-git");
async function restackFixture(run: (f: any) => Promise<void>, shared = false) {
  await fixture(async f => {
    for (const e of [f.worker, f.coordinator]) e.capabilities.push("phase-restack-v1");
    const commit = (cwd: string, message: string) => {
      f.cmd("git", ["add", "-A"], cwd);
      f.cmd("git", ["-c", "user.name=Test", "-c", "user.email=test@invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", message], cwd);
    };
    const cwd = f.worker.cwd, repo = f.coordinator.cwd;
    writeFileSync(join(cwd, "tracked"), "one\ntwo\nthree\n");
    writeFileSync(join(cwd, "delete"), "delete me\n");
    writeFileSync(join(cwd, "guide.md"), "feature documentation\n");
    writeFileSync(join(cwd, ".gitignore"), "ignored\n");
    commit(cwd, "phase one");
    const first = f.cmd("git", ["rev-parse", "HEAD"], cwd);
    const phase = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, { ...f.input, expectedHead: first }); await f.finish();
    if (!shared) { writeFileSync(join(cwd, "second"), "phase two\n"); commit(cwd, "phase two"); }
    const pointer = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    const second = f.cmd("git", ["rev-parse", "HEAD"], cwd);
    const next = await startPhase(f.pi, f.context(f.coordinator), f.coordinator, { ...f.input, relationship: pointer.request, expectedRevision: pointer.revision, expectedHead: second, expectedParent: "feature/first", requestKey: "third", nextBranch: "feature/third" }); await f.finish();
    writeFileSync(join(cwd, "tracked"), "staged\ntwo\nthree\n"); f.cmd("git", ["add", "tracked"], cwd);
    writeFileSync(join(cwd, "tracked"), "staged\ntwo\nunstaged\n");
    writeFileSync(join(cwd, "staged-new"), "staged new\n"); f.cmd("git", ["add", "staged-new"], cwd);
    writeFileSync(join(cwd, "staged-new"), "unstaged new\n");
    unlinkSync(join(cwd, "delete"));
    writeFileSync(join(cwd, "untracked"), "new candidate\n"); chmodSync(join(cwd, "untracked"), 0o755);
    symlinkSync("tracked", join(cwd, "candidate-link"));
    writeFileSync(join(cwd, "ignored"), "do not touch ignored\n");
    writeFileSync(join(repo, "new-base"), "main advanced\n"); commit(repo, "main advanced");
    const oldExec = f.pi.exec;
    const pi = { ...f.pi, exec: async (cmd: string, args: string[], opts: any) => {
      if (cmd !== "feature-restack-git") return oldExec(cmd, args, opts);
      const r = spawnSync("python3", ["-B", helper, ...args], { encoding: "utf8", env: process.env });
      return { code: r.status, stdout: r.stdout, stderr: r.stderr };
    } };
    const live = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    const inspect = () => { f.publish(); return inspectRestack(pi, f.context(f.coordinator), f.coordinator, { relationship: live.request, expectedRevision: live.revision }); };
    const start = async () => { const i = await inspect(); const input = { ...i, requestKey: "restack-one", authorizationFile: f.input.authorizationFile }; const r = await startRestack(pi, f.context(f.coordinator), f.coordinator, input); return { r, input }; };
    const tick = async () => {
      f.publish();
      for (const e of [f.worker, f.coordinator]) {
        await pollAttachments(pi, f.context(e), e, () => true);
        await pollRestacks(pi, f.context(e), e, () => true, () => false);
      }
    };
    const ticks = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };
    const control = (id: string, action: string, extra: any = {}) => controlRestack(pi, f.context(f.coordinator), f.coordinator, { id, action, requestKey: action + "-key", expectedRevision: readJSON(join(reportingDirectory(f.worker.session), "current.json")).revision, expectedStage: restackStatus(id).stage, authorizationFile: f.input.authorizationFile, ...extra });
    await run({ ...f, pi, repo, cwd, first, second, phase, next, inspect, start, tick, ticks, control, commit });
  });
}

test("real Stax rewrites multiple phases, preserves staged/unstaged/deleted/new/symlink candidate, two-endpoint adoption without replay", async () => {
  for (const shared of [false, true]) await restackFixture(async f => {
    const before = f.cmd("git", ["diff", "--binary", "HEAD"], f.cwd);
    const index = f.cmd("git", ["diff", "--cached", "--binary"], f.cwd);
    const originalMessages = f.messages.length;
    const { r, input } = await f.start();
    expect((await startRestack(f.pi, f.context(f.coordinator), f.coordinator, input)).id).toBe(r.id);
    expect(restackReserved(f.worker.session)).toBe(true);
    await f.ticks();
    const status = restackStatus(r.id);
    expect(status.stopped).toBeUndefined(); expect(status.stage).toBe("restored");
    const dir = restackDirectory(r.id), record = readJSON(join(dir, "record.json"));
    const m = readJSON(join(dir, "mapping.json"));
    expect(m.tips["feature/first"]).not.toBe(f.first);
    expect(f.cmd("git", ["diff", "--binary", "HEAD"], f.cwd)).toBe(before);
    expect(f.cmd("git", ["diff", "--cached", "--binary"], f.cwd)).toBe(index);
    expect(readFileSync(join(f.cwd, "untracked"), "utf8")).toBe("new candidate\n");
    expect(readFileSync(join(f.cwd, "ignored"), "utf8")).toBe("do not touch ignored\n");
    await f.control(r.id, "restack-adopt"); await f.ticks();
    expect(restackStatus(r.id).stage).toBe("completed"); expect(restackReserved(f.worker.session)).toBe(false);
    const pointer = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    const bound = readyAttachment(pointer.request);
    expect(bound.adoption).toBe(r.id); expect(effectiveCheckpoint(bound, f.first)).toBe(m.tips["feature/first"]);
    for (const s of record.seals) {
      const { hash } = await import("../../pi/dot-config/pi/extensions/feature-workflow/restack-state.ts");
      expect(hash(readFileSync(s.path))).toBe(s.sha256);
    }
    expect(readFileSync(f.receipt)).toEqual(f.original); expect(f.messages.length).toBe(originalMessages);
  }, shared);
}, 30_000);

test("source drift refuses before preservation or Stax", async () => {
  await restackFixture(async f => {
    const i = await f.inspect(); writeFileSync(join(f.cwd, "untracked"), "changed");
    await expect(startRestack(f.pi, f.context(f.coordinator), f.coordinator, { ...i, requestKey: "x", authorizationFile: f.input.authorizationFile })).rejects.toThrow("drift");
  });
});

test("uncertain execution reconciles actual journal/result, never repeats Stax", async () => {
  await restackFixture(async f => {
    const { r } = await f.start(); await f.ticks(5);
    const dir = restackDirectory(r.id);
    expect(existsSync(join(dir, "executed.json"))).toBe(true);
    // Synthetic crash after Git succeeded but before result publication.
    unlinkSync(join(dir, "executed.json")); await f.tick();
    expect(restackStatus(r.id).stopped.error).toContain("uncertain");
    await f.control(r.id, "restack-recover"); await f.ticks();
    expect(restackStatus(r.id).stage).toBe("restored");
    expect(readdirSync(dir).filter((n: string) => n === "execute-claim.json")).toHaveLength(1);
  });
});

test("documentation conflict pauses, explicit continuation records changed patches and preserves candidate", async () => {
  await restackFixture(async f => {
    writeFileSync(join(f.repo, "guide.md"), "main documentation\n"); f.commit(f.repo, "conflicting documentation");
    const { r } = await f.start(); await f.ticks();
    expect(restackStatus(r.id).stopped.error).toContain("Git operation");
    writeFileSync(join(f.cwd, "guide.md"), "resolved documentation\n");
    f.cmd("git", ["add", "guide.md"], f.cwd);
    await f.control(r.id, "restack-continue"); await f.ticks();
    expect(restackStatus(r.id).stage).toBe("restored");
    const mapping = readJSON(join(restackDirectory(r.id), "mapping.json"));
    expect(mapping.changed_patches.length).toBeGreaterThan(0);
    expect(existsSync(join(f.cwd, "delete"))).toBe(false); // Original candidate deletion restored.
    await f.control(r.id, "restack-adopt"); await f.ticks();
    expect(restackStatus(r.id).stage).toBe("completed");
  });
}, 15_000);

test("missing/foreign mapping and metadata drift stop without adopting or losing the bundle", async () => {
  for (const kind of ["mapping", "ambiguous", "ref", "metadata", "bundle", "seal"]) await restackFixture(async f => {
    const { r } = await f.start(); await f.ticks(4);
    const dir = restackDirectory(r.id);
    if (kind === "mapping") writeFileSync(join(dir, "rewrite.jsonl"), "");
    if (kind === "ambiguous") {
      const journal = join(dir, "rewrite.jsonl"), bytes = readFileSync(journal, "utf8");
      const a = JSON.parse(bytes.split("\n")[0]).pairs[0].split(" ")[0];
      writeFileSync(journal, bytes + JSON.stringify({ kind: "rebase", pairs: [a + " " + a] }) + "\n");
    }
    if (kind === "ref") f.cmd("git", ["update-ref", "refs/heads/feature/first", f.first], f.cwd);
    if (kind === "bundle") writeFileSync(join(dir, "objects.pack"), "corrupt bundle");
    if (kind === "metadata") f.cmd("git", ["update-ref", "-d", "refs/branch-metadata/feature/first"], f.cwd);
    if (kind === "seal") {
      const record = readJSON(join(dir, "record.json"));
      writeFileSync(record.seals[0].path, "{}");
      await expect(f.tick()).rejects.toThrow();
      expect(existsSync(join(dir, "objects.pack"))).toBe(true); return;
    }
    await f.ticks();
    expect(restackStatus(r.id).stopped).toBeTruthy();
    expect(existsSync(join(dir, "adoption.json"))).toBe(false);
    expect(existsSync(join(dir, "objects.pack"))).toBe(true);
  });
}, 30_000);

test("reload requires exact same physical endpoints, fresh binding ACKs, and never reexecutes restack", async () => {
  await restackFixture(async f => {
    const { r } = await f.start(); await f.ticks();
    await f.control(r.id, "restack-adopt");
    const oldBinding = readJSON(join(restackDirectory(r.id), "binding.json"));
    const { randomUUID } = await import("node:crypto");
    f.worker.epoch = randomUUID(); f.coordinator.epoch = randomUUID(); f.publish();
    await f.control(r.id, "restack-renew", { workerEpoch: f.worker.epoch });
    const fresh = readJSON(join(restackDirectory(r.id), "binding.json")); expect(fresh.revision).not.toBe(oldBinding.revision);
    await f.ticks(); expect(restackStatus(r.id).stage).toBe("completed");
    const pointer = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    expect(readyAttachment(pointer.request).worker.epoch).toBe(f.worker.epoch);
    await expect(Promise.resolve().then(() => readyAttachment(oldBinding.path))).rejects.toThrow();
    expect(readdirSync(restackDirectory(r.id)).filter((n: string) => n === "execute-claim.json")).toHaveLength(1);
  });
}, 15_000);

test("reservation excludes followups/phase advancement, duplicate control is at-most-once, pre-clean cancellation is explicit", async () => {
  await restackFixture(async f => {
    const { r } = await f.start();
    const old = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    expect(() => readyAttachment(old.request)).toThrow("Restack");
    const stage = restackStatus(r.id).stage;
    const input = { id: r.id, action: "restack-cancel", requestKey: "cancel", expectedStage: stage, authorizationFile: f.input.authorizationFile };
    await controlRestack(f.pi, f.context(f.coordinator), f.coordinator, input);
    const duplicate = await controlRestack(f.pi, f.context(f.coordinator), f.coordinator, input);
    expect(duplicate.stage).toBe("cancelled"); expect(duplicate.command).toBe("settled");
    expect(restackReserved(f.worker.session)).toBe(false); readyAttachment(old.request);
    expect(readFileSync(join(f.cwd, "untracked"), "utf8")).toBe("new candidate\n");
  });
});

test("freshness gates block reservation and carry an adoption generation after completion", async () => {
  await restackFixture(async f => {
    const gate = () => {
      const result = spawnSync("python3", ["-B", resolve(dirname(helper), "feature-preflight"), "--repo", f.cwd, "--base", "main", "--stage", "inspect"], { encoding: "utf8", env: process.env });
      return JSON.parse(result.stdout);
    };
    const { r } = await f.start();
    expect(gate().blockers.some((b: string) => b.includes("adoption is incomplete"))).toBe(true);
    await f.ticks(); await f.control(r.id, "restack-adopt"); await f.ticks();
    const report = gate(); expect(report.gate).toBe("local-only");
    expect(report.checkpoint.restack_adoptions[0].id).toBe(r.id);
    expect(report.checkpoint.restack_adoptions[0].completed).toBe(true);
  });
}, 15_000);

test("second adoption chains checkpoint identities and a later phase retains the effective binding", async () => {
  await restackFixture(async f => {
    const { r } = await f.start(); await f.ticks(); await f.control(r.id, "restack-adopt"); await f.ticks();
    writeFileSync(join(f.repo, "base-again"), "another base update\n"); f.commit(f.repo, "base again");
    const old = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    const i = await inspectRestack(f.pi, f.context(f.coordinator), f.coordinator, { relationship: old.request, expectedRevision: old.revision });
    const second = await startRestack(f.pi, f.context(f.coordinator), f.coordinator, { ...i, requestKey: "second-restack", authorizationFile: f.input.authorizationFile });
    await f.ticks(); await f.control(second.id, "restack-adopt", { requestKey: "adopt-second" }); await f.ticks();
    const current = readJSON(join(reportingDirectory(f.worker.session), "current.json")), bound = readyAttachment(current.request);
    const tip = f.cmd("git", ["rev-parse", "feature/first"], f.cwd);
    expect(effectiveCheckpoint(bound, f.first)).toBe(tip);
    f.commit(f.cwd, "authorized synthetic phase candidate");
    const head = f.cmd("git", ["rev-parse", "HEAD"], f.cwd);
    await startPhase(f.pi, f.context(f.coordinator), f.coordinator, { ...f.input, relationship: current.request, expectedRevision: current.revision, expectedHead: head, expectedParent: "feature/second", requestKey: "after-restack", nextBranch: "feature/fourth" });
    await f.finish();
    const next = readJSON(join(reportingDirectory(f.worker.session), "current.json"));
    expect(readyAttachment(next.request).adoption).toBe(second.id);
  });
}, 25_000);

test("foreign endpoint, pending operations, executable hooks and unsafe local collisions are rejected", async () => {
  await restackFixture(async f => {
    const i = await f.inspect();
    await expect(startRestack(f.pi, f.context(f.coordinator), { ...f.coordinator, session: "foreign" }, { ...i, requestKey: "foreign", authorizationFile: f.input.authorizationFile })).rejects.toThrow();
    f.worker.busy = true; f.publish(); await expect(f.inspect()).rejects.toThrow("idle"); f.worker.busy = false; f.publish();
    writeFileSync(join(f.cwd, "new-base"), "must not be overwritten\n");
    await expect(f.inspect()).rejects.toThrow("collides");
    unlinkSync(join(f.cwd, "new-base"));
    const hooks = join(f.repo, ".git", "hooks", "pre-rebase"); writeFileSync(hooks, "#!/bin/sh\nexit 0\n"); chmodSync(hooks, 0o755);
    await expect(f.inspect()).rejects.toThrow("hooks");
  });
});

test("interrupted cleaning/restoration and mismatched endpoint agreement remain reserved without replay", async () => {
  for (const kind of ["clean", "restore", "ack"]) await restackFixture(async f => {
    const { r } = await f.start(); const dir = restackDirectory(r.id);
    if (kind === "clean") {
      await f.ticks(3); unlinkSync(join(dir, "cleaned.json")); await f.tick();
      expect(restackStatus(r.id).stopped.error).toContain("Cleaning was interrupted");
      await expect(f.control(r.id, "restack-recover")).rejects.toThrow("manual reconciliation");
    } else if (kind === "restore") {
      await f.ticks(); unlinkSync(join(dir, "restored.json"));
      writeFileSync(join(f.cwd, "untracked"), "external edit after partial restore\n");
      await f.tick(); expect(restackStatus(r.id).stopped.error).toContain("Interrupted restoration");
      expect(readFileSync(join(f.cwd, "untracked"), "utf8")).toBe("external edit after partial restore\n");
    } else {
      await f.ticks(); await f.control(r.id, "restack-adopt");
      const binding = readJSON(join(dir, "binding.json"));
      for (const e of [f.worker, f.coordinator]) await pollAttachments(f.pi, f.context(e), e, () => true);
      const path = join(dirname(binding.path), "prepared-coordinator.json"), ack = readJSON(path); ack.adoption_sha256 = "wrong"; writeFileSync(path, JSON.stringify(ack));
      await f.ticks(); expect(restackStatus(r.id).stopped.error).toContain("acknowledgement rejected");
      expect(existsSync(join(dir, "completed.json"))).toBe(false);
    }
    expect(restackReserved(f.worker.session)).toBe(true);
  });
}, 25_000);
