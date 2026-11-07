# Explicit phased-stack restack and checkpoint adoption

This extends `feature_phase` and `/feature-phase JSON`; it is not reporting renewal or a second feature launch. Both existing endpoints must advertise `phase-restack-v1`. Installation, idle endpoint reloads, reporting renewal and recovery of any real paused feature require separate approval. Do not use a product repository as a tooling test fixture.

## First-version boundary

Supported: completed same-session phase transitions; a complete linear Stax feature stack in one unchanged worker/worktree, including shared/empty tips; staged and unstaged tracked additions/modifications/deletions, nonignored untracked regular files/executables/symlinks; clean restacks and explicitly resolved ordinary rebase conflicts. The worker remains reserved until explicit adoption and both reporting acknowledgements. No model assignment or saved report is replayed.

Refuse: sibling/branched feature topology, other worktrees holding selected feature branches, merge commits, executable Git hooks, sparse checkout, submodules, extended index flags (including intent-to-add), `core.filemode=false`, special files and unsafe base-path collisions. Existing executable hooks need a future hook-chain adapter; this implementation refuses rather than suppressing them. Ignored files/build/live data are neither captured nor cleaned. No stash refs or feature commits are created for preservation.

Mapping requires Git's actual `post-rewrite` journal, the complete ordered one-to-one commit inventory, resulting branch tips, current base inclusion and consistent Stax parent revisions. Dropped/squashed/reordered/foreign or ambiguous mappings stop. Shared tips are mapped explicitly to the rewritten parent. Changed patch IDs are reported as changed source, not equivalent approval; patch IDs are diagnostic, never the authority for the mapping.

## Inspect, authorize, start

First establish ready existing phase reporting. Fetch and integration-branch fast-forward retain their own explicit authority; **this operation never performs either**. After separately authorized synchronization, inspect:

```json
{"action":"restack-inspect","relationship":"/absolute/current/request.json","expectedRevision":"EXACT_REVISION"}
```

This checks endpoints, original seals, phase checkpoints, stack topology and candidate content without changing Git. It saves a private inspection and returns `inspectionFile`/`inspectionHash`. Inspection is not authorization. Ask Craig to authorize that exact snapshot's preservation, cleaning, Stax restack and candidate restoration, and save his verbatim authorization separately.

```json
{"action":"restack-start","requestKey":"restack-1","inspectionFile":"/absolute/inspection.json","inspectionHash":"EXACT_SHA256","authorizationFile":"/absolute/verbatim-authorization.md"}
```

Reuse that exact requestKey on uncertain submission. Admission rechecks the snapshot, reporting revision and both runtime epochs. Outstanding follow-ups, partial phases or Git operations block. A private operation under `$XDG_STATE_HOME/feature-workflow/restacks/ID` freezes the scope and seals. The current-operation pointer prevents competing phases/follow-ups and ordinary worker input/tools/shell/session replacement. It never aborts active tools. The existing worker independently checks idle/no pending input/UI before preservation.

The worker advances bounded inbox steps:

1. Capture index and working-tree trees separately, plus nonignored untracked bytes/modes/link targets. Archive original Git objects in a private pack and seal preservation evidence.
2. Verify candidate content again; clean tracked state and remove only exact manifested untracked files. Never `git clean`, auto-stash/pop or backup deletion.
3. Claim and run `stax restack --all --yes --submit-after no` with a private Git rewrite journal. No fetch, push or submission.
4. Validate complete topology/mapping; archive rewritten objects. A partial or unexplained result stops.
5. Plan restoration with a private index and three-way patches. Verify the plan before writing; restore separate staging and working-tree states and exact untracked content. Restore conflicts/collisions stop without automatic overwrite/replay.

```json
{"action":"restack-status","id":"OPERATION_ID"}
```

Inspect `mapping.json`, `restored.json`, execution logs and retained stop/recovery evidence. `restored` means ready to discuss adoption, not completed or accepted. Status calls do not promise automatic coordinator notifications. Do not run a long model-turn polling loop.

## Explicit adoption

After examining mapping, changed patches/conflict resolutions and restoration evidence, obtain explicit adoption authorization:

```json
{"action":"restack-adopt","id":"OPERATION_ID","expectedStage":"restored","requestKey":"adopt-1","authorizationFile":"/absolute/adoption-authorization.md"}
```

The new adoption record references original immutable phase/launch evidence and the actual mapping/restored-state hashes. It never edits old phase, launch or review records. A shared effective-checkpoint resolver chains completed adoptions; original hashes remain historical truth. A fresh reporting revision is prepared/activated by **both exact endpoints**, checked against the current refs, Stax metadata and restored candidate before completion. Ordinary reporting remains blocked while adoption is pending.

Completion releases the reservation, not a new assignment. It is **not** acceptance, commit, integration, installation, push or cleanup authority. Rerun automated checks and affected live acceptance/review. Freshness checkpoints carry the adoption generation, so prior acceptance cannot satisfy review after adoption even if the content happened to be unchanged. Remote freshness still needs separate synchronization evidence.

## Stops, continuation and reload

All mutating control actions require `id`, exact `expectedStage`, a fresh stable `requestKey` and verbatim `authorizationFile`. Reusing a claimed key only reports status; it never repeats its side effect. Conflicting reuse rejects.

- `restack-continue`: for a stopped, resolved `rebase-merge` owned by this operation. Verify recorded original branch/HEAD and target; resolve conflicts outside the reserved agent through separately coordinated human work, stage only the resolution, then explicitly authorize continuation. It claims `stax restack --continue --submit-after no`. Stax continues only that branch, so a distinct claimed `stax upstack restack` completes the suffix, then a claimed `stax checkout ORIGINAL_PHASE` returns to the assigned tip. Never repeat the original `--all` operation. New conflicts stop again.
- `restack-recover`: reconcile a stopped operation against actual Git/journal evidence. A completed-but-unreported execution can be verified without running Stax again. An interrupted restoration is reconciled only if all planned content/staging is already present; otherwise stop for explicit manual reconciliation against retained trees. No patch is automatically applied twice.
- `restack-renew`: after a user-controlled same-session reload, additionally supply exact `workerEpoch` and current `expectedRevision`. Both physical endpoint/session/worktree identities must match the original operation; no successor session or force rebind. Renewed inbox envelopes and a fresh binding generation require new acknowledgements. It does not replay Git, assignments or reports. Old active/prepared ACKs do not activate the replacement revision.
- `restack-cancel`: only before any cleaning claim, execution or adoption. Explicitly releases the reservation with unchanged old reporting, retaining the inspection/bundle/evidence. It is not backup/resource cleanup.

Unsupported automatic recovery: interrupted partial cleaning; partially restored candidate with unresolved collisions; incomplete/truncated archive or adoption-seal publication; unexplained ref/mapping drift; uncertain suffix execution without a provable complete result. Preserve everything and report the exact stage. A new request key authorizes reconciliation, never replay of an uncertain side effect. Once cleaning begins there is no automatic abort/reset/pop path. Detached HEAD is tolerated only inside the verified owned continuation path, not ordinary messaging/reporting.

## Rollout and real adoption

After synthetic validation, separately approve commit and `stow --dotfiles --no-folding -R agents pi` from the source checkout. Reload the intended coordinator and worker only when idle, explicitly renew their existing phase reporting and verify both active ACKs. Then inspect the actual feature anew: historical incident identifiers are not current authorization. Obtain its exact preservation/restack scope, and later its adoption authorization. Keep all original receipts, transcripts, review evidence and object packs until separately approved disposition.
