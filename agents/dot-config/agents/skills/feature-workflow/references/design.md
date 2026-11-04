# Launcher interface and recovery

## Invocation

```sh
feature-start NAME --repo /path/to/repo --base main \
  --brief-file /path/to/brief.md [--context-file /path/to/context.md] \
  [--provider openai-codex --model gpt-6-astra] [--require-sibling]
```

- `--brief-file -` reads stdin. Brief/context must be nonempty UTF-8, at most 128 KiB each.
- `--origin-pane ID` pins a popup's originating pane instead of using caller context.
- Stax chooses the worktree location. `--require-sibling` additionally requires `../<source-checkout-name>-<NAME>`; use it for repositories with sibling dependencies, including Zentoo.
- The launcher does not fetch, stage, stash or copy uncommitted source changes. It refuses existing branches/paths rather than reusing them.

## Result

Successful JSON includes `receipt`, `phase`, `cwd`, `branch`, `session`, `provider`, `model`, `agent_name`, `pane` and `tab`.

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

After failure, inspect the receipt and actual worker before retrying. A claim without confirmed delivery is uncertain: do not resend, create a replacement under another name, or delete resources automatically. Cleanup requires authorization.

Worktrees and identity checks are not an OS sandbox. Live configuration and sibling dependencies remain shared; keep build caches independently writable.
