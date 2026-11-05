# Phase-transition candidate: evidence and integration notes

## Scope and reuse

Candidate implementation lives in `pi/dot-config/pi/extensions/feature-workflow/phase.ts` and `phase-record.ts`, registered by `index.ts` and driven by the existing coordination timer. It reuses launch receipt identity, exact Herdr/session registrations, the two-stage attachment ACK protocol and exclusive delivery claims. Ordinary attachment still binds the original branch; only a separately sealed phase record authorizes a successor branch. `feature-attach` refuses phase-managed workers rather than silently adopting a branch.

The worker owns compaction/branching in its existing process. The coordinator tool returns a durable ID without waiting for the worker. Reporting renewal after completed transitions keeps exact session/pane/worktree identities while explicitly replacing runtime epochs. Phase input/context/authorization are separate, and no feature release action is implemented.

## Authorized workflow-gap supplement

Implemented the supplement in `/home/craig/.local/state/feature-workflow/plans/phase-transition/workflow-gap-follow-up.md`, preserving Craig's authorization: “well, let's fix the workflow gap first. I don't want to verify twice.” Correction: the earlier 101-test report incorrectly claimed this superseded steering. `/home/craig/.local/state/feature-workflow/plans/worker-messaging.md` EXTENDS the idle-only proposal, as reiterated in `phase-transition/messaging-scope-correction.md` and Craig's subsequent instruction. Both explicit modes are now implemented in this same candidate. No additional feature worker/coordinator or real project transition was used; native test endpoints are isolated offline fixtures only.

`followup.ts` adds `feature_followup` / `/feature-followup JSON`, using the same registration, ready reporting and private inbox infrastructure. The sealed operation freezes original feature/binding/epochs, exact user authorization, separate synthesized context, scope/provenance and transcript prefix. Explicit `mode: steer | followUp` extends the same operation (no parallel transport). While busy, steer waits for completed `turn_end`, after all current tools and before the next model request; followUp waits through current work to `agent_before_settle`. Both call the worker's Pi API with their exact `deliverAs` and `triggerTurn: true`, and both start a turn when idle. Durable external queueing permits identity/revision checks at the actual safe boundary. Pending messages/modal UI defer or reject; no tools are aborted. Timers/boundary hooks serialize per runtime. Old mode-less records retain idle-only semantics. Both endpoints must advertise `worker-messaging-v1` to accept new mode-bearing operations. Command-like authorization remains plain content. Stable keys/conflict exclusion, exact persistence acknowledgement, pinned settlement reporting and bounded cancel/reconcile recovery retain uncertainty without replay. Initial/legacy launch receipts require metadata-only reporting attachment first; active and renewed phases use their current phase-aware binding. The tool neither changes focus nor creates resources, and allows existing dirty implementation progress without mutating it.

`context-policy.ts`, registration telemetry and `feature_phase inspect` require explicit boundary judgment before the next brief: usage, continuity and debugging history; 70% means evaluate, not compact automatically; below 70% keep is the default; unknown is explicitly null, never zero. A recorded explicit decision and handoff precede any compaction. The worker rejects stale percentage/leaf observations before reserving the transition. Confirmed failure still pauses until explicit recovery.

The earlier supersession statement and idle-only guidance were corrected in this note, the generic skill and messaging reference. Installed Pi extension docs, send-user-message example, RPC queue semantics, and AgentSession/core boundary ordering were reread before the extension.

The installed/live processes have not acquired these capabilities just because the candidate exists. Both endpoints need separately approved safe loading/reload and explicit ready reporting renewal; until then this is a documented bootstrap gap, not permission to self-install or paste a supplement. Plan **one combined live-acceptance gate** for the current phase/follow-up/context-policy candidate, before actual code review. Private native review-tool regression fixtures are not a review of this candidate.

## Source baselines / integration collision

- Clean feature branch and source HEAD at assignment: `36ddc7bc8ffef85ada6ca545421aae543340d927`.
- Source skill read-only path: `/home/craig/dotfiles/agents/dot-config/agents/skills/feature-workflow/SKILL.md`.
- Initial source skill Git blob: `7870b5d94eab9abab722a4875ed5628e42b22854`.
- Initial source skill SHA-256: `30ecefec5b70917399e0d286d158b30f596700f22e7ae93cbfc740890fc77c31`.
- Later source skill Git blob: `1ee7331b41527476b6e1fae12d20f4683e5fd89a`.
- Later source skill SHA-256: `f7ce37eb954eb809f73902d45120567d7ecb764903f96b159cc731ab9061a9ef`.

The initial source contained approved uncommitted generic feature/phase/compaction and live-before-review policy. These were deliberately incorporated, with the old tooling-gap paragraph replaced by the candidate interface and explicit limitations. During implementation the source gained a Herdr multi-client focus-isolation section; this is also preserved. No source checkout files were copied wholesale, changed, stashed or staged. Integration must reconcile this overlapping dirty skill rather than overwrite it. Other dirty/untracked source files remain unrelated.

