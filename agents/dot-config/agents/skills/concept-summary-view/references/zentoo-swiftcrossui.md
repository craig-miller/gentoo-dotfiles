# Zentoo / SwiftCrossUI reference

These are implementation pointers, not authority to reuse Area business rules.
Resolve repository paths below against the current Zentoo checkout (normally
`/home/craig/src/email`); inspect current files rather than assuming this snapshot
is unchanged. Do not copy personal screenshots/data into fixtures or this skill.

## Contracts first

Read `AGENTS.md`, `ARCHITECTURE.md`, `docs/development-workflow.md` and
`docs/frontend-workflow-principles.md`. For task-backed concepts, also read
`docs/vtodo-types.md` and the applicable product document.

The original example is the Dashboard Area list. Current product/layout decisions
and validation live in `docs/review-area-cards.md`; page composition lives in
`docs/dashboard-and-vision.md`. The filename's "cards" is historical, not an
instruction to render new cards. Concept identity uses CONCEPT; row presentation
never retypes records. Other concepts need their own metric/action contract.
For keyboard changes read `docs/dashboard-areas-keyboard-plan.md` and
`docs/dashboard-area-commands.md`; the generic contract is
`references/keyboard-contract.md` relative to this skill's root. Existing features
have different current keymap support; do not claim the new Area contract has
already migrated Email, Tasks or Calendar. Read
[the reusable header/spacing blueprint](table-layout.md) for the current visual
structure, not the superseded title-fills-all-spare-width behavior.

## Current header and spacing example

The Area header has two levels: Active and Someday/Maybe group captions above
their Projects/Tasks leaves. **Area, Overdue and Review sit on the lower level**.
Edit and Mark Reviewed are no longer columns; their mutations live in one selected
bottom bar. `ReviewAreaTableHeader` bottom-aligns its
outer `HStack`; grouped `VStack`s use a 2-point level gap. Do not vertically center
the standalone headings across both levels or copy a measured offset.

`ReviewAreaTableLayout.titleWidth(in:)` caps the desktop title at **280 points**
and reserves non-title cells, all gaps, 12-point side insets and the 5-point
attention edge before shrinking. The list passes each real proposal to the header
and row; both append trailing flexible space after Review data. Row surfaces and
notes still span the pane. Current example widths are count 72, Overdue 184,
Review 88 and column gaps 8; obsolete action widths are not reserved in the table.
Header attention-edge space
is transparent. Narrow labelled details replace columns below the existing
850-point Area breakpoint. These measurements illustrate the proven arrangement;
other concepts choose their own actual columns/captions and fit breakpoint.

Native evidence is in `AreaListNativeTests`: title-to-Overdue **column** edge,
constant wide-screen positions, two header levels including standalone captions,
row/header centers, narrow/resize-back and actual five-digit text width. See
`docs/review-area-cards.md` (bounded title and header level) and the newer
`docs/dashboard-area-action-bar.md` for current product decisions.

The bottom bar is `Area name [+] [−] [clock/check] [pencil] <spacer>`. Natural-width
name (up to 280) and 8-point gaps keep every control left-aligned. Review/Edit are
44×32 icon buttons with effective tooltips; Minus is normal foreground, not red.
The visible name has no “Selected:” prefix or collection suffix; source identity
remains in accessible control labels and frozen-target admission.
It is outside the data scroller, observes selection independently, disables target
mutations without selection, preserves configured `c/dd/e/r`, and revalidates its
frozen profile/data/selection-transition/record context before fresh dispatch.
Pointer row/title activation now selects; Enter/`:open` navigates to filtered Tasks.

## Small existing implementation seams

- `Sources/email/View/Review/ReviewSurface.swift`: workflow page composition,
  separate from the vocabulary of persisted types.
- `ReviewFeatureHost.swift` in the same directory: observes shared store/session/
  editor, supplies profile-guarded actions and existing shared image loader.
- `ReviewAreaListView.swift`: explicit native layout, bounded row page, stable
  TaskID-keyed nodes and real-proposal remeasurement at commit. Header visibility
  participates in native child insertion/removal and layout results.
- `ReviewAreaTableLayout.swift` and `ReviewAreaTableHeader.swift`: shared capped
  title width, lower-level standalone headings, grouped captions, trailing spare
  space and centered data cells, with mutation controls outside the table.
  Treat the particular columns and breakpoints as example values, not a template
  to duplicate unchanged.
