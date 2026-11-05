# Feature stack freshness, synchronization and launch diagnostics

## Read-only gates

`feature-preflight` performs local Git inspection only: no fetch, checkout, commit, stash, reset, metadata repair, rebase, push or cleanup. Supply the exact worktree root and an explicit integration base when not `main`:

```sh
feature-preflight --repo /exact/feature/worktree --base main --branch feature/example --stage inspect
```

The selected branch must occupy that worktree. Stax parent metadata must reach the requested base. The checker includes the whole connected feature stack, bottom-up, including descendants/sibling forks above the same first branch, not just the current intermediate level. Unknown/corrupt metadata, cycles, missing parents and identity drift fail closed. Unrelated independent stacks are excluded from the feature checkpoint.

Each level records its tip, parent tip, saved Stax parent revision and metadata object ID, plus actual base/parent ancestry. An advanced base already included in every level is not stale merely because saved parent metadata is old. Missing history in any level blocks the gate. Worktree status/content fingerprints include staged, unstaged and nonignored untracked progress; in-progress Git operations block. Dirty progress is reported, not discarded: it does not itself prohibit reviewing an uncommitted candidate, but blocks restacking until a separately coordinated clean checkpoint.

Output includes exact base/stack commits, cached upstream identity/relation, blockers, `approval: false` and `mutation_authorized: false`. Exit 1 blocks the gate. `inspect` can report `local-only`; that is not remote freshness or readiness for live testing/review. The checker reads twice to detect concurrent identity/ref/content changes. This is point-in-time evidence, not a lock against future Git changes.

## Explicit remote synchronization

Obtain authorization and coordinate with owners of the integration worktree and feature stack. Inspect the configured upstream remote, resolved URL, merge ref and tracking ref; do not assume `origin/main`. If missing/ambiguous, ask for a decision. Check source/integration worktree identity, cleanliness, current branch and pending Git operations.

With that authorization, fetch the configured remote explicitly, then update the integration branch **only by fast-forward** in its existing clean owning worktree. For example, after checking the exact names:

```sh
git -C /integration/worktree fetch --no-tags REMOTE
git -C /integration/worktree merge --ff-only refs/remotes/REMOTE/BRANCH
```

These are coordinated operations, not commands the preflight runs. Do not switch a feature worktree to the integration branch or introduce a new worktree implicitly. If local integration history is already ahead and contains upstream, retain it; do not reset to remote. Divergence or non-fast-forward failure stops for a decision. Avoid broad `stax sync`/`refresh` shortcuts with extra cleanup, stash, restack or publication side effects.

After successful authorized execution and verifying the resulting refs, retain verbatim authorization and execution output separately. Write a private synchronization evidence JSON outside the candidate's nonignored files:

```json
{
  "outcome": "fetch-and-ff-verified",
  "common": "/repository/.git",
  "remote": "origin",
  "url": "CONFIGURED_RESOLVED_REMOTE_URL",
  "merge_ref": "refs/heads/main",
  "upstream": "refs/remotes/origin/main",
  "head": "EXACT_FETCHED_UPSTREAM_COMMIT",
  "fetched_at": "UTC_ISO_TIMESTAMP_WITH_OFFSET",
  "authorization": "Verbatim authorization/execution evidence reference"
}
```

This is caller execution evidence, **not independently proven network activity**. Never manufacture it from cached refs or an old `FETCH_HEAD`. The checker requires matching common directory, remote/URL/source/tracking ref and commit, an equal/local-ahead integration branch, and a timezone-aware timestamp no older than 15 minutes (future timestamps fail). This bounded freshness window is not a guarantee the remote cannot advance; re-synchronize explicitly before the next gate as needed. It never grants permission to fetch automatically.

## Live acceptance and review

After synchronization and any separately authorized restack/conflict resolution/automated revalidation:

```sh
feature-preflight --repo /exact/feature/worktree --base main --stage live \
  --sync-evidence /private/sync.json > /private/live-checkpoint.json
```

