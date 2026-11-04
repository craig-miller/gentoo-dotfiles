# Frozen feature reviews

`tuicr-review.ts` is the **only** discovery entry point. Both the `feature_review`
tool and `/review` use `Reviews` in `lifecycle.ts`. No wrapper/skill installation,
coordinator changes, source staging, commits, pushes or cleanup are performed.

## Interface

```json
{"action":"open","repo":"/absolute/git/root","base":"main","paths":["src/changed.ts","src/new.ts"],"requestKey":"feature-review-1"}
{"action":"status","id":"REVIEW-UUID"}
{"action":"feedback","id":"REVIEW-UUID"}
{"action":"verify","id":"REVIEW-UUID"}
{"action":"close","id":"REVIEW-UUID"}
```

The same JSON follows `/review`. Retrieval also accepts `/review status ID`,
`feedback ID`, `verify ID` or `close ID`. The old implicit whole-checkout scan and
`-r` interface are intentionally replaced: **scope must be explicit**.

- `open`: compare selected **current filesystem contents** against an explicit
  local base commit/ref. Include new files explicitly. Returns after bounded
  preparation/launch, not after human review: durable UUID, SHA-256 snapshot
  identity, file count and launch state. It opens/focuses a separate Herdr tab.
- Reuse the same `requestKey` for retries. A changed scope with the same key is
  rejected. Concurrent overlapping scopes in the same checkout are rejected
  while a review is active or its launch is uncertain. Disjoint reviews work.
- `status` / `feedback`: usable by ID after reload/interruption, without rebinding
  delivery ownership. Explicit reads recover saved private tuicr data when the
  runner was interrupted. `progress.reviewed: null` means unknown, never zero.
- `verify`: rehash selected source bytes/modes, source HEAD/common directory and
  frozen contents/index/HEAD. `readyForApprovalRequest` requires a completed
  review and no drift/tampering. This is a point-in-time check, **not approval**.
- `close`: only the exact invoking conversation/pane/server can request the
  runner to cancel and close itself. A missing/finished runner never authorizes
  closing a possibly repurposed pane. Nothing is deleted.

## Safety and supported scope

Requires Linux `/proc`, Node, Git, Herdr, tuicr, and persistent interactive/RPC Pi
with working Herdr Pi session reporting. No print-mode autonomous monitoring.
Only regular UTF-8 files: at most 128 paths, 2 MiB each and 32 MiB combined old/new
contents. Symlinks (including ancestors), nested repositories/submodules,
directories, binary/non-UTF-8 files, `.git`, `.gitattributes`, traversal/control
characters and unchanged selections are explicitly rejected. Executable modes
and deletions are retained. Select **both** old/new paths for renames; snapshots
represent them as deletion/addition, with rename inference disabled. A tuicr
file-count mismatch fails closed, never declares a partial snapshot complete.

Only selected base blobs and selected current bytes enter the isolated Git
repository; even unrelated *base* files are absent. Synthetic baseline objects
exist only in that repository. No source index/worktree writes or hooks/filters.
Every ancestor is opened no-follow through a pinned directory descriptor.
Capture is double-checked but is not a multi-file filesystem transaction: keep
scoped writers idle during capture and verify again before commit approval.
The SHA-256 identity binds base, path/content/mode manifest and frozen Git trees;
receipts are same-user private state, not a hostile-user tamper-proof archive.

## Lifecycle and delivery

State lives under `$XDG_STATE_HOME/feature-workflow/reviews/`, defaulting to
`~/.local/state/feature-workflow/reviews/` (directories 0700, receipts 0600).
Each UUID retains `manifest.json`, `snapshot/`, copied standalone `runner.mjs`,
launch/runner/origin receipts, `return-focus.json`, `close.json`, private tuicr
`data/`, `session.json`, `feedback.json`,
`export.md`, exit summary, completion, verification and delivery receipts.
Old manual-review directories are evidence, not lifecycle records to adopt.

Review states distinguish `preparing`, `opening`, `running`, `launch_uncertain`,
`completed`, `incomplete`, `cancelled` and `failed`. Without a terminal receipt,
`lastKnown: true` explicitly means saved evidence, not current UI-liveness proof.
All-reviewed/zero-comments is completed. An untouched `:q` can have no saved tuicr session: its positive
0/N exit summary proves an incomplete review. Missing evidence is unknown/error.
Cancellation remains cancellation even when saved reviewed marks exist.

