---
name: feature-workflow
description: "Launch a new feature in a separate Stax worktree/branch and Herdr tab with a fresh Pi worker. Use for /feature, requests to start isolated feature work, or hand off a brief without implementing in the orchestrator. Supports planning/reuse investigation as an authorized phase, not implicit implementation."
---

# Isolated feature workflow

## Ownership

You are the orchestrator when launching a feature. Prepare context, launch, verify and report; **do not implement/test/build the feature in this session**, even by changing directory to its worktree. If launch fails, inspect and report; never silently take the worker's job. A separate worktree is not proof of a separate executing agent.

Use this only when Craig requests feature delegation. Require `HERDR_ENV=1`; outside Herdr stop. Read the Herdr and Stax skills before controlling them, and repository instructions before choosing the base/scope. Defaults are local `main` and `openai-codex/gpt-6-astra`; honor an explicitly requested alternative. No implicit fetch, push, commit, integration, cleanup or live app/provider/configuration changes.

## Inputs

- A lowercase slug such as `email-table` (maximum 48 characters).
- A nonempty **verbatim user brief**, including newlines, punctuation and requested phase.
- Optional separately labelled context: agreed decisions, constraints, architecture pointers, tests, unresolved questions and current workflow overrides. Do not dump the whole conversation or private credentials/data.

`/feature foo <brief>` preserves the raw brief received by the command in a private file. `/feature` asks for the name and opens a multiline editor; `/feature foo` opens the brief editor. The command asks the current agent to load this skill and perform orchestration, so it can add relevant conversation context. It does not resume/fork that conversation into the worker.

If a name/brief is already sufficient, do not ask redundant approval. If a brief says plan/investigate first, that work is authorized now; do not reduce it to acknowledgement-only, and do not broaden it to implementation. Without explicit implementation authorization, planning/reuse investigation/design is the ceiling. Phase limits are instructions, not an OS sandbox.

## Preflight

1. Inspect cwd, repository instructions, branch, dirty files and existing worktrees. Choose an existing **local integration branch**, not HEAD merely because it is current. Never stage/stash/copy uncommitted source changes to make launching easier.
2. Note any important workflow instructions present only as uncommitted edits. Put their current rules and read-only source paths in the separate context. For Zentoo specifically, main is integration; the committed develop-era workflow is obsolete, and `/home/craig/src/zentoo/docs/development-workflow.md` is currently authoritative. Preserve its and AGENTS.md's uncommitted edits.
3. By default respect Stax's configured worktree root. For repositories with relative sibling dependencies, pass `--require-sibling`. Zentoo requires this for ../icalendar-kit and already has `root_dir = ".."` in stax.toml. If that option is given and Stax produces another root, the launcher stops and reports the actual location; do not silently move it.
4. A duplicate branch/path is a blocker, not permission to attach an existing worker. Ask whether to inspect/reuse it through a separately verified manual handoff.

## Launch

For natural-language requests, use write to create the original brief in a temporary/private file without paraphrasing. Keep your synthesized context in a separate file. For `/feature`, use its supplied brief path unchanged.

```sh
feature-start foo --repo /absolute/repo --base main \
  --brief-file /absolute/brief.md --context-file /absolute/context.md
```

Omit `--context-file` if there is no extra context. The launcher also accepts `--brief-file -` (stdin). A `--provider`/`--model` pair overrides the default. Keep paths/arguments quoted; never interpolate a brief into shell commands. Allow approximately 180 seconds for startup or run the launcher as a monitored background command rather than killing it and blindly repeating it.

The launcher:
- Rechecks shared read-only repository admission (non-bare working tree, local base, no conflicts/in-progress operation, writable Git/destination, valid initialized Stax state). Dirty unrelated files are allowed. Fresh Stax repositories are not initialized during preflight.
- Serializes its own launches per Git repository.
- Creates only a new Stax branch/worktree from captured local base HEAD.
- Verifies actual branch HEAD and cleanliness (Stax's prose can mislabel origin/main).
- Creates a background Herdr tab using returned opaque IDs.
- Starts a fresh named Pi with an explicit unique session ID/model and assignment guard.
- Loads a worker bridge that reports actual Pi context/session/model and native pane/cwd/branch/HEAD, then waits for a nonce-correlated release.
- Cross-checks the worker against Herdr's detected session and foreground directory before releasing the brief.
- Delivers via `pi.sendUserMessage()`, **not terminal paste**. This bypasses the installed Vim editor's NORMAL mode; no blind `i`, Escape or Enter injection is required.
- Claims delivery once before submission. A crash/timeout has uncertain delivery, not automatic replay.
- Returns JSON with receipt, branch/worktree, agent/tab/pane/session/model and `phase: submitted`.

`submitted` means accepted by the Pi API, **not completed work or successful model response**. Inspect `herdr agent get <returned-name>` and `herdr agent read <returned-name> --source recent-unwrapped --lines 100` to confirm the worker begins the intended phase. Use bounded `agent wait` if needed. Blocked UI requires Craig's decision; never automatically answer approvals. Do not interrupt an already-working agent with a duplicate brief.

## Failure/recovery

Private run records live under `$XDG_STATE_HOME/feature-workflow` (default `~/.local/state/feature-workflow`). Each receipt identifies the last phase and known resources, including partial launches. Briefs/context are local private state, not dotfiles or tracked worktree files.

A failed command preserves created branch/worktree/tab; it never deletes, resets, stashes or retries automatically. Inspect its receipt and actual Git/Herdr state before deciding the next step. A claim without confirmed delivery is uncertain; inspect the worker's session before any manual resend. Do not restart a failed launch under a new name just to hide leftover resources. Cleanup needs user authorization except disposable resources explicitly created for tests.

Report the worker's name/tab, exact worktree/branch/model, current phase and any blocker. Keep the orchestrator free for coordination. Worker owns its subsequent authorized edits/tests/builds, with independent writable build caches. Worktrees do not isolate live config/data or sibling dependencies.

## Installation and tests

Durable code is in ~/dotfiles: skill/launcher in `agents`, Pi command/worker bridge in `pi`. Restow with `stow --dotfiles --no-folding -R agents pi`. Run `/reload` in existing Pi sessions to discover `/feature` and the skill. The bridge is explicitly loaded only into launched workers.

Read `references/design.md` for CLI options, receipt meanings and failure recovery. Read `references/popup.md` for the Herdr **Ctrl-B then f** form, model picker, installation and test commands.
