---
name: feature-workflow
description: "Launch isolated Stax/Herdr/Pi feature work with an explicit coordinator. Use for /feature, natural-language delegation, and planning/reuse investigation without implementing in the orchestrator."
---

# Isolated feature workflow

## Repository-independent contract and roles

This shared skill, its bundled references and installed tooling define the generic workflow. No repository-local document, project name, source layout or sibling path is required. Pi supplies applicable project instructions automatically; respect those instructions without adding instruction-file discovery, templates or placeholder documents. Project-specific build, architecture and dependency facts stay in project instructions or separate assignment context, not shared requirements.

Read this skill in the role explicitly assigned to you:

- **Coordinator:** prepare context, delegate to an independent worker, verify evidence and manage Craig's permissions. The launch procedures below are coordinator-only. A launcher-delivered assignment already has a worker; do not launch a duplicate.
- **Worker:** verify your assigned session/worktree/branch/model and integration base, implement/test only the authorized scope there, and report through the existing bridge. Reading this skill does not make you a coordinator or authorize recursive feature launching. Keep build artifacts independently writable in your worktree. Treat source checkouts and shared dependencies as read-only; coordinate any required changes separately. Follow the same phase, freshness, approval and reporting rules below without assuming coordinator-only actions are yours to run.

## Ownership and scope

The coordinator prepares context, launches, verifies and reports; **never implement/test/build the delegated feature in the coordinator session**, even by changing directory. A separate worktree is not proof of an independent agent. Startup failure does not authorize taking over.

Use only when Craig requests delegation. Require `HERDR_ENV=1`; read the Herdr/Stax skills and respect project instructions supplied by Pi. Local `main` and `openai-codex/gpt-6-astra` are defaults, not overrides of explicit choices. No inferred commit, merge, push, fetch, cleanup, live app/provider input or configuration permission.

Preserve the **verbatim brief** in a private UTF-8 file. Put agreed decisions, constraints, tests and current workflow overrides in a separate context file. Planning/investigation authorizes that work now, not implementation or acknowledgement-only waiting.

## Herdr client focus isolation

Craig may have multiple client windows attached to the same Herdr server, each with deliberate workspace/tab/pane selection. Server/socket identity and pane ownership do NOT identify the invoking client window. Automation must never reset other clients' selections. Do not issue global focus changes or invoke launch/review helpers that do so internally unless originating-client isolation is verified; use no-focus operations and manual navigation as the safe fallback. Never substitute the server's currently focused client for the invoking client. Current launch/review helpers still need this audit/fix; do not claim they are client-scoped. Validate changes with isolated multiple-client tests, not Craig's live windows.

## Per-session opt-in and coordinator selection

Ordinary Git/Herdr sessions and non-Git sessions do not register or poll a feature inbox. Repository contents, folder names and old automatic coordinator registrations are not enrollment. Explicit enrollment persists only for the exact conversation and physical endpoint; `/new` and `/fork` do not inherit it. See [enrollment and migration](references/enrollment.md).

- `/feature NAME BRIEF` validates the request, explicitly enrolls this session as coordinator, saves the multiline brief and supplies its registration epoch. Use that epoch; never create a second coordinator. Cancelling/invalid input does not enroll.
- `/feature-coordinate` explicitly enrolls an existing coordinator without launching work, sending a message, changing focus or attaching reporting. For natural-language delegation, obtain that activation when absent, then run `feature-start --list-coordinators --repo /absolute/repo`. Select the registration matching your **own `PI_SESSION_ID` and session file**, not the focused tab. Missing enrollment is a blocker: user-authorized loading/reload may be needed after integration, but reload alone does not opt an ordinary session in.
- Use `--coordinator new` only when a new control conversation is intended. It creates a coordinator in the source checkout and one independent worker. Coordinator model defaults independently to `openai-codex/gpt-6-astra`; override with `--coordinator-provider`/`--coordinator-model`.
- Ctrl-B then f preselects the compatible registered coordinator in the exact invoking pane/Herdr instance, captured before the form. Shell/worker origins default to New; unenrolled Pi origins show `/feature-coordinate` guidance and require explicit selection instead of guessing another conversation.
- Existing coordinators must share the canonical Git common directory and verified socket/server lifetime. A stale/closed/reloaded/replaced session requires explicit reselection. No repository-wide permanent owner or silent fallback.

