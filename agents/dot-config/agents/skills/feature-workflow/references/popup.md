# Herdr feature popup

**Ctrl-B, then f** opens the form for the originating pane's repository. It requires a non-bare working tree, a committed local `main`, usable Git/Stax state and installed Git/Stax/Herdr/Pi. Ordinary dirty files are allowed. Incompatible origins show only an error; Enter dismisses it without creating feature resources.

## Controls

| Key | Action |
| --- | --- |
| Tab / Shift-Tab | Switch between Name and Brief. |
| Enter in Brief | Insert a newline; never launch. |
| Ctrl-P | Open the model picker. Type to fuzzy-search provider/model IDs; arrows or Page Up/Down select, Enter accepts, Escape cancels. |
| Ctrl-O | Choose New session or a compatible registered Existing coordinator. Escape keeps the prior choice. |
| Ctrl-S | Revalidate and launch. |
| Escape | Cancel before launch, or close a failed-launch form. |

Model selection applies only to this launch; new forms default to `openai-codex/gpt-6-astra`. Discovery uses `pi --list-models --no-session` in the source repository. It honors `PI_CODING_AGENT_DIR`, falling back to `~/.config/pi` because popup processes do not load Fish configuration. Discovery failure leaves the draft and selected model unchanged.

The form inherits the terminal's Noctalia palette. Reopen it after updating its code. The outer border belongs to Herdr.

## Launch behavior

The popup freezes the originating pane and directory, preserves the multiline brief, and calls the shared launcher with explicit origin/provider/model arguments. A planning brief authorizes planning, not implementation.

The default is the compatible registered coordinator occupying the exact invoking pane, captured before the form opens. Registration must match the invoking Herdr socket/server lifetime, actual Pi session/file, epoch and Git common directory. Later focus changes never redirect it. Shell and implementation-worker origins default to New session; workers are never offered as coordinators.

An unenrolled Pi origin shows `/feature-coordinate` activation guidance. Separately authorized loading/reload may be needed for an old extension, but reload alone does not enroll an ordinary session. Explicitly activate that coordinator and reopen the form, or use Ctrl-O to explicitly choose New session/another compatible coordinator. Cancellation preserves the prior selection. Existing choices show their destination session/tab; stale/replaced/closed choices block submission rather than falling back. New coordinator model remains `openai-codex/gpt-6-astra`, independent of the worker picker.

After verified submission it focuses the coordinator tab and closes. Submission is not task completion. A failure keeps the draft and receipt visible and disables repeated submission; inspect existing resources before retrying. See [launcher recovery](design.md).

## Install and check

```sh
cd ~/dotfiles
stow --dotfiles --no-folding -R agents pi herdr
# Only after changing Herdr configuration:
herdr server reload-config
# Regression tests (no desktop windows):
python3 -B -m unittest discover -s .tests/feature-workflow -p 'test_*.py' -v
bun test ./.tests/feature-workflow/feature.test.ts ./.tests/feature-workflow/coordination.test.ts ./.tests/feature-workflow/attachment.test.ts
# Real Herdr/Pi mechanics with a deterministic offline fixture provider:
python3 -B .tests/feature-workflow/herdr_coordinator_smoke.py
python3 -B .tests/feature-workflow/herdr_coordinator_smoke.py --attachment
# Optional isolated Herdr UI check; no worker/model request:
python3 -B .tests/feature-workflow/herdr_popup_smoke.py --ui-only
```

Omitting `--ui-only` from the smoke test also creates a disposable feature worker and makes a model request. Run that deliberately, not as an automatic UI check.
