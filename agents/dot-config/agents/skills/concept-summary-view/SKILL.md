---
name: concept-summary-view
description: "Design, build, or refine compact workflow-oriented summary lists and grouped tables for concepts such as Areas, Projects, initiatives, or responsibilities. Use for concept dashboards with counts, attention/status signals, review or edit actions, shared column alignment, responsive layouts, configurable Neovim-like shortcuts, app command-mode integration, and native UI regression tests."
---

# Concept summary views

Build a view that helps Craig decide and act, not a CRUD screen dictated by a data type.
Use this pattern for comparable concept summaries; do not force prose, image boards,
inspectors or execution screens into a table merely because they share a backend.

For Zentoo/SwiftCrossUI implementation, also read
[the implementation reference](references/zentoo-swiftcrossui.md). Product rules
remain in the repository's dedicated contracts, not this skill.

## 1. Establish the workflow and data contract

- Read repository instructions, architecture, workflow and relevant concept specs.
  Preserve unrelated work. Follow the project's branch/approval rules.
- Identify the decision the user makes here, what opening a row does, the important
  signals, and which explicit actions belong on the view. Ask only for genuinely
  unresolved product choices; inspect code/screenshots before proposing new ones.
- Define identity and scope: active profile/account, actual source/list, stable
  record identity, ownership, revision and permitted operations. Reuse the shared
  stores, projections, caches and editor; do not create a backend per row/page.
- Define each count precisely, including closed/deferred/unknown records, nested
  work and duplicate identities. Avoid double-counting containers as tasks.
  Distinguish zero from unknown/loading. Derive from the complete admitted scope,
  not just visible rows, a selected ribbon or collapsed descendants.
- Type, hierarchy, priority, status, ordering and focus are separate dimensions.
  Do not infer type from child count or make ongoing responsibilities completable
  just because they are displayed in rows.
- Do not copy Area-specific policies into another concept: weekly reviews,
  PRIORITY:9, PARENT membership, metrics and stored review extensions are examples,
  not universal defaults. Discuss missing behavior before inventing it.

## 2. Agree a compact column contract

Write a small column plan before coding:

```text
Group / heading | meaning | width/alignment | zero/unknown policy | action/permission
```

- Default to full-width flat rows for comparable summaries: ordinary view surface,
  subtle separators, no card gutters or unnecessary rounded boxes.
- Let the primary title/description absorb spare width. Give comparable counts,
  status fields and action columns shared widths across every row and the header.
  Define geometry once; group widths equal child widths plus shared gaps.
- Center numeric values beneath centered titles. Center status values, their
  headings and icon actions too. Keep primary names/description text leading-aligned.
  Use a different alignment only when the user or the content warrants it.
- Reserve empty-cell space; do not collapse columns when a row has no deferred
  work or overdue signal. Choose zero/blank/unavailable deliberately and truthfully.
- Fit actual headings and the longest admitted numeric values. Never ellipsize
  counts, let digit lengths shift a column, or allocate large unexplained gaps.
  An icon's hit target and its column width are separate concerns.
- Group related columns under a shared heading, aligned at the same vertical level
  as peer groups. Use concise exact user-approved copy. Avoid redundant text in
  cells when a visible heading provides context; retain full descriptive help.
- On narrow panes use labelled stacked groups rather than clipped columns or an
  ambiguous run of bare numbers. Keep one full-width row per concept.

## 3. Signals and actions

- Keep data cells text/numeric by default. Craig's established preference is icons
  in **action cells only**, not repeated clipboard/checkmark/clock decoration beside
  each value. Do not reintroduce badges without an explicit reason/request.
- Reuse semantic warning/destructive/normal colors. Color must have a readable
  reason; neutral is not proof of health. Do not invent completion rings or health
  percentages for ongoing responsibilities.
- An action associated with a due warning should use the same semantic warning
  role as its status label, not a separately chosen yellow. Resolve the current
  state on update and return to the normal foreground when no longer due.
- Use clear, recognizable action glyphs. Native controls stay keyboard-focusable,
  at least 44×32, with contextual accessibility labels and hover help. Columns may
  be wider to fit headings; center the actual control within them.