Require exit 0 and `gate: ready`, then obtain the separate live-test permission and human acceptance (or narrow explicit waiver). The checkpoint is a record of the candidate tested, **not human acceptance itself**. Keep the checkpoint and verbatim acceptance/waiver evidence separately. Saving checkpoint files inside nonignored candidate content invalidates their own content fingerprint; use private state or a deliberately ignored evidence directory.

Before review, synchronize/check again and compare against the accepted checkpoint:

```sh
feature-preflight --repo /exact/feature/worktree --base main --stage review \
  --sync-evidence /private/current-sync.json \
  --accepted-checkpoint /private/live-checkpoint.json
```

Changes to base, stack, metadata, worktree identity or dirty content require automated and affected live revalidation, then a new checkpoint/acceptance cycle. No automatic restack or acceptance is inferred.

For an explicitly feature-scoped `feature_review open`, supply normal repo/base/paths/requestKey plus:

```json
{
  "featureCheckpoint": "/private/live-checkpoint.json",
  "syncEvidence": "/private/current-sync.json"
}
```

Both fields are required together. Their canonical paths/hashes join the immutable request identity. The hook calls the read-only gate before snapshot creation and again immediately before launch; stale evidence blocks without opening a review. `feature_review verify` checks freshness as well as frozen snapshot/source identity before allowing an approval request. If synchronization evidence ages out during a long review, separately authorize synchronization and pass a new `syncEvidence` path to `verify`; the original accepted checkpoint hash remains pinned, and no review is relaunched. Changed source/base still requires revalidation/review. Never replace evidence or change keys to replay an uncertain launch.

**Enforcement boundary:** ordinary document reviews without these explicit fields retain their existing behavior. The generic review tool currently has no verified feature/reporting binding that can make omission impossible; policy requires coordinators to supply the fields for feature reviews. Repository contents or branch naming are not a safe substitute. The existing global-focus limitation of the review launcher is unchanged: passing freshness checks does not authorize use in live clients.

Installation must include `feature-preflight` and the complete review extension (including `freshness.ts`), with separately authorized safe loading/reload. Candidate files do not update running endpoints.

## Restack and phase seals

Pause active implementation and preserve uncommitted work. Agree the whole stack and its clean checkpoint before authorizing bottom-up Stax restacking. Inspect installed Stax help; do not use automatic stash/pop, submission or cleanup switches implicitly. Resolve conflicts and rerun automated checks, live acceptance/affected checks and review of rewritten checkpoints. A phase-record HEAD/ancestry mismatch is a blocker: current phase renewal does not authorize rewriting immutable records or adopting a restacked history. Preserve receipts/transcripts and request explicit supported recovery work rather than weakening checks.

## Launch diagnostics and maintenance

Launch admission still checks the selected local base and repository safety. It now preserves **stdout, stderr and exit status** instead of letting a Stax update notice hide validation output. Only the recognized restack-only warning, with independently valid metadata and branches outside the launch base's ancestor chain, is advisory. Unknown nonzero exits, metadata failures, extra diagnostics, or warnings affecting the launch base/ancestors remain blockers. It does not blindly ignore failed validation or infer remote freshness.

The popup surfaces an unrelated-stack warning before the form; Enter acknowledges it, Escape cancels. Long diagnostic pages can be scrolled with arrows/PageUp/PageDown. Coordinator-started launch receipts retain preflight diagnostics and the exact base checkpoint. Upstream self-upgrade suggestions are replaced in displayed diagnostics by installation-aware advice. On Gentoo use the ebuild/Portage maintenance workflow, not `stax update`; no automatic upgrade is performed.

## Release publication and closeout

After separately approved integration, the expected publication step is an explicitly approved **non-force push of the integration branch** to the intended remote, followed by read-back verification of its exact tip. A rejected push stops for reconciliation. Integration is not publication; if pushing is deferred, record it and do not claim teammates have the integrated commit. This policy does not authorize any current push.

Before cleanup, inventory owned runtime/test resources and configuration dependencies, including directory and per-file links, frozen candidates, rollback backups, processes and retained receipts/transcripts. Record exact identities, dependencies, state and authorized disposition. Phase completion is not feature release, and uncertainty blocks cleanup. Never discard evidence merely because a test or phase settled.
