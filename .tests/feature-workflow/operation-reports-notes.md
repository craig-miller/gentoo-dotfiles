# Restack operation-result reporting candidate

Scope: direct dotfiles implementation approved after inspecting existing settled-worker, bound-status and coordinator-inbox reporting. No active feature stack/receipt, agent, live provider or configuration was controlled. No commit, installation, reload or live recovery performed.

## Reuse and boundaries

`operation-reports.ts` adds durable result events/outbox metadata to the existing operation directory. Delivery remains the existing coordinator inbox and `feature-coordination` custom message with `triggerTurn: true`; no second transport or notification agent. The inbox delegates only operation-status validation/persistence acknowledgement to this helper. Ordinary bound-report/branch/attachment admission is unchanged.

Restack timers reconcile results even for completed/stopped/reserved workers. Stable evidence-keyed events cover awaiting adoption, failures, completion/cancellation, unavailable worker, incomplete/missing ACK activation and unconfirmed idle/reserved progress. Intermediate authorized continuation remains quiet. Unclaimed obsolete events are superseded; delivered/uncertain events are never resent. Evidence snapshots retain historical meaning across runtime/binding selector updates.

Event-local ownership locks protect delivery versus report-only rerouting. API acceptance is separate from exact transcript persistence, coordinator processing and human approval. Claimed uncertainty is reconciled only against matching transcript content/event identity and a preserved prefix. A stopped/unknown claim is not resend authority. Report-only recovery supports the same coordinator after reload, including terminal restacks, without touching execution bindings, reservations, Git or assignments. Only an explicitly inactive, proven replaced lock owner can be retired; missing owner proof remains blocked. Neither heartbeat expiry nor another session is sufficient.

## Validation

- **62 Python workflow tests**.
- **72 Bun workflow tests**, including eight focused report-delivery cases and a new real Git/Stax lifecycle case that verifies quiet intermediate steps, restored-boundary coordinator wake, persistence ACK, completion wake and duplicate suppression.
- **20 Bun review regression tests**.
- Both strict installed-SDK typechecks and `git diff --check` pass.

**154 tests total.** Git/Stax operations run only in synthetic repositories; Pi/Herdr endpoints and message persistence are simulated. No native live coordinator delivery/acceptance or active-feature recovery has been tested. Logs: `/tmp/operation-reports-python.log`, `/tmp/operation-reports-bun.log`, `/tmp/operation-reports-review.log`.

Focused cases include busy/UI queues, API success before delayed persistence, API failure after persistence, absent uncertain delivery without replay, completed-operation reload routing recovery, proven lock-owner replacement, foreign coordinator/evidence rejection, worker disconnection, ACK wait and idle/executor observation windows. Notification execution is constrained in tests to Herdr endpoint inspection; any Git/executor command from that path fails the test.

Rollout requires separate commit/restow authorization, then user-controlled idle endpoint reload. The coordinator must advertise `operation-report-v1`; missing capability retains a report instead of sending to an incompatible receiver. Already-paused operations can be inspected and have notifications recovered explicitly with `restack-report-recover`; installation or tests alone never authorize that live action. See `references/operation-reports.md` for the interface and limits. Offline endpoints cannot guarantee an immediate turn; preserved reports/claims expose the reason and recovery state rather than claiming delivery.