- Row navigation, Edit, review and any disclosure/delete controls must be siblings,
  never nested buttons. A pointer surface must ignore child controls and their
  descendants. Preserve native text/modal/global key ownership.
- Only an explicit user action changes durable state. Opening a row, displaying a
  view or editing text must not silently reset a review/assessment timestamp.
- Recheck current profile, ownership, identity and revision on action dispatch.
  Do not retarget a stale callback or replay uncertain writes. Reload authoritative
  state after uncertain outcomes; do not manufacture optimistic persisted truth.

## 4. Keyboard and command contract

Read [the generic keyboard contract](references/keyboard-contract.md) before adding
commands. Define semantic actions first, then route native controls, normal-mode
shortcuts and the app's command mode through the same eligibility/dispatch path.
Ship configurable, feature-scoped Neovim-like defaults, not another hardcoded key
switch. Audit actual routing and current overrides; distinguish current support
from the desired contract and do not silently migrate other features' keymaps.

Keep one keyboard owner, 200 ms maximum sequence expiry, immediate unambiguous
single-key dispatch, native text/modal/button ownership and exact current targets.
Generate hints/help from effective configuration. Configuration and command mode
must not bypass readonly, stale-context, repeat or destructive-consent safeguards.

## 5. Layout, lifetime and bounds

- Use actual layout proposals, not widths captured during a minimum-size probe.
  A final commit must use the final proposal, including when a cached result is
  returned. Avoid resize delays, forced reopen or geometry-keyed identities.
- Retain row state by stable scoped identity, never position alone. Replace current
  callbacks when reusing widgets; install native controllers once and release them
  with their owners. Profile/source changes must not leak content or actions.
- Keep grouping/header geometry identical to data geometry. Breakpoints must leave
  enough title space as well as fitting every numeric/action cell.
- Preserve existing paging/virtualization and loading/attachment admission unless
  changing them is explicitly requested. Rendering a summary is not permission to
  eagerly load payloads, realize an unbounded native tree or add another writer.
- Keep concept-specific metadata semantics separate from reusable presentation.
  Do not build a generic dashboard framework or migrate storage merely to share a
  few layouts. Extract small proven helpers where they remove real duplication.

## 6. Regression-first validation

Use synthetic, non-private data. A screenshot is a design reference, not permission
for live application input or provider/personal-data writes.

- Reproduce the actual requested defect at runtime before the fix. Follow the
  project's red-checkpoint convention; no disabled tests, expected failures or
  fixture-side repairs that conceal the old behavior.
- Test the real routed view, not only column constants or mocked metadata.
- Use independent native geometry: header/data centers, identical cross-row column
  positions, group-heading levels, natural numeric text width, row heights and
  nonoverlap. Exercise first draw after zero-width probing, several desktop widths,
  narrow fallback, resize back, absent/present signals and different digit lengths.
- Assert action-only icons, labels/tooltips, hit targets, focus, sibling controls,
  one controller per reused surface and current callbacks after record/profile
  changes. Check actual color values under a scoped synthetic palette for warning
  and normal states; independently check custom glyph silhouettes when needed.
- Test defaults, configured remaps/unbindings, collisions and prefix ambiguity,
  command-mode equivalence, unknown commands, context invalidation, 200/201 ms
  boundaries, repeat/release/focus transitions and hints reflecting actual bindings.
- Verify no writes on view/navigation/Cancel, preserved original bytes for unrelated
  content, and the relevant stale/readonly/uncertain mutation safeguards.
- Run focused/native checks, broader tests as warranted, source guards, whitespace
  and the deployable build. Report exactly what ran; a prior full run is a baseline,
  not a new full-suite claim. Record remaining live/platform acceptance separately.

## Finish

Keep the product/layout decision and evidence in the project's dedicated document.
Commit scoped validated increments when its workflow calls for that; praise is not
implicit permission to merge, push, publish or alter live configuration. Give Craig
a short outcome: what changed, validation/build status and any real limitation.
