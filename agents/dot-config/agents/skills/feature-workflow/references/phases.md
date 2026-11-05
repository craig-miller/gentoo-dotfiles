# Same-session phase transitions

`feature_phase` is a coordinator tool; `/feature-phase JSON` calls the same implementation. Both endpoints must have `phase-transition-v1`. Installation and user-controlled reload require separate permission. Interactive Pi instances are not remote RPC servers; this transport uses the existing private inbox and worker-side Pi APIs, never terminal prompt pasting.

## Start

Finish live acceptance, review and an explicitly approved phase commit first. Establish ready reporting using `feature-attach` for an original/legacy worker. A phase transition never commits for you. Settle or explicitly cancel any unclaimed pending follow-up first.

Before the next brief, inspect the current worker context:

```json
{"action":"inspect","relationship":"/absolute/reporting/revisions/REVISION/request.json","expectedRevision":"REVISION"}
```

Evaluate **usage, next-phase continuity and accumulated debugging history**. 70% prompts evaluation, **not** automatic compaction. Below 70%, keep is the default; choosing compact still needs an explicit rationale. Unknown (`null`) is not zero and requires judgment. Missing telemetry requires a separately approved safe candidate load/reload, not an invented estimate. Copy the observed `percent` and `leaf` into `contextEvaluation`; the coordinator and worker check them again before reservation. Stale data blocks; inspect/reassess rather than silently applying an old decision.

```json
{
  "action": "start",
  "requestKey": "phase-two",
  "relationship": "/absolute/reporting/revisions/REVISION/request.json",
  "expectedRevision": "REVISION",
  "expectedHead": "FULL_COMMITTED_SHA",
  "expectedParent": "main",
  "nextBranch": "feature/next-phase",
  "sessionMode": "keep",
  "contextEvaluation": {
    "usagePercent": null,
    "leaf": "OBSERVED_LEAF_OR_NULL",
    "continuity": "Next scope benefits from the existing implementation context",
    "debuggingHistory": "Retain unresolved hypotheses and prior failure evidence",
    "rationale": "Usage is unknown; explicitly choose keep after assessing continuity/history"
  },
  "handoffFile": "/absolute/handoff.md",
  "briefFile": "/absolute/verbatim-next-phase.md",
  "authorizationFile": "/absolute/user-authorization-evidence.md",
  "contextFile": "/absolute/optional-synthesized-context.md"
}
```

The explicit decision and assessment are frozen in the phase record. Use `compact` instead of `keep` only when authorized; no threshold selects it for you. Save the handoff first. Confirmed compaction failure **pauses** transition—there is no automatic keep fallback or retry. The handoff and authorization files are limited to 32 KiB; brief/context to 128 KiB. All are nonempty UTF-8; their exact text is frozen in a separate sealed phase record. The authorization file records actual user approval and its source; supplying model-generated assertions is not a substitute for approval. Tool readiness/status never supplies missing scope approval.

Admission checks exact session/file, Herdr server lifetime/pane/tab, worktree/common directory, current reporting revision, clean tree **and index**, committed HEAD, Stax parent/revision and ancestry. Untracked files and ongoing Git operations block. The worker independently verifies idle/no queued work and reserves the transition before compaction/branching. While reserved it refuses ordinary new input, tools, shell input and session/tree replacement; it does not abort busy work. Do not use unrelated extension commands to bypass the reservation.

Only `stax create NEXT_BRANCH --prefix ""` mutates Git. The empty prefix preserves the supplied exact name; no stage/commit, fetch, stash, reset, rebase, publication, integration or cleanup options are used. Earlier branches remain checkpoints. No worktree/tab/session is created or replaced.

The worker advances bounded steps in its existing inbox timer. `ctx.compact` completion/error callbacks are correlated to its exclusive claim, persisted compaction entry, transcript prefix and unchanged session identity. Both endpoints then acknowledge the new phase reporting revision before one claimed API assignment. Phase records authorize only the exact new branch under the unchanged launch identity; generic attachment identity checks are not loosened.

## Status and recovery

```json
{"action":"status","id":"PHASE_ID"}
```

Returns promptly with a durable directory, current reporting pointer, stale-endpoint indicators and evidence. `delivery-submitted.json` means API submission only; the terminal phase stage `submitted` additionally requires the exact persisted assignment entry. Neither means task completion or human approval. Keep that ID and reuse the same start request key after an uncertain tool result; do not rename/relaunch to hide it. No long model-turn polling loop is necessary. Inspect the retained operation when reporting indicates a blocker.

Stages distinguish requested, compaction pending/uncertain, compacted-not-branched, uncertain branch, branched-not-activated, activated-not-delivered, uncertain assignment delivery and submitted. Receipts and claims remain inspectable. Missing callbacks/ACKs are not success. A pending operation must not be raced by recovery.

For a **stopped** operation, still using the original live epochs:

```json
{"action":"recover","id":"PHASE_ID","expectedStage":"branched-not-activated","authorizationFile":"/absolute/recovery-authorization.md"}
```

Recovery verifies the exact stage and identities. It may resume an unclaimed step, or reconcile an uncertain branch only when the actual clean checkout, HEAD and Stax parent prove the expected result. It never repeats `stax create`. An uncertain assignment is reconciled only by finding its exact persisted message/content/revision in the worker transcript; absence remains uncertain and never authorizes replay.

A callback-confirmed compaction failure can explicitly switch to keeping context:

```json
{"action":"recover","id":"PHASE_ID","expectedStage":"compaction-failed","resolution":"keep-after-failed-compaction","authorizationFile":"/absolute/user-approved-keep.md"}
```

This retains a correlated immutable recovery record; it neither retries compaction nor deletes history. Unconfirmed compaction, stale/replaced epochs during a partial transition, ambiguous/missing persistence, or interrupted metadata publication can require additional recovery tooling. Retain resources and report these limits; do not delete claims, edit receipts, force checkout, silently bind another runtime or replay work.

## Reporting renewal after completion

After same-session reload, explicitly renew reporting from the same coordinator session with its new registration, the same worker session's current epoch and the exact current revision:

```json
{"action":"renew","id":"PHASE_ID","workerEpoch":"CURRENT_WORKER_EPOCH","expectedRevision":"CURRENT_REPORTING_REVISION"}
```

Renewal is metadata-only and can acknowledge busy endpoints. It does not require a clean tree or original checkpoint HEAD: legitimate phase progress must survive. The exact active phase branch must still match. It never resends the assignment or a saved report. Inspect the returned revision directory's `ready.json` and both active acknowledgements before relying on reporting. A partial renewal may be explicitly superseded using its exact current revision; never blindly retry the old revision. Different sessions, panes or repositories require a separate capability, not renewal.

## Lifetime and permissions

Same-session keep/compact only. `/new`, successor-session binding and automatic transcript retention/deletion are not implemented. Preserve the complete feature workspace and all reviewed phase checkpoints until the separately approved full-feature release. Phase briefs, compaction, recovery and reporting renewal do not grant commit, integration, installation, push, live-input or cleanup permission.
