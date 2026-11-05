# Bounded coordinator-to-worker follow-ups

`feature_followup` and `/feature-followup JSON` share one operation. It delivers an explicitly authorized supplement within the existing feature with explicit mode **`steer` or `followUp`**—not a launch, phase/session transition or release command. Streaming steering extends the original idle-only proposal; it does not supersede it or its safeguards. It creates no worktree/tab/session and changes no focus.

## Bootstrap and binding

Candidate files do not change already-running Pi instances. Both endpoints must advertise `worker-messaging-v1` (the earlier `followup-v1` alone is insufficient); safe loading/reload requires separate permission. Do not install/reload yourself to bootstrap a follow-up. Until a verified path is loaded, use a deliberate human handoff, never terminal pasting, slash injection, a forged receipt or replay of the launch assignment.

Require a current, ready two-endpoint reporting binding. Initial/legacy workers first use metadata-only `feature-attach` with explicit epochs; a launch receipt alone is not a follow-up destination. Completed phase transitions and explicit renewals use their current phase-aware reporting revision. No new worker or launcher reuse is needed. Ordinary attachment still rejects unauthorized branch drift.

## Send

```json
{
  "action": "send",
  "mode": "followUp",
  "requestKey": "bounded-supplement-one",
  "feature": "ORIGINAL_FEATURE_NONCE",
  "relationship": "/absolute/reporting/revisions/REVISION/request.json",
  "expectedRevision": "REVISION",
  "workerEpoch": "CURRENT_WORKER_EPOCH",
  "coordinatorEpoch": "CURRENT_COORDINATOR_EPOCH",
  "busyPolicy": "queue",
  "scope": "Implement only the explicitly authorized supplement",
  "provenance": "User approval conversation/message reference",
  "authorizationFile": "/absolute/verbatim-user-authorization.md",
  "contextFile": "/absolute/optional-synthesized-context.md"
}
```

Authorization is nonempty UTF-8, at most 32 KiB; optional context at most 128 KiB. Scope/provenance are bounded to 4000 characters each. Record actual human authorization, not a model assertion standing in for consent. The immutable operation preserves text exactly, including CRLF/BOM, separately from context. The message explicitly retains existing approval ceilings; this transport does not grant broader release/live/configuration permissions. Ordinary text, even `/new` or `/reload`, is delivered as attributed custom-message content, never expanded as a command.

`mode` is mandatory:

- **`steer`**: while busy, wait for the completed `turn_end` boundary, after all current tool calls and before the next model request. Revalidate there and call `pi.sendMessage` with `deliverAs: "steer"`, `triggerTurn: true`. No tool abort, key injection or promise of instantaneous interruption.
- **`followUp`**: while busy, wait through intervening tool/model turns until `agent_before_settle`, after current work finishes. Revalidate and call the same API with `deliverAs: "followUp"`, `triggerTurn: true`.
- **Either mode when idle**: start a turn through that API, not silently store text. Old mode-less operation records retain their original idle-only behavior; new requests must choose a mode.

`busyPolicy` is explicitly `queue` or `reject`. With `queue`, the private durable inbox holds the message **outside Pi's active work queue until the requested safe boundary**. This permits late identity/revision checks before any claimed API side effect. `reject` refuses work that cannot currently be delivered rather than waiting. Existing pending messages, blocking UI or an aborted boundary defer/refuse admission to Pi. Timers and boundary hooks serialize per runtime to avoid racing each other.

Immediately before the exclusive claim, revalidate the sealed binding, original receipt, reporting revision, epochs, server lifetime, actual pane/session/worktree and authorized branch. The Pi API then applies the chosen queue semantics. Its synchronous return is submission only; persistence is verified separately, and an accepted streaming queue is not prematurely classified as a missing acknowledgement.

Only one outstanding follow-up per worker is admitted. Another key cannot silently replace it. Phase advancement also refuses outstanding follow-ups; an in-progress phase refuses follow-up admission. Attachment/renewal changes invalidate queued operations rather than rerouting them. Legitimate dirty/uncommitted phase progress is allowed; follow-up delivery does not require the phase transition's clean-checkpoint gate.

## Status and acknowledgements

```json
{"action":"status","id":"FOLLOWUP_ID"}
```

The operation returns promptly with a stable durable ID; don't run a long model polling loop. Reuse the **same key and same arguments/content** if submission is uncertain. A changed key for an outstanding operation conflicts; changed arguments/content under the same key are rejected without altering the original operation. Inspect the durable record/event history when needed.

- `accepted`: frozen intent published, not worker delivery.
- `queued`: receiver acknowledged waiting for the mode's safe boundary or pending/modal state; no Pi API call yet.
- `submitted`: claim retained with mode/boundary and API returned; streaming content can still be queued in Pi. This is not proof of persistence. Absence of persistence after idle becomes uncertain, never an automatic resend.
- `persisted`: exact correlated custom entry and preserved transcript prefix verified; not task completion.
- `settled`: worker run settled/aborted after the assignment, not proof scope is complete or approved. The result is retained locally and sent only through the operation's pinned binding; status exposes its correlated coordinator acknowledgement.
- `uncertain`: claimed side effect lacks sufficient proof, including interruption. Never replay.
- `rejected` / `cancelled`: no claimed delivery; evidence remains available.

Status also exposes binding validity. A stale queued operation is not deliverable merely because its last acknowledgement says queued. A report encountering revision/endpoint drift is retained, never silently sent to a different coordinator. No saved report is automatically replayed on reload.

## Bounded explicit recovery

Supply the exact observed status and a separate recovery-authorization file:

```json
{"action":"recover","id":"FOLLOWUP_ID","expectedStatus":"queued","resolution":"cancel-unclaimed","authorizationFile":"/absolute/recovery-authorization.md"}
```

Cancellation can resolve **unclaimed** work, including after the same coordinator conversation reloads. It cannot cancel/reopen a claim on the assumption that missing evidence means nondelivery. The same coordinator session/file/pane/server/worktree must still match; this is not permission to adopt another conversation.

```json
{"action":"recover","id":"FOLLOWUP_ID","expectedStatus":"uncertain","resolution":"confirm-persisted","authorizationFile":"/absolute/recovery-authorization.md"}
```

Reconciliation can confirm only the exact message/content/revision in the original transcript with its prefix intact. It cannot resend, synthesize a completed result, adopt successor epochs for execution or reroute a report. If persistence cannot be proved, retain the operation/claim and surface the blocker. A claimed operation stranded across worker runtime replacement, an uncertain settlement/report write or a stale control lock may require further separately authorized recovery tooling. Never delete a claim, edit the original receipt, force retry or create a replacement worker to hide uncertainty.

Both follow-up delivery and phase progression belong in one coordinated candidate live-acceptance pass before code review. Acceptance, candidate loading, runtime reload, real worker input and every release step remain separately controlled by Craig.
