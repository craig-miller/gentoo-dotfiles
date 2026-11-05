# Per-session feature enrollment

Coordination is opt-in, not repository classification. With the extension loaded, ordinary Git/Herdr sessions and non-Git sessions have no feature registration, heartbeat or inbox-polling timer. Documentation, planning and implementation repositories follow the same rule. Feature tools remain installed; their mutation paths still require the appropriate enrolled role and exact ready reporting binding.

## Activation

- `/feature NAME BRIEF` enrolls its own coordinator after valid, non-cancelled input, before handing off orchestration. An existing registration is not a prerequisite. It cannot reclassify an enrolled worker.
- `/feature-coordinate` enrolls the current session as coordinator without starting work, creating resources beyond enrollment metadata, sending model/worker input, attaching reporting or changing focus.
- `/feature-coordinate worker /absolute/original-receipt.json` explicitly enrolls a legacy worker. Preserve the original receipt. Modern receipts must match exact launch identity; older minimal receipts must identify the exact session/file, source repository, worktree and original branch. The current Herdr endpoint is independently verified. This does not authorize a phase branch or successor session.
- Deliberate launcher `--feature-role` flags and exact launcher requests enroll their intended session, never every session in that repository. A startup request/role conflict fails closed.

Enrollment is a durable custom transcript entry bound to session ID/file, role, canonical cwd/common Git directory, Herdr pane/tab/workspace and socket lifetime. It adds no approval or release authority. The original transcript and receipts are retained. No branch, worktree, model, reporting destination or approval ceiling changes.

## Loading and migration

Installation and live reload still need separate authorization. Load the whole extension, including `enrollment.ts`; do not partially link a candidate. Existing processes do not acquire candidate behavior merely because files changed.

After an authorized safe reload:

1. Exact saved enrollment restores that session's role, with a fresh runtime epoch.
2. Before this marker exists, an exact launcher request can establish intent. A completed **current** attachment can also migrate either endpoint: verify the worker-keyed pointer, immutable receipt identity/hash, both ready/active acknowledgements and any completed phase record. Partial/superseded attachments do not qualify. Proof is rechecked before publication.
3. A bare old role marker or automatically created registry record does not qualify. Use `/feature-coordinate` in the intended coordinator, and the receipt-qualified worker command where needed. An old flag-only process lacking a request/marker also needs explicit activation on reload.
4. Discover current epochs and perform explicitly authorized reporting attachment/renewal. Enrollment never renews old reporting, adopts an old inbox or replays assignments/messages. Advanced phases use `feature_phase renew`, not generic `feature-attach`.

Herdr publishes its session identity in a separate lifecycle hook. Authorized startup enrollment runs asynchronously, with a bounded read-only identity wait, so that hook can finish. Registration/polling begin only after exact verification; lifecycle changes cancel pending enrollment. Ordinary sessions perform no such wait.

## Boundaries

- `/new` and `/fork` do not inherit enrollment, even from copied transcript entries or inherited CLI flags. `/resume` only restores proof for the exact target session and endpoint; reload cannot apply an old request to a different conversation.
- Moved/replaced panes, a changed server/socket lifetime, different worktrees or contradictory durable role records fail closed. Do not edit markers or receipts to bypass this. Successor-session transfer is outside this capability.
- There is no automatic unenrollment based on changing task/repository contents, and no same-conversation opt-out command in this slice. An opted-in conversation stays opted in; a separately user-created ordinary conversation starts unenrolled.
- Popup/CLI selection rejects registrations without matching enrollment metadata. Reload alone is not ordinary-session activation. A missing endpoint is a blocker, never permission to create replacement agents or guess another owner.
- Enrollment does not fix launcher multi-client focus behavior. Existing no-global-focus policy still applies, including hidden helper calls.