Phase code invokes no focus, pane creation, tab creation, session replacement or cleanup command. Existing launcher/review focus behavior remains outside this feature; passing single-client synthetic regressions does not establish multi-client isolation for those helpers.

## Grounded interfaces

Read installed Pi extension/session/compaction/session-format/RPC/SDK documentation and relevant command, handoff, compaction, reload and message examples. Installed source also confirms that `message_end` extension handlers execute **before** persistence. Consequently phase assignment acceptance is not inferred from that event: context/tool/settled boundaries or the inbox timer verify the exact persisted entry before lifting the reservation/reporting gate.

Installed `stax create --help` confirms branch-on-current flow. The sole mutating Git workflow command is `stax create EXACT_BRANCH --prefix ""`; real synthetic tests verify same worktree, unchanged HEAD, parent metadata and retained earlier branch. No commit/stage/stash/fetch/rebase/reset/merge/push is part of phase execution.

## Evidence

- 42 feature-workflow Bun tests (19 existing, 8 phase, 7 follow-up, 2 context-policy and 6 explicit-mode cases; many cases exercise fault matrices).
- 47 Python launcher/default-selection/attachment/popup tests.
- 18 review-tool Bun regressions.
- **107 automated tests total**, both strict host-SDK typechecks and `git diff --check` pass.
- Private native phase test: actual same-session Pi compaction success and cancellation/failure; unchanged transcript prefix and original receipt; same session/pane/tab/worktree; correct Stax parent/HEAD; correlated persisted assignment; future reporting; reload plus explicit renewal; subsequent phase and explicit keep-after-failure recovery.
- Combined private native follow-up/context-policy tests: actual busy and blocking-modal Pi queues, tool exposed in real Pi context, preserved slash-prefixed CRLF authorization, transcript/receipt retention, no focus/tab movement, one persisted assignment, pinned coordinator acknowledgement, phase-renewed follow-up and persisted explicit compaction assessment. Pure regressions additionally cover pending messages, advisory 70%/unknown usage, stale observations, endpoint/server/revision/transcript faults, conflicts, uncertain persistence and recovery.
- Streaming native fixture uses real Pi `bash` tool calls (two overlapping bounded sleep/printf calls, then another tool turn). Provider traces prove steer arrives only after both initial tools complete and before the next model request; followUp stays absent through subsequent tools and the final answer, then arrives for the post-work request. All three tools finish successfully, no abort is issued, and both modes retain exactly one message/report. Both modes also pass idle turn-start and post-phase/reload/renewal delivery. These prove transport ordering, not real-model obedience or human acceptance.
- Native legacy attachment/launcher test: initial and reused coordinator, old receipt, committed/dirty progress, busy reports, same-session reload/renewal and explicit rebind.
- Native coordinator/default-selection test: invoking coordinator, shell/worker exclusions, picker cancellation/override, separate servers with colliding pane IDs and unregistered/closed destinations.
- Native popup UI-only regression (no provider calls).
- Private native review-tool regression: frozen scope, exact origin return, busy/reload delivery, preserved feedback, incomplete/cancelled outcomes, new/deleted/renamed/mode-only files and moved/closed endpoint refusal.

Retained private phase logs live under `.tests/feature-workflow/.tmp/phase-*`; successful runs include `phase-mxlspcbw`, `phase-7oz_xs_x` and pre-supplement `phase-vqrd9fpj`. The initial `phase-zum0ytj0` fixture exposed a test-only AF_UNIX pathname issue, fixed using the existing proc-fd alias. `phase-85sdhpet` exposed the pre-persistence message event ordering described above; the corrected native rerun passed. The earlier idle-only supplement's successful evidence is `phase-3ja97n1u` / `phase-1n6ghitr`; these were incomplete coverage, not acceptance of the full messaging requirement. Explicit-mode native evidence includes `phase-7dwx90ui`; the final combined rerun is `phase-wn1mfv7r` (actual streaming tools, both modes, phase progression and renewal). Launcher/default-selection, attachment and popup UI-only native regressions were also rerun successfully after the mode correction. Latest review-tool regression evidence is `.tests/tuicr-review/.tmp/native-zr986lvw` (pre-supplement `native-xokd9nyy`). Those pre-acceptance regressions used no live sessions, settings or provider inputs. The later explicitly authorized live-configuration acceptance exercise is recorded below.

## Deliberate limits and acceptance gate

Same-session keep/compact only; no `/new` or successor-session binding. Reporting renewal is for the same coordinator and worker sessions/panes, not a cross-session/cross-repository transfer. Clean boundary checks require current Stax parent metadata; divergent/restacked ancestors require separate coordination.