## Launch

Inspect the source branch, dirty files and existing worktrees read-only; respect project instructions already supplied by Pi. Choose an existing local integration branch. Never copy/stash/stage dirty source files. Carry important uncommitted workflow rules as separate context and read-only source paths.

```sh
feature-start NAME --repo /absolute/repo --base main \
  --coordinator EPOCH --brief-file /absolute/brief.md \
  --context-file /absolute/context.md
```

Omit context if unnecessary; `--brief-file -` accepts stdin. `--provider`/`--model` select the worker. Require lowercase hyphenated names (maximum 48 characters). Use `--require-sibling` for relative sibling dependencies; Stax must then create `../<repo>-<name>`. Duplicate branches/paths are blockers, never implicit reuse. Allow several minutes for two-session startup rather than killing and repeating it.

The launcher verifies Git, fresh worker/session/model and Herdr identities, records ownership, obtains the coordinator inbox acknowledgement, then releases the worker brief through Pi's API. No terminal prompt pasting or Vim mode manipulation. It focuses the coordinator only after verified submission. Subsequent worker reports never change focus.

## Existing worker reporting

Use `feature-attach RECEIPT --worker EPOCH --coordinator EPOCH` to attach reporting without recreating sessions/worktrees or replaying work. Both endpoints need the current extension, explicit enrollment and user-controlled `/reload` when safe; never interrupt an implementing worker. Verified completed attachments can migrate enrollment across reload, but do not renew reporting automatically. Rebind/renewal requires `--replace PREVIOUS_REVISION`. See the short [attach procedure and recovery](references/attach.md).

## Bounded worker follow-ups

Use `feature_followup` (or `/feature-followup JSON`) for a user-authorized supplement to an existing worker, not the launcher or terminal input. Pin the original feature, current ready reporting revision and both runtime epochs; preserve verbatim user authorization/provenance separately from synthesized context. Initial/legacy workers first need metadata-only `feature-attach`; advanced phases use their phase-aware reporting binding. Choose explicit mode `steer` (after current tool calls, before the next model request) or `followUp` (after current work finishes); both start a turn when idle. Choose busy `queue` or `reject`. Queued messages are revalidated at their safe boundary and delivered through the worker's Pi API, never by aborting tools. Pending messages or blocking UI defer delivery. Steering extends the idle-only path; it does not replace its safety checks.

Use one stable request key, inspect its durable status, and never replay a delivery claim. A conflicting outstanding follow-up blocks another follow-up and phase advancement. Persisted means the exact message was saved; settled means the run stopped—not that its scope is complete or approved. Reporting stays pinned to that operation's coordinator; drift retains/rejects rather than reroutes. Recovery can cancel unclaimed work or confirm exact persistence, not resend uncertain work. See [follow-up interface and recovery](references/followups.md).

**Bootstrap limit:** candidate files do not upgrade already-running Pi processes. Obtain separate permission for safe candidate loading/reload on both endpoints and explicit reporting renewal before relying on this tool. Until then use an explicit human handoff; never self-install/reload, forge a receipt, replay the original brief or paste commands to deliver a supplement.

## Features, phases and session lifetime

Agree the complete feature boundary before implementation. A phase is a reviewed checkpoint within that feature, not automatically an independently releasable feature. Keep **one worktree and Herdr worker tab for the whole feature**. Phase completion never implies integration into the release branch, publication or cleanup.

For each phase: finish its agreed scope, validate, obtain live acceptance (or an explicit narrow waiver), review, and obtain approval to commit. At a clean committed boundary, use Stax's standard branch-on-current flow **in the same worktree** (`stax create NEXT_PHASE`, without implicit staging/commit options). Confirm parent/HEAD and obtain authorization for the next phase's scope. Keep earlier branches as checkpoints. Restacking reviewed ancestors requires coordination and renewed verification/review of affected changes.

