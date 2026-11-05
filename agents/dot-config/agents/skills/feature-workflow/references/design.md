# Launcher interface and recovery

## Invocation

```sh
feature-start NAME --repo /path/to/repo --base main \
  --coordinator new|EPOCH --brief-file /path/to/brief.md [--context-file /path/to/context.md] \
  [--provider openai-codex --model gpt-6-astra] [--require-sibling]
```

- `--brief-file -` reads stdin. Brief/context must be nonempty UTF-8, at most 128 KiB each.
- `--list-coordinators --repo PATH` lists compatible live registrations read-only; choose an exact session/epoch.
- New coordinator defaults independently to `openai-codex/gpt-6-astra`; `--coordinator-provider`/`--coordinator-model` override it.
- `--origin-pane ID` pins a popup's originating pane instead of using caller context.
- Stax chooses the worktree location. `--require-sibling` additionally requires `../<source-checkout-name>-<NAME>`; use it for repositories with sibling dependencies, including Zentoo.
- The launcher does not fetch, stage, stash or copy uncommitted source changes. It refuses existing branches/paths rather than reusing them.

## Result

Successful JSON includes `receipt`, `phase`, `cwd`, `branch`, `session`, `provider`, `model`, `agent_name`, `pane` and `tab` for the worker, plus `coordinator` and `coordinator_handoff`. The launcher focuses the reverified coordinator tab, not the worker.

`phase: submitted` means the verified worker accepted the brief through Pi's API, not that implementation or even a model response succeeded. Inspect the returned agent using Herdr. The brief's authorized phase and approval requirements still apply.

## Delivery and recovery

Run records are private directories under `$XDG_STATE_HOME/feature-workflow`, defaulting to `~/.local/state/feature-workflow`.

| File | Meaning |
| --- | --- |
| `receipt.json` | Last launch phase and known resources; start here after failure. |
| `request.json` | Assignment, exact brief/context and expected worker identity. |
| `ready.json` | Identity reported by the worker; checked against Git and Herdr. |
| `release.json` | Nonce-correlated permission to deliver the brief. |
| `claimed.json` | Delivery claimed once; its presence prevents automatic replay. |
| `delivery.json` | Pi API submission result, not task completion. |
| `coordinator/` | Fresh coordinator startup identity/request, if requested. |
| `last-report.json` | Latest settled worker response, retained if routing fails. |

Only explicitly enrolled sessions publish `sessions/<epoch>.json`, with one-second heartbeats and a ten-second freshness limit. Ordinary sessions have no registration or inbox timer. Eligible startup/reload/resume creates a fresh epoch; shutdown marks the old one inactive. New/fork sessions do not inherit enrollment. Compatibility uses real Git common-directory paths plus the live Herdr session file/pane and canonical socket path/device/inode/ctime-nanoseconds. Socket replacement invalidates old registrations even at the same path; colliding pane IDs in other Herdr instances cannot match. The ID/file come from Pi's actual session context and Herdr integration; persisted JSONL headers are cross-checked when present (Pi can defer creating the file until its first message). Registration makes a coordinator session selectable; ownership is only the feature receipt's explicit relationship. Implementation workers carry deliberate launcher intent and an identity-bound durable enrollment marker and are excluded from coordinator selection. Legacy launcher processes are identified by their exact startup request matched to the actual session. Old automatic registrations and bare role markers are not enrollment; missing enrollment requires explicit activation, not reload alone. Verified completed current attachments can migrate exact endpoint intent without renewing reporting. See [enrollment and migration](enrollment.md).

`inbox/<epoch>/*.request.json` messages correlate feature, destination session/epoch and worker identity. The receiver validates the relationship and its live pane, writes an exclusive claim before API submission, then writes `*.ack.json`. `queued` means busy/UI-blocked deferral; `submitted` means API acceptance; `rejected` and `uncertain` require inspection. Status uses custom messages, not human-authored approvals. Messages are timestamp-ordered and never steal focus. Old-epoch queues are not adopted after reload/resume/fork; explicit reselection/recovery is required. Claims and receipts are same-user workflow safety, not a hostile-process sandbox.

After failure, inspect the receipt and actual worker before retrying. A claim without confirmed delivery is uncertain: do not resend, create a replacement under another name, or delete resources automatically. Cleanup requires authorization.

Worktrees and identity checks are not an OS sandbox. Live configuration and sibling dependencies remain shared; keep build caches independently writable.