Recovery never reruns a claimed branch operation or assignment. It can resume an unclaimed step under the same live epochs, verify an already-created branch, confirm an exact persisted assignment, or—with explicit user evidence—keep context after a callback-confirmed compaction failure. Unconfirmed compaction, partial transition runtime replacement, interrupted metadata publication, stale control locks and delivery without exact persistence remain retained blockers requiring additional correlated recovery work. No automatic lock removal, branch rollback, receipt rewrite, claim deletion or replay is provided. This is a fail-closed limit, not a successful recovery claim.

Follow-up recovery only cancels **unclaimed** work or proves exact persisted content without replay. A claim stranded across worker runtime replacement, uncertain settlement/report publication, missing exact persistence or a stale control lock remains inspectable and may require additional authorized recovery tooling. Same-coordinator reload permits metadata-only cancellation/reconciliation, not successor execution or report rerouting. An API return or settled/aborted run is not task completion. Binding drift retains the original result rather than delivering it to a new owner.

The authorization file is an explicit provenance requirement, not a cryptographic proof of human consent. The coordinator must record actual user approval; agent status and synthesized handoff text do not provide it. Worktrees and same-user private files are not a security sandbox, and final-check/action races against out-of-band processes cannot be eliminated by this extension.

Stop for separately authorized live acceptance **before code review**. Installation/restowing from the integrated source checkout (`agents pi`) and safe user-controlled reload of both endpoints require separate approval. Do not install/restow this worktree. No feature commits, integration, push, real-project phase transition or feature cleanup have been performed. The throwaway fixture's baseline commit and typed test phase transitions are not feature commits/release actions.

## Authorized temporary-switch acceptance exercise — awaiting Craig

Craig subsequently authorized the temporary configuration switch and throwaway setup, leaving existing agents untouched and forbidding global focus changes. Evidence: `.tests/feature-workflow/.tmp/live-acceptance-ZAgDpN/` (`run.log`, `results.json`, `switch.json`, command audit, exact user authorization, frozen candidate/provider, original launch receipts, transcripts and provider/tool traces).

The live path `/home/craig/.config/pi/extensions/feature-workflow` was atomically exchanged for a symlink to that directory's frozen `candidate/`. The exact original directory, modes and symlink text are preserved at `/home/craig/.config/pi/.feature-workflow-acceptance-ZAgDpN-backup`. No restow, source-checkout edit, global settings edit or existing-agent reload/input occurred. Source bytes and global settings hashes were verified unchanged; `rollback.py` passed its read-only preflight. Applying rollback is a separate explicit operation (`--apply --confirmed`); the switch currently remains active. Do not remove this worktree/snapshot while live configuration depends on it, and do not reload unrelated agents into the temporary candidate.

The throwaway workspace is `wR` (Phase messaging acceptance), coordinator `wR:p2` / `wR:t2`, worker `wR:p3` / `wR:t3`. Both are idle/done and retained. Existing feature endpoints `wQ:p2` and `wQ:p3` retain their original sessions/cwds; selected tab stayed `wQ:t3`. All creation used no-focus operations. The installed launcher has a hard-coded final global-focus call: the acceptance-only driver explicitly refused it after genuine verified submission, recorded that refusal, and never fabricated a focus acknowledgement or edited the launch receipt. Launcher global-focus implementation/client isolation remains deferred.

Passed through the temporarily switched live extension, on the real Herdr server with real Pi sessions and bounded tools:
- Both idle message modes start turns; duplicates deliver once; command-like authorization remains ordinary content.
- Busy steer arrives after both initial tool calls complete and before the next model request. FollowUp remains absent through later tools/final answer and arrives afterward. No tool abort; modal queuing and pinned reporting pass.
- Public `feature_phase inspect` observed 4.8875% (keep-default guidance) and later unknown/null (judgment-required guidance). Explicit rationale/continuity/debugging-history assessments were frozen before transitions.
- Same-session compaction retained transcript/receipt history; correct Stax parent/HEAD and two-endpoint reporting preceded each one-time phase assignment.
- Worker-only reload, explicit phase-aware renewal and both subsequent message modes passed without assignment replay.
- Callback-confirmed compaction failure blocked branching; explicit correlated keep recovery advanced the next throwaway phase without retrying compaction.

Limits/deferred checks: the deterministic offline provider makes timing reproducible, so real-provider timing/obedience and compaction summary quality were not tested. Actual >=70% context usage and destructive crash/filesystem-failure injection were not exercised live (threshold/uncertainty paths have regression coverage). No full multi-client focus audit of the existing launcher/review helpers was performed. These results are NOT Craig's acceptance. Stop here for his acceptance/explicit deferral decisions before any candidate code review. Test resources, rollback evidence and transcripts remain intact.