Use the coordinator's `feature_phase` tool (or `/feature-phase JSON`) to advance an existing feature, not `feature-start`. First establish current two-endpoint reporting with `feature-attach`. Supply the exact reporting revision, committed HEAD, Stax parent, next branch, durable concise handoff, verbatim next-phase brief and explicit user authorization evidence; keep synthesized context separate. Use a stable request key, inspect returned durable status, and never duplicate an uncertain request. See [phase interface and recovery](references/phases.md).

At the reviewed/committed boundary, **before the next brief**, the coordinator evaluates context usage, next-phase continuity and accumulated debugging history. **70% usage prompts evaluation, never automatic compaction**; below 70%, keeping context is the default. Unknown usage is not zero: surface it for judgment. Use `feature_phase inspect` for current worker telemetry, then retain an explicit `keep`/`compact` decision with continuity, debugging-history and rationale fields. A stale observation blocks transition. Prefer **compaction in the existing idle session** only when that assessment calls for it; persist decisions, code/document pointers, evidence, limits and next scope first. Compaction failure pauses transition; only explicit correlated recovery may choose to keep context instead. The tool supports same-session `keep` or callback-confirmed `compact`, then verifies branch/HEAD and both reporting acknowledgements before one brief delivery. Compaction is not phase approval. Do not interrupt a busy worker or paste slash commands into its terminal. `/new` and successor-session binding are **not supported** by this capability; they require a separate explicitly verified handoff. Compaction retains original transcript entries. Never delete transcripts as part of worktree/tab cleanup or impose an automatic retention deadline; deletion requires separate authorization.

After a completed phase transition, same-session reload/renewal uses `feature_phase renew` with the exact previous reporting revision and current worker epoch; ordinary `feature-attach` does not authorize phase branches. Partial/uncertain transitions retain resources and claims. Recover only through the correlated operation and explicit authorization, never by editing launch receipts or weakening identity checks. Partial transitions with replaced runtime epochs currently stop for recovery tooling rather than adopting the new runtime.

## Fresh integration base before live testing and review

Before live testing **and again before code review**, coordinate remote synchronization and check the complete feature stack against the current integration base (`main` by default; honor an explicit base). Local `main` is not proof of remote freshness. With explicit authorization, fetch the configured remote and fast-forward the integration branch in its clean owning worktree; stop on divergence, never reset. Preserve local-ahead commits. Do not run network mutation at startup/in the background, or bundle cleanup, submission or implicit stashing into synchronization.

Use `feature-preflight --repo /exact/feature/worktree --base main --stage inspect` for a read-only checkpoint. The `live` and `review` gates require synchronization evidence; `review` also compares the checkpoint retained from live acceptance or an explicit waiver cycle. The output names exact base/stack commits, parent inclusion, dirty progress, cached upstream state and blockers; exit nonzero blocks proceeding. See [freshness gates, synchronization and diagnostics](references/freshness.md).

If base or parent history is missing from **any** level, pause at an explicitly coordinated clean checkpoint and obtain authorization to restack the whole feature bottom-up using Stax. Never silently restack active implementation or discard dirty work. Resolve conflicts and rerun automated checks before live acceptance/review. If the base changes after acceptance, rerun automated and affected live checks before review—even if the new base is already included. Restacking rewrites reviewed checkpoints: renew verification/review and preserve original receipts. For completed linear same-session phase stacks, use the explicitly authorized [restack preservation/adoption protocol](references/restack.md). It retains original seals and adds verified old-to-new checkpoint evidence with two-endpoint activation. Unsupported topology, mappings or interrupted operations still stop; never edit records or weaken checks.

For a feature review, pass the recorded live `featureCheckpoint` and current `syncEvidence` to `feature_review open`. The opt-in hook checks before snapshot/launch and again during `verify`. It does not infer feature ownership from repository contents or branch names, and does not impose this policy on unrelated document reviews. Bare generic review calls lack automatic feature binding; coordinator adherence remains required. No gate result is human acceptance or review permission.

## Live acceptance before code review

Always complete separately coordinated live testing of the current candidate **before opening its code review**. Report automated results and remaining limits, obtain permission for any live launch/input or temporary installation/reload, then ask Craig to confirm live acceptance. Isolated native tests are evidence, not Craig's live acceptance. Never combine the first live test with the code review, including when the feature itself is review tooling: use a small explicitly labeled smoke review first, confirm its behavior, then open the actual code review separately.

