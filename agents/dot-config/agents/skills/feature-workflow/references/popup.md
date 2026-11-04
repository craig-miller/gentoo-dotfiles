# Herdr feature popup

**Ctrl-B, then f** opens the form for the originating pane's repository. It requires a non-bare working tree, a committed local `main`, usable Git/Stax state and installed Git/Stax/Herdr/Pi. Ordinary dirty files are allowed. Incompatible origins show only an error; Enter dismisses it without creating feature resources.

## Controls

| Key | Action |
| --- | --- |
| Tab / Shift-Tab | Switch between Name and Brief. |
| Enter in Brief | Insert a newline; never launch. |
| Ctrl-P | Open the model picker. Type to fuzzy-search provider/model IDs; arrows or Page Up/Down select, Enter accepts, Escape cancels. |
| Ctrl-S | Revalidate and launch. |
| Escape | Cancel before launch, or close a failed-launch form. |

Model selection applies only to this launch; new forms default to `openai-codex/gpt-6-astra`. Discovery uses `pi --list-models --no-session` in the source repository. It honors `PI_CODING_AGENT_DIR`, falling back to `~/.config/pi` because popup processes do not load Fish configuration. Discovery failure leaves the draft and selected model unchanged.

The form inherits the terminal's Noctalia palette. Reopen it after updating its code. The outer border belongs to Herdr.

## Launch behavior

The popup freezes the originating pane and directory, preserves the multiline brief, and calls the shared launcher with explicit origin/provider/model arguments. A planning brief authorizes planning, not implementation.

After verified submission it focuses the worker tab and closes. Submission is not task completion. A failure keeps the draft and receipt visible and disables repeated submission; inspect existing resources before retrying. See [launcher recovery](design.md).

## Install and check

```sh
cd ~/dotfiles
stow --dotfiles --no-folding -R agents pi herdr
# Only after changing Herdr configuration:
herdr server reload-config
# Regression tests (no desktop windows):
python3 -B -m unittest discover -s .tests/feature-workflow -p 'test_*.py' -v
bun test ./.tests/feature-workflow/feature.test.ts
# Optional isolated Herdr UI check; no worker/model request:
python3 -B .tests/feature-workflow/herdr_popup_smoke.py --ui-only
```

Omitting `--ui-only` from the smoke test also creates a disposable feature worker and makes a model request. Run that deliberately, not as an automatic UI check.