- `ReviewAreaCardView.swift`: despite its historical name, the shared renderer
  includes flat list rows and narrow labelled details. Current data cells are
  text/numeric and routed list rows have no edit/review controls. Pointer activation
  selects; full-text disclosure remains native. Bar review tint uses the selected
  record's same semantic warning role.
- `ReviewAreaActionBar.swift` and `ReviewAreaWorkflow+SelectionActions.swift`:
  actual-proposal responsive bar, name-only caption, source-aware accessible sibling
  controls and frozen-target admission. No selection mirroring into Tasks or
  per-selection whole-table rebuild. `AreaActionBarNativeTests` and
  `AreaActionBarContextTests` cover placement, pointer selection, targets,
  readonly/ABA/context/lock safety, tints and consent-only Minus.
- `ReviewAreaMetricsView.swift`: named count descriptions, table cells and narrow
  labels. `ReviewMarkReviewedIcon.swift` shows a theme-aware native icon action.
- `ReviewGtkAreaNavigation.swift`: controller installed once, current callback
  rebound on update, pointer navigation skips native controls/descendants.
- `Sources/email/Review/ReviewAreaCommand.swift`, `ReviewAreaWorkflow*.swift`:
  semantic registry, one guarded action owner, configurable default resolver and
  contextual command sessions. `Configuration/ReviewAreaKeymapLoader.swift` under
  `Sources/email/` loads startup overrides without changing live configuration.
  Native controls, shortcuts and commands reuse the same eligibility/dispatch.
  The current namespace is `dashboard.areas.keybindings.normal`; this does not
  prove another concept's namespace exists. For a new concept, follow the generic
  action-matrix/setup recipe and wire its supported IDs through the whole loader/
  runtime/dependency/workflow/router chain before documenting its configuration.
- `ReviewAreaCommandPanel.swift` / `ReviewAreaModalHost.swift` in the Review view
  directory: reuse the app's command entry and existing shell sheet. Native key
  release/repeat observation crosses command/editor windows without a competing
  normal-mode dispatcher. Keep modal ownership and exact-target guards intact.
- `ReviewAreaPresentationModel.swift` / `ReviewAreaViewState.swift` under
  `Sources/email/Review/`: page/data and row-local selection observation. The
  snapshot/summary/display-availability caches avoid repeated layout-time work;
  `ReviewAreaWorkflow.perform` always reruns fresh dispatch admission. Read
  `docs/dashboard-areas-responsiveness.md` before changing those boundaries;
  native-readiness timings are not visible-frame or Email-parity guarantees.
- `Sources/email/Review/ReviewAreaActions+Factory.swift`: captured-profile/current
  record/owner gates and explicit writes through the existing task store. No
  implicit review on navigation, and no automatic retry after uncertainty.

Do not give Email direct mail-provider access or account SQLite writes: those are
owned solely by jmapsyncd. Task-backed mutations must keep their established fresh
owner/UID/resource-revision admission and byte-preserving backend path. Reusing a
visual pattern is not permission to copy its stored X-properties to another type.

## Native testing and acceptance

Existing examples in `Tests/emailTests/Review/`:

- `AreaListNativeTests.swift`: actual routed list/columns, independent header/data
  center and gap oracles, scoped palette color checks, action targets/current
  callbacks, natural large-number widths and unchanged source bytes.
- `CompactAreaCardNativeTests.swift`: first-probe/resize/narrow detail geometry;
  the historical test name does not override the current list presentation.
- `DashboardVisionNavigationTests.swift`: real page routing and profile isolation.
- `ReviewAreaCardNativeTests.swift`, `ReviewEditIconNativeTests.swift`: sibling
  controls, accessible glyphs, editor/cadence/Cancel and current callbacks.

Typical local commands (select the tests relevant to the new feature):

```sh
GSK_RENDERER=cairo EMAIL_TEST_GTK_CONTROLS=1 SCUI_DEFAULT_BACKEND=GtkBackend \
  swift test -j 4 --no-parallel --filter 'AreaListNativeTests|ReviewAreaCardNativeTests'
SCUI_DEFAULT_BACKEND=GtkBackend swift test -j 4 --no-parallel
SCUI_DEFAULT_BACKEND=GtkBackend swift build -c release -j 4
Scripts/check-source-size
Scripts/test-source-size-check
git diff --check
```

Prefer synthetic hidden native widget graphs. Real compositor geometry may need a
short-lived synthetic window; that is not permission to launch/input the live app.
Do not claim AppKit acceptance from Linux tests, or latency/RSS guarantees from
stage timings. Respect the repository's current local dependency/branch rules;
this skill neither pins dependencies nor authorizes publication or integration.