After a fix changes live behavior, repeat the affected live checks on the updated candidate before reviewing that fix; earlier acceptance does not cover it. If live testing is unavailable or inapplicable, obtain Craig's explicit waiver before review and record the exception narrowly. An explicitly deferred check does not block acceptance, but must not be reported as passed.

## Completion

Only after the **whole agreed feature** is complete, live-accepted and reviewed, complete this release checklist: **commit → integrate → install if applicable → push or explicitly defer → cleanup → verify**. Phase commits alone do not enter this release workflow. Explicitly include commit, integration, installation and cleanup in the completion approval request. The expected publication step after integration is an explicitly approved **non-force push of the integration branch** to its intended remote, so teammates receive the changes, followed by verification that the remote tip equals the integrated local commit. Always ask Craig to approve or explicitly defer that push; integration approval alone never authorizes it. A rejected/non-fast-forward push stops for coordinated reconciliation, never force-push/reset. If push or cleanup was omitted from an earlier request, proactively ask rather than waiting for Craig to notice. Do not declare the workflow finished with either decision unresolved. After an approved push, verify the remote branch matches the intended commit. Report any explicit deferral in the final completion summary.

Once authorized, verify the exact reviewed commit is integrated, the worker is idle, its tree is clean, and no live configuration or app process depends on its checkout. Close only the owned worker tab/panes and remove its integrated feature branch/worktree, including any detached warm checkout Stax retains. Preserve session transcripts, review feedback and receipts. Report any blocker instead of forcing removal. Never close the coordinator or unrelated work. No automatic cleanup after failed or uncertain launches.

## Phase-closeout resource inventory

Before proposing cleanup, inventory owned worktrees/branches, agent panes/sessions, test/acceptance workspaces, configuration links or copies, rollback backups, providers, runtime processes, receipts and transcripts. Record durable identities, ownership, active/idle/unknown state, dependencies on candidate files, and separately authorized disposition. Inspect both directory and per-file links. Distinguish disposable test resources from live dependencies and retained evidence; uncertainty blocks cleanup. Phase completion never authorizes releasing the whole feature or deleting transcripts.

## Coordinator notifications — signal, not routine progress

Verify and record routine successful compaction, branch/reporting transitions and implementation starts without proactively announcing each milestone. Answer accurately when Craig asks for status. Quiet operation does not excuse skipping readiness/identity checks or hiding uncertainty.

Proactively surface blockers, failures, decisions requiring Craig, readiness for coordinated live testing or human review, and completion at the correct phase/feature boundary. Worker reports and tool status are evidence, never human approval. A successful phase transition is not implementation completion; a completed phase is not whole-feature completion.

Restack timer results use [durable operation-result reports](references/operation-reports.md) to wake the coordinator at approval/recovery boundaries and completion, including while the worker is reserved or disconnected. Continue authorized intermediate work quietly; a result report is not an instruction to interrupt Craig after every success. Report delivery/persistence is separate from operation completion and human approval. Repairing notification delivery must never replay Git, assignments or execution bindings.

Apply this policy to reports received through the verified worker/reporting connection. Do not promise autonomous polling, future notifications or delivery guarantees that the installed tooling cannot provide. Report a broken or unavailable reporting route as a blocker rather than silently treating it as healthy. Preserve actionable findings and pending decisions in the durable handoff; don't interrupt a busy worker merely to announce routine progress.

## Results and recovery

`submitted` is API acceptance, not model completion. `queued` is receiver acknowledgement while busy, not delivered conversation content. Worker settled responses are forwarded as **agent status, never Craig's approval**. Inspect the receipt and correlated acknowledgement files for readiness/blockers/requests.

Claims precede delivery. A crash, missing acknowledgement or uncertain result must not be replayed automatically. Partial branches/worktrees/tabs remain inspectable. Do not rename/retry to hide failures; do not remove resources without authorization. Worktrees are not a sandbox: live configuration, data and sibling dependencies remain shared.

See [launcher interface/recovery](references/design.md) and [Ctrl-B then f popup](references/popup.md). Installation requires separately authorized restowing of `agents pi` (and `herdr` if changed), then user-controlled `/reload` in existing Pi sessions. Never restow a feature worktree over the live checkout.
