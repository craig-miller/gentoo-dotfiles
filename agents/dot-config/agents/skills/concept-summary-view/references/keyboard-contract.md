# Keyboard and command-mode contract

This is a reusable interaction contract, not an assertion that every existing app
feature already implements it. Inspect current handlers, configuration loading and
focus precedence first. Keep product-specific command IDs, defaults and evidence
in that project's documents. Do not turn a summary-view request into an unapproved
migration of all application keyboard behavior.

## Semantic commands, three entry points

Maintain named, feature-scoped actions with eligibility and one dispatch path:

1. Native buttons/menus/pointer activation.
2. Configurable normal-mode key sequences.
3. The app's command mode, ordinarily entered with `:`.

Keys are bindings, not business logic. A command-mode alias, a remapped shortcut
and a button must resolve the same exact current target and enforce the same
capability, ownership, revision and confirmation checks. Don't impersonate another
feature's command merely because a letter or an editor bridge happens to match.
Reuse existing command presentation and parsing conventions; scope resolution so
`:edit` cannot act on a hidden list in another feature. Unknown/ambiguous commands
report an error and write nothing. Never invent a destructive bang/force path.

Freeze the command context on entering command mode (feature, pane, profile/source,
selection/identity). Invalidate it if those change; resolve current admitted record
bytes before execution. Escape cancels input without performing the command.
Native command-entry text must never invoke list mnemonics while typing.

## Default vocabulary (where the workflow supports the action)

| Keys | Intent |
| --- | --- |
| `j/k` | Next/previous list item; no wrapping |
| `gg/G` | First/last item in the current admitted ordered scope |
| Ctrl-u/d, Ctrl-b/f | Measured half/full-viewport selection motion, not fixed fake pages |
| Enter | Primary open/activate action; retain a feature's explicitly approved exception |
| `e` | Edit selected concept |
| `c` | Create a concept through the existing capture/editor workflow |
| `dd` | Request named deletion confirmation; never immediate deletion |
| `r` | Deliberate review/assessment, **only** for concepts with that workflow |
| `v` | View/toggle full description if that disclosure exists |
| `:` | Open the app's contextual command mode |
| Escape | Innermost cancellation/return to list ownership; never rollback dispatched writes |
| Tab/Shift-Tab | Native focus traversal, respecting existing picker-specific acceptance |
| Ctrl-h/l | Application pane movement where this is the app's established convention |

This is Neovim-like, not a wholesale editor emulation. Do not add `h/l` column
navigation, Space/x completion, persistent modal editing, arbitrary counts,
registers or force-deletion merely for resemblance. Readers/timelines can use
`j/k` for scrolling; preserve their documented semantics. Domain actions and
letters are contextual: review is not globally reply, and edit is not globally
archive. No area/horizon/storage/review-cadence assumptions belong in this table.

## Set up each concept's shortcuts

Do not ship a copied Area switch with renamed labels. Use this implementation
recipe for each summary concept:

1. **Inventory its actual workflow.** Write an action matrix before assigning keys:
   `stable action ID | intent | target/scope | eligibility | command aliases |
   default sequences | confirmation/repeat policy`. Separate common navigation
   from concept-specific actions. Open, edit, capture, deletion, review, completion
   or planning exist only if that concept's approved workflow supports them.
   For every domain action, decide its behavior rather than inheriting Area rules.
2. **Register semantic actions.** Reuse supported common IDs (`next`, `previous`,
   `first`, `last`, `open`, `edit`, `create`, `delete`, `command_mode`, `cancel`,
   `help`) and add descriptive stable IDs for approved domain actions. Unsupported
   actions get no misleading key/help/command entry. Preserve the common navigation/
   primary-open conventions; domain letters such as `r` or `x` are contextual, not
   universal review/completion instructions. Names and aliases may be contextual;
   current-target and confirmation rules may not be bypassed.
3. **Build one retained concept workflow/controller.** Resolve scoped selection and
   expose display eligibility plus a semantic dispatch function. Buttons, normal
   keys and parsed `:` commands call that function. Fresh dispatch reruns owner,
   membership, revision, lock and uncertainty guards even if display eligibility
   was cached. Reuse existing editors, modal ownership and mutation backends.
