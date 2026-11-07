# Asynchronous operation results — restack first

Restack results use the existing private coordinator inbox and `feature-coordination` custom-message delivery with `triggerTurn: true`. They do not launch another agent, paste terminal input, change focus or create a separate notification service. Both intended endpoints should load the candidate only after separately approved installation/idle reload; the coordinator must advertise `operation-report-v1`.

## Boundaries, not routine progress

The timer observes durable operation state even when the worker produces no model response, is reserved, stopped or already completed. It records stable sealed result events for:

- `awaiting-adoption`: candidate restored, worker reserved; inspect mapping and ask Craig for adoption approval.
- `blocked`: exact immutable failure evidence and recovery/decision needed.
- `adoption-completed`: result and next steps (revalidation/live/review), not feature release or human approval.
- Pre-clean cancellation, unavailable worker, incomplete activation and missing endpoint ACKs also receive actionable result events.

Successful intermediate steps with an authorized continuation do not emit progress messages. Fresh activation gets 30 seconds before an unconfirmed ACK wait is reported. A requested operation with no progress gets 30 seconds; reserved/executor steps get 360 seconds (beyond the executor's 330-second limit). These are observation windows, not automatic abort/retry permission. A slow/uncertain step is reported as unconfirmed, never assumed failed or repeated.

Each event is keyed by operation ID, result kind and evidence digest. It freezes the observed evidence separately from mutable operation selectors. Repeated polls suppress duplicates. Unclaimed approval/blocker reports that have become obsolete are marked superseded without waking the coordinator to ask an obsolete question. Completion still produces its own result. Uncertain claimed delivery is never silently discarded or resent.

Operation results wake the **coordinator**, not Craig directly. The coordinator continues already-authorized work quietly and interrupts Craig only for missing permission, a decision, recovery or an appropriate completion handoff. Being idle or reserved is not by itself permission to start new work.

## Truthful delivery state

`restack-status` includes `reports`, separate from the operation stage:

- `retained`: durable event, no routed inbox request yet (for example, destination unavailable).
- `queued`: request saved for its exact coordinator route; busy/pending/UI-blocked receivers wait.
- `submitted-unconfirmed`: API accepted the custom message; exact transcript persistence has not yet been observed.
- `uncertain`: exclusive claim exists without confirmed persistence/API completion. Never resend blindly.
- `persisted`: exact event ID, operation ID and content found in the same coordinator transcript, preserving its recorded prefix and header identity.
- `superseded-without-delivery`: an obsolete unclaimed event was intentionally not sent.

The receiver acknowledges queued/submitted/persisted/uncertain states. API return alone is not delivery confirmation. Persistence proves the report was saved, not that the coordinator finished processing it, Craig saw it or approved anything. No operation/report state supplies missing acceptance, commit or release permission.

The operation-bound report path validates the sealed restack/launch evidence and exact coordinator identity. It deliberately does not require ordinary ready reporting or the worker's branch to be attached: reports about a reserved/conflicted/disconnected worker must be deliverable. This exception is **notification-only**; ordinary reporting, phase, follow-up and Git admission checks are unchanged.

## Reload/disconnection recovery — notifications only

Temporary disconnection retains the event/request. When the same runtime returns, unclaimed delivery can proceed. A runtime epoch change does not silently select a different destination. From the same coordinator conversation and physical endpoint, explicitly authorize:

```json
{"action":"restack-report-recover","id":"OPERATION_ID","requestKey":"report-recovery-1","authorizationFile":"/absolute/verbatim-report-only-authorization.md"}
```

This works after operation completion as well as during a reservation. It verifies the current coordinator, records report-only authorization, reconciles prior claims against the exact transcript and routes only unclaimed events to that verified coordinator epoch. It also installs a report-only observation envelope so later persistence and unavailable-worker results remain observable without reopening the operation or renewing its execution/reporting binding.

Reuse the same request key on uncertain submission; it reports current evidence without repeating the recovery. A partially completed recovery can require a separately authorized new recovery key. No request key replays a claimed notification. Claimed-but-unconfirmed delivery remains uncertain unless exact persistence is found; use the returned status/evidence for an explicit human handoff rather than sending a duplicate notification.

Delivery has an event-local lock distinct from execution/control locks. Explicit recovery may retire a lock only when its recorded owner is marked inactive and a verified replacement runtime occupies the same conversation/physical endpoint. For a worker-owned lock, additionally pin its current `workerEpoch`. The retired owner evidence is retained. Mere heartbeat expiry, another session, an active owner or a lock with missing/ambiguous owner evidence is not enough; stop and inspect. Corrupt seals/transcript identity/prefix likewise block delivery rather than weakening identity checks.

This action never calls the Git executor, resends assignments, renews operation bindings, releases reservations, installs/reloads tooling or grants approval. Old routes reject after replacement. If both endpoints are unavailable, no running agent can deliver a turn: evidence remains durable for explicit recovery, not a claimed delivery guarantee.
