---
name: feature-workflow
description: "Launch isolated Stax/Herdr/Pi feature work with an explicit coordinator. Use for /feature, natural-language delegation, and planning/reuse investigation without implementing in the orchestrator."
---

# Isolated feature workflow

## Ownership and scope

The coordinator prepares context, launches, verifies and reports; **never implement/test/build the delegated feature in the coordinator session**, even by changing directory. A separate worktree is not proof of an independent agent. Startup failure does not authorize taking over.

Use only when Craig requests delegation. Require `HERDR_ENV=1`; read the Herdr/Stax skills and repository instructions. Local `main` and `openai-codex/gpt-6-astra` are defaults, not overrides of explicit choices. No inferred commit, merge, push, fetch, cleanup, live app/provider input or configuration permission.

Preserve the **verbatim brief** in a private UTF-8 file. Put agreed decisions, constraints, tests and current workflow overrides in a separate context file. Planning/investigation authorizes that work now, not implementation or acknowledgement-only waiting.

## Coordinator selection

- `/feature NAME BRIEF` saves the multiline brief and supplies this session's explicit registration epoch. Use that epoch; never create a second coordinator.
- For natural-language delegation from this session, run `feature-start --list-coordinators --repo /absolute/repo`. Select the registration matching your **own `PI_SESSION_ID` and session file**, not the focused tab. If missing, report the blocker; an existing session may need a user-authorized `/reload` after integration.
- Use `--coordinator new` only when a new control conversation is intended. It creates a coordinator in the source checkout and one independent worker. Coordinator model defaults independently to `openai-codex/gpt-6-astra`; override with `--coordinator-provider`/`--coordinator-model`.
- Ctrl-B then f preselects the compatible registered coordinator in the exact invoking pane/Herdr instance, captured before the form. Shell/worker origins default to New; unregistered Pi origins show `/reload` guidance and require explicit selection instead of guessing another conversation.
- Existing coordinators must share the canonical Git common directory and verified socket/server lifetime. A stale/closed/reloaded/replaced session requires explicit reselection. No repository-wide permanent owner or silent fallback.

## Launch

Inspect the source branch, dirty files, instructions and existing worktrees read-only. Choose an existing local integration branch. Never copy/stash/stage dirty source files. Carry important uncommitted workflow rules as separate context and read-only source paths.

```sh
feature-start NAME --repo /absolute/repo --base main \
  --coordinator EPOCH --brief-file /absolute/brief.md \
  --context-file /absolute/context.md
```

Omit context if unnecessary; `--brief-file -` accepts stdin. `--provider`/`--model` select the worker. Require lowercase hyphenated names (maximum 48 characters). Use `--require-sibling` for relative sibling dependencies; Stax must then create `../<repo>-<name>`. Duplicate branches/paths are blockers, never implicit reuse. Allow several minutes for two-session startup rather than killing and repeating it.

The launcher verifies Git, fresh worker/session/model and Herdr identities, records ownership, obtains the coordinator inbox acknowledgement, then releases the worker brief through Pi's API. No terminal prompt pasting or Vim mode manipulation. It focuses the coordinator only after verified submission. Subsequent worker reports never change focus.

## Existing worker reporting

Use `feature-attach RECEIPT --worker EPOCH --coordinator EPOCH` to attach reporting without recreating sessions/worktrees or replaying work. Both endpoints need the current extension and user-controlled `/reload` when safe; never interrupt an implementing worker. Rebind/renewal requires `--replace PREVIOUS_REVISION`. See the short [attach procedure and recovery](references/attach.md).

## Results and recovery

`submitted` is API acceptance, not model completion. `queued` is receiver acknowledgement while busy, not delivered conversation content. Worker settled responses are forwarded as **agent status, never Craig's approval**. Inspect the receipt and correlated acknowledgement files for readiness/blockers/requests.

Claims precede delivery. A crash, missing acknowledgement or uncertain result must not be replayed automatically. Partial branches/worktrees/tabs remain inspectable. Do not rename/retry to hide failures; do not remove resources without authorization. Worktrees are not a sandbox: live configuration, data and sibling dependencies remain shared.

See [launcher interface/recovery](references/design.md) and [Ctrl-B then f popup](references/popup.md). Installation requires separately authorized restowing of `agents pi` (and `herdr` if changed), then user-controlled `/reload` in existing Pi sessions. Never restow a feature worktree over the live checkout.