4. **Compose the default map.** Start from the supported navigation vocabulary
   above; add only supported common actions and approved domain mnemonics. Check
   both exact collisions and prefix conflicts against app/pane/native ownership.
   A domain action may have no default shortcut while remaining available in
   command mode or a native control; do not invent a key just to fill a table.
5. **Wire configuration end to end.** Choose a feature + concept + mode namespace,
   using the host app's conventions. Connect configuration loader/validation →
   configuration definition → runtime construction → dependencies → concept
   workflow/resolver. Provide action-ID-to-sequence-array overrides, documented
   defaults, deliberate unbinding, conflicts and effective-map hints. Do not stop
   at a YAML example that no runtime consumer reads. Keep other concepts' maps
   independent and do not alter Craig's live settings as part of implementation.
6. **Install contextual routing.** Extend the existing application keyboard owner
   for that concept's active list/pane; don't add a competing window controller.
   Reuse the app's command entry/sheet, parse common and domain aliases to the same
   IDs, freeze the entry context and restore native/list ownership safely. The
   command panel must not be reinterpreted as normal-mode input while typing.
7. **Prove equivalence and bounds.** Test each supported action via native control,
   configured key and contextual command, including concept-specific actions.
   Test missing selection, readonly/stale context, remap/unbind, collisions,
   effective hints, Cancel, repeats and no unintended writes. Do not advertise
   measured viewport paging until it measures actual viewport geometry.

Keep high-frequency selection observation separate from whole-page data/clock
updates. Retain stable scoped row state and bounded presentation caches, not an
unbounded row tree or cached write permission. Profile dispatch, native readiness
and paint separately when speed is in question; 200 ms prefix expiry is not a
reason to delay `j`, `k`, `e` or another unambiguous single-key command.

## Configuration

- Provide documented feature/mode-scoped overrides using the app's existing
  configuration provider and key syntax. Action IDs map to key-sequence arrays;
  unspecified actions keep defaults. Don't require a live config change to ship.
- Explicit mappings displace conflicting defaults. Reject duplicate explicit
  mappings and action-versus-prefix ambiguity rather than silently choosing a
  mutation. Define invalid override/empty-array behavior explicitly; prefer `[]`
  to unbind only that action's shortcuts, not disable its native/command intent.
  Preserve legacy semantics elsewhere unless migrating them is approved. Show
  actionable, non-secret diagnostics.
- Do not accept unsupported key spellings or modifiers just because parsing can
  store a string. Respect native text/control keys and reserved application pane
  keys. Keep normal/composer/command/editor namespaces distinct.
- Effective configuration is the source for tooltips, accessibility hints and
  command help. Don't leave a default-letter claim after remapping/disabling it.
- Config reload/replacement clears pending prefixes and command sessions. If only
  startup loading exists, document that honestly; don't claim hot reload.

## Input ownership and safety

Unambiguous single-key commands execute immediately. Multi-key prefixes have a
**200 ms maximum inter-key window** using a monotonic clock; it is expiry, not a
debounce or input-to-paint guarantee. Reject ambiguous prefix configurations instead
of delaying a short action. A lone prefix does nothing. Reset on intervening input,
selection/page/projection, feature/pane/profile/source/config changes, native input,
modal ownership and loss of window focus.

Text editing, popovers and dialogs own input first. Focused native controls retain
Enter/Space/Tab; row mutations cannot act on another secretly selected item while
an unrelated control owns focus. Explicit list motion may return focus to the list,
but do not add global focus/selection mirroring. Restore safe list ownership after
editor/command Cancel or success without stealing an active native editing focus.

Allow held-key repeat for movement, not writes, command submission or manufactured
`gg/dd`. Require deliberate physical presses for mutation/prefix keys and retain
in-flight gates. Clear/suppress correctly across key release, blur/refocus, pane
switches and modal transitions; don't let a held key become a fresh action in the
new context. Command-mode invocation must obey equivalent duplicate/in-flight and
uncertainty safeguards. A review never silently advances to another target.

## Test the contract

Use synthetic data and actual routed native controls. Cover default and configured
keys, disable/remap/collision/prefix errors, 200/201 ms boundaries, modifiers,
repeat/release/blur, independent native focus versus selected record, command-mode
parity and stale/unknown commands, current hints, modal restoration, no writes on
navigation/Cancel, exact bytes/targets and no automatic retry after uncertainty.
Do not claim latency or platform acceptance from parser tests or stage timings.
