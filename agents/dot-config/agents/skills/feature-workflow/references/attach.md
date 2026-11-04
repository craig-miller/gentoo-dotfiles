# Attach reporting to existing sessions

Reporting attachment is explicit and separate from assignment delivery. It creates no session, branch or worktree, edits no launch receipt, replays no brief/report and grants no permissions. Dirty trees and commits after the launch HEAD are allowed; the actual branch/worktree and repository must still match the receipt. Existing conversations and later explicit approvals remain authoritative: attachment neither resets them to the original launch phase nor broadens them.

## Procedure

1. Install the current extension (including `attachment.ts`) through the separately authorized configuration workflow. Temporary per-file candidate links must include this new helper **before any reload/new launch**; the prior four-file link set is insufficient. Have the user `/reload` **both endpoints when safe/idle**; never interrupt a working agent or inject reload input. Legacy workers are recognized from their exact startup request and receive a durable worker-role marker. An unregistered/outdated endpoint is a blocker, not a reason to recreate it.
2. From the same Herdr instance, inspect live identities:

   ```sh
   feature-attach --list-workers --repo /absolute/source
   feature-start --list-coordinators --repo /absolute/source
   ```

   Match the intended actual session/file, pane, worktree and role. Use the returned **current epochs**, never pane IDs or focus alone.
3. Attach using the original launch receipt:

   ```sh
   feature-attach /absolute/launch/receipt.json \
     --worker WORKER_EPOCH --coordinator COORDINATOR_EPOCH
   ```

   Before installation, run the candidate's `agents/dot-local/bin/feature-attach` by absolute path. Do not restow a feature worktree over live configuration.
4. Check JSON `ok: true`, `status: ready`, destination and `revision`. Both endpoints must acknowledge preparation and activation. Metadata agreement can occur while busy; reports queue without terminal input or interruption. Only **future settled worker responses** are forwarded. Coordinator receipt is API acceptance, not model completion or Craig's approval.

## Reload, rebind and uncertain outcomes

A reload/resume/fork invalidates the old endpoint epoch; it never replays the assignment or adopts old messages. For the same worker session after reload, discover fresh epochs and renew explicitly:

```sh
feature-attach /absolute/launch/receipt.json \
  --worker CURRENT_WORKER_EPOCH --coordinator CURRENT_COORDINATOR_EPOCH \
  --replace PREVIOUS_REVISION
```

The same command rebinds to another explicitly selected compatible coordinator. A fork/new session cannot impersonate the receipt's original worker. No old report is automatically resent.

The returned request directory is the audit record: immutable `request.json`, per-endpoint `prepared-*.json` and `active-*.json` acknowledgements/claims, `commit.json`, `ready.json`, and `result.json`. A private per-worker `current.json` points to the selected revision; `last-report.json` retains the latest response if delivery is deferred. The original launch receipt remains unchanged.

Pending/failed/uncertain revisions pause the old reporting route. Missing acknowledgement is **not ready** and is not silently retried. Inspect both actual endpoints and the transaction files, then use an explicit `--replace` with that attempt's revision if recovery is approved. Superseded revisions and old-epoch messages are rejected, including already queued messages that have not been delivered. Already delivered conversation messages are not retracted.

This slice has no saved-report resend operation. Read a retained report for review; forwarding it is a separate explicit action. Do not treat rebind as implementation/commit/merge/push/cleanup approval.
