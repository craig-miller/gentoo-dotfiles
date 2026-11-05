# Review-tool validation

From the feature worktree:

```sh
bun test ./.tests/tuicr-review/
NODE_PATH=/home/craig/.bun/install/global/node_modules bun .tests/tuicr-review/typecheck.ts
python3 -B .tests/tuicr-review/native_smoke.py
```

`typecheck.ts` resolves the installed Pi/TypeBox declarations and the `tsc`
executable. No package installation or live configuration changes are needed.

- 12 unit/integration cases exercise real isolated Git snapshots plus mocked
  Herdr/Pi boundaries: source/index preservation; new/deleted/renamed/executable
  files; unsafe paths, binary and symlink/nested-repository rejection; source and
  frozen-snapshot drift; duplicate/concurrent launches and overlap guards;
  busy/UI delivery, persisted-vs-API acknowledgement, uncertain crash/reload,
  fork/replaced-origin/server exclusion, cancellation, owned close requests, and
  completed-zero-comment versus incomplete/failed review.
- Six additional return-focus cases cover the exact pinned origin with intervening
  tabs; observed navigation during validation; missing/replaced/moved origins,
  session headers and servers; review ownership and post-focus moves; validation
  expiry; uncertain acknowledgement without retries. A deterministic race test
  demonstrates that navigation **after** the final check can still lose focus:
  the current Herdr API cannot provide an atomic guarantee.
- `native_smoke.py` uses a **private named Herdr server**, a PTY (no desktop
  window), private HOME/config/data/state, disabled sounds/toasts and the existing
  deterministic offline Pi test provider. It explicitly loads the candidate and
  reads the installed Herdr Pi reporting extension without modifying it. Inputs
  and synthetic comments go only to its own disposable applications/store.
- Native coverage: tool exposure in Pi's real model context; `/review` opening
  the shared lifecycle; frozen selected-only diff; all-reviewed/no-comments;
  a real completion-triggered Pi turn; reload during review; busy queuing;
  comment capture; focused return to the original tab across an intervening tab;
  preserved focus after prior navigation; moved-review refusal; closed-origin
  refusal; owned self-close;
  incomplete `:q` versus cancelled tab; no completed-report replay; additions,
  deletions, mode-only changes and explicit rename pairs; source/index unchanged.

Fixtures/failure evidence stay under ignored `.tmp/`; only these private servers
are stopped. The Linux `/proc/<test-pid>/fd` directory alias avoids AF_UNIX's
108-byte socket-path limit while retaining **all test files inside the worktree**.
Unit fixtures are removed at test end. No live installation, provider calls,
user-server controls, source-checkout edits or feature cleanup are performed.

There are 20 review-tool tests plus seven existing native review scenarios. Two
opt-in freshness-gate cases cover blocking before snapshot/launch, pinned evidence,
changed-base refusal during verification and explicit renewed synchronization
without reopening. Generic reviews remain unchanged. These new boundary cases
use mocked Herdr/checker results; this supplement did not open a native review.
The combined candidate also passes 52 feature-workflow Bun tests. Human-facing
acceptance and review remain coordinator-managed, with separate authorization
for live installation/reload and any commit/integration/push/feature cleanup.