While Pi is alive, a nonblocking timer observes owned reviews. Completion waits
while Pi is busy or a dialog is open, then calls `sendMessage(triggerTurn: true)`
to start a real turn in the invoking conversation. Delivery states are separate:

- `pending` / `queued`: not submitted; waiting for completion or idle.
- `claimed`: irreversible send reservation written before the API call.
- `submitted`: API acknowledged, not proof of conversation delivery.
- `delivered`: matching custom message actually persisted in that conversation;
  **not** proof of model completion, agreement or human approval.
- `uncertain` / `blocked`: inspect and retrieve explicitly; never automatically
  replay a claimed report or rebind to another conversation/pane/server.

Reload/resume in the exact same session/file/pane/Herdr instance resumes
unclaimed work. Forks, other panes and replacement servers never inherit delivery.
If Pi is shut down, the runner still retains feedback; reporting waits for a
matching resume. A stale launch lock or uncertain creation is an explicit manual
recovery case: inspect receipts and owned resources, don't retry with a new key
or delete claims. A source-changed fix requires a new reviewed snapshot.

The runner verifies server lifetime, pane/terminal/tab/workspace and its shell
PID before close. It closes **only its own pane**, not an entire possibly expanded
tab. At startup it pins the exact invoking Pi's terminal from Herdr, using the
manifest's session file, pane, tab and workspace (never repo/name/tab order).
Before returning focus it verifies the Pi session-header ID, both live endpoints,
and global review focus twice. Validation taking over 1.5 seconds skips return.
Observed navigation elsewhere, a closed/replaced/moved origin, or an unavailable
session header skips return. A virgin Pi session whose header is not yet persisted
also fails safe. Moved/replaced review identities receive no explicit focus or
close request; Herdr still owns normal process-exit behavior. Ownership is checked
again after focus acknowledgement before closing. Requests are never retried or
undone; uncertain acknowledgements are recorded as uncertain, not successful.

**Residual race / strict-safety blocker:** installed Herdr 0.9.0, protocol 22,
provides unconditional `tab.focus` and `pane.close`, with no conditional focus,
identity precondition or transactional close-and-return. The bounded checks above
cannot stop navigation/replacement *after the final snapshot* racing the focus
request. The 1.5-second validation limit is not an atomicity or server-execution
bound. `return-focus.json` explicitly records `atomic: false`; `acknowledged`
means API acceptance, not proof no race happened. This is best-effort return,
not a strict no-focus-stealing guarantee. Strict safety requires a Herdr-side
atomic close-and-return operation checking the expected focused review, owned
terminal and exact origin session/pane/terminal/tab under the same state lock.
No Herdr implementation change is included here.

## Integration and acceptance

Do not restow this worktree. After separately approved reconciliation/integration,
installation is the normal source-checkout `stow --dotfiles --no-folding -R pi`,
then user-controlled `/reload` in relevant Pi sessions. For this runner-only
return-to-origin fix, already-loaded callers read/copy `runner.mjs` from disk on
each **new** open, so temporary per-file candidate links can exercise the fix
without reload. Existing copied runners remain unchanged and independent. The
worker does not install, restow, reload or control live sessions.

**Untracked source collision:** `/home/craig/dotfiles/pi/dot-config/pi/extensions/tuicr-review.ts`
was inspected read-only, SHA-256
`ad1db82071ea56ee92c0481734f9faea384b5783a0b0865fed4e6d9531ada311`.
Its sibling `tuicr-review/targets.ts` was inspected read-only, SHA-256
`6cc9e5bf5b98d45123611a81a673f5587736b98563a47b7376d43af15cb15647`.
The new entry point conflicts with that untracked file: reconcile with Craig,
never force-overwrite. `targets.ts` and the untracked tuicr skill are neither
copied nor modified. Shared instance identity/state-root helpers are reused from
committed `feature-workflow/protocol.ts`; its protocol is unchanged.

See `.tests/tuicr-review/README.md` for isolated validation. Human live acceptance,
review, installation, commit/integration, push and feature cleanup remain separate
authorization gates.
