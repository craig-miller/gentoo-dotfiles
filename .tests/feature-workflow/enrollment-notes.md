# Per-session opt-in candidate evidence

## Scope and checkpoint

Incremental candidate in `feature/phase-transition`, based on unchanged HEAD `c8bb06f5ba3bac6bd2acd8cf900ef90a74385b3c`. Implementation/tests/documentation only. No feature commit, integration, installation/live reload, push, cleanup, phase advancement or live acceptance was performed. Earlier candidate acceptance/review waiver does not cover these changes. Reporting remains through the existing pinned coordinator relationship.

Relevant lifecycle/session documentation and reload examples were consulted, along with the installed extension runner and read-only Herdr session publisher. Existing registration, launcher request/receipt, attachment, phase, messaging and popup mechanisms are reused. No repository-content classification or separate focus-isolation implementation was added.

## Candidate

- `enrollment.ts`: explicit intent, durable identity-bound custom transcript entry, exact current endpoint verification, conservative completed-attachment migration and old minimal receipt bootstrap.
- `coordination.ts`: ordinary sessions return without registration, Git probing or inbox timer; `/feature-coordinate` enables metadata-only coordinator/legacy-worker activation. Bootstrap runs outside the awaited sequential lifecycle hook, with bounded read-only identity waiting and generation cancellation.
- `index.ts`: valid `/feature` activates its own coordinator before needing a registry entry. Invalid/cancelled input does not enroll; a worker cannot be reclassified.
- `worker.ts`: launcher role/request contradictions fail readiness.
- `feature-start`: selection requires matching explicit enrollment metadata; automatic legacy registry files are not grandfathered.
- `feature-popup` / `feature-attach`: activation guidance instead of claiming reload alone is sufficient.
- Generic skill and references document opt-in, migration and limitations without feature-specific policy changes.

Identity remains pinned to session/file, role, cwd/common Git directory, pane/tab/workspace and socket lifetime. New/fork sessions cannot inherit enrollment or process flags. Resume/reload restores only exact proof. Enrollment does not adopt an inbox, renew reporting, replay work, change branch/HEAD, focus a client or grant implementation/release approval.

## Validation

Final automated run: **117 tests passed** — 52 feature-workflow Bun tests, 18 review regression Bun tests and 47 Python tests. Both strict installed-SDK typechecks and `git diff --check` passed. Log: `.tmp/enrollment-validation.log`.

New coverage includes ordinary Git/non-Git/non-Herdr behavior; explicit/idempotent activation; reload/resume and non-inheritance; legacy minimal receipts; stale/conflicting identity and role refusal; completed current attachment/phase proof; pointer drift during verification; sequential lifecycle publication and cancellation while activation waits. Existing phase, context, messaging, launcher/attachment/popup and review regressions remain passing.

Isolated native checks passed with private configuration/state, synthetic repositories and deterministic offline inference:

- `herdr_coordinator_smoke.py`: independent launcher roles, explicit reuse, reports, ordinary Git session remaining unenrolled, explicit command activation and durable reload, ordinary non-Git session remaining unenrolled, popup activation guidance and cross-server selection rejection.
- `herdr_coordinator_smoke.py --attachment`: metadata-only legacy attachment, dirty/committed progress preservation, busy reporting, reload/explicit renewal, rebind and rejection of late old-owner status.
- `herdr_popup_smoke.py --ui-only`: form/picker/default/error/cancel regressions, without provider inference.
- `phase_native_smoke.py`: both messaging modes and actual tool-boundary ordering, modal/busy protection, compaction, Stax progression, exact transcript/receipt retention, phase-aware renewal and failed-compaction recovery. Final retained evidence: `.tmp/phase-8rvhko9k` (earlier corrected pass: `.tmp/phase-68q0ekpk`).

An initial native run failed because awaited enrollment preceded Herdr's later session-identity publication hook. This was fixed, not waived; regression coverage and the native runs above pass. Its private phase evidence remains at `.tmp/phase-fm0fsk84`. Tightening migration schema checks also exposed an incomplete unit fixture; the fixture now carries the actual version-1 attachment schema.

These tests are not live acceptance or code review. No real provider timing/obedience claim is made. Existing live agents/configuration were not upgraded or given input. Native fixture lifecycle operations affected only disposable test-owned resources; no feature resources were released.

## Migration and limits

See `agents/dot-config/agents/skills/feature-workflow/references/enrollment.md` for the generic procedure. Separately authorize loading the complete extension and safe endpoint reloads. Exact saved enrollment, matching launcher requests and completed current attachments can establish intent. Otherwise use `/feature-coordinate` for the intended coordinator or `/feature-coordinate worker /absolute/original-receipt.json` for the exact legacy worker. Discover current epochs and explicitly attach/renew reporting; advanced phases retain phase-aware renewal.

Old automatic registrations, bare role markers, partial/superseded attachments and old flag-only reloads without exact request/marker evidence do not migrate implicitly. Changed pane/server/worktree identity fails closed. Minimal old receipts require the original branch; they do not confer phase authorization. There is no same-conversation opt-out or successor-session transfer in this slice. Launcher global-focus/client-isolation limitations remain unchanged; existing no-global-focus policy still applies. No live installation/reload instructions have been executed.
