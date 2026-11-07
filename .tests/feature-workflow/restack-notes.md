# Phased-stack restack/adoption candidate

Implementation approval followed the separately prepared generic brief/context and design discussion. This is direct dotfiles/sysadmin work, not a new product coordinator/worker assignment. No active incident repository, feature ref/receipt, agent or provider was used. No installation, reload, commit, fetch, push or cleanup of retained workflow resources was performed.

## Implementation

- `feature_phase` / `/feature-phase` gains explicit `restack-*` actions using existing enrolled endpoints, inbox polling, reservation guards and reporting prepare/active acknowledgements.
- `feature-restack-git` is the bounded Python Git/Stax executor. It archives original and rewritten objects outside GC reach; preserves index/working trees separately and nonignored untracked bytes, modes and symlink targets; performs no stash or preservation commit. It records exclusive cleaning/execution/continuation/restoration claims and verifies actual Git rewrite-journal mapping plus full topology/metadata.
- `restack-state.ts` verifies sealed append-only adoption chains and resolves original checkpoint identities without modifying phase/launch/review records. Reporting pins the adoption digest and both endpoint ACKs include it. Pending reservations block reporting, follow-ups, phase advancement and worker input/tools/session replacement.
- `feature-preflight` binds explicit operation generations into acceptance checkpoints, blocking incomplete adoption and invalidating earlier acceptance after adoption. It still performs no network mutation and requires separate synchronization evidence for live/review gates.
- Documentation: `references/restack.md` gives the exact interface, rollout and recovery boundaries.

## Evidence and limits

Executed real Git **2.54.0** and Stax **0.118.1** in synthetic disposable repositories; endpoint and Pi/Herdr responses are fake test fixtures. No native running Pi/Herdr endpoint activation or real-feature recovery has been exercised.

Coverage includes multiple phases/shared tips; staged/unstaged modifications and new tracked files; tracked deletions; new executable and symlink files; ignored-file preservation; real Stax clean restacking and an explicitly resolved documentation conflict; original seal/receipt preservation; exact candidate restoration; invalid/missing rewrite evidence and metadata drift; foreign/busy endpoints and source drift; unsupported executable hooks and local-data collisions; at-most-once duplicate start/control; uncertain execution reconciliation; interrupted cleaning/restoration stops; mismatched adoption ACKs; same-session epoch renewal before activation; two successive adoptions and a subsequent ordinary phase; and freshness blocking/generation binding.

Stax conflict behavior was established by actual testing: `stax restack --continue` completes the paused branch but does **not** resume the original full-stack traversal or return to its original tip. The executor therefore records a separate suffix claim for `stax upstack restack`, then a separate return-checkout claim. It does not rerun the original uncertain `--all` command. Conflicts in that suffix pause again.

Fault cases are representative transition injections, not proof of every OS/power-loss interleaving. Automatic recovery deliberately stops for partial cleaning/restoration that cannot be exactly reconciled, incomplete archive/adoption-seal publication, and uncertain suffix/checkout outcomes without a complete provable result. No automatic reset/abort/pop/backup deletion. Executable hooks, non-linear stacks, other selected worktrees, merges, sparse/index extensions, submodules and special files are rejected rather than guessed around. Installation and live acceptance/recovery require separate coordination.

Validation commands:

```sh
python3 -B -m unittest discover -s .tests/feature-workflow -p 'test_*.py'
bun test ./.tests/feature-workflow/*.test.ts
bun test ./.tests/tuicr-review/*.test.ts
NODE_PATH=/home/craig/.bun/install/global/node_modules bun .tests/feature-workflow/typecheck.ts
NODE_PATH=/home/craig/.bun/install/global/node_modules bun .tests/tuicr-review/typecheck.ts
git diff --check
```

Current automated suite: 62 Python workflow tests, 63 Bun workflow tests (11 new restack cases, several containing fault matrices), and 20 Bun review regressions: **145 total**. Logs used during development: `/tmp/restack-final-bun.log`, `/tmp/restack-python.log`, `/tmp/restack-review.log`. Existing temporary test repositories are fixture-owned and disposable; no real feature resources were cleaned.
