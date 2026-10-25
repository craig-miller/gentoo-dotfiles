# Table header bar and spacing blueprint

Use this structure for comparable concept summaries. This is the **table header
bar**, not the application window's title bar or an instruction to add a toolbar.
Choose concept-specific columns from the workflow; do not copy Area metrics or
review policy merely to fill the template.

## Two header levels

```text
Upper:                       Work group
Lower:  Concept | Attention | Measure A | Measure B | State | spare
Data:   Name    | signal    | number    | number    | value | spare

Below:  name | [+] [−] [supported domain icons] [edit icon] <spacer>
```

The drawing is schematic: each group spans exactly its own leaf columns. A concept
may have several data groups, different measures, or no assessment data. Mutation
actions belong to the shared selected-item bar, not repeated data columns.

- Group captions occupy the upper row at a shared vertical level.
- **Every leaf caption belongs on the lower row.** Standalone Concept/name,
  Attention/Overdue and single State/Review fields have no group caption, but
  still align vertically with lower measure captions—not the midpoint of
  the combined header height.
- Build each group as a vertical stack: centered group caption, 2-point gap,
  horizontal leaf captions. Use the same font/line-height for peer leaf captions.
  Bottom-align the outer horizontal stack. Do not insert a fake group label,
  a magic 9-point offset or a hidden interactive control to position a caption.
- Center group captions over their complete group width. Center counts, statuses
  and their row contents. Keep the concept/name caption and names
  leading-aligned. Preserve actual accessibility labels and contextual help.

SwiftCrossUI composition, schematically:

```text
HStack(alignment: .bottom, spacing: 8) {
    nameCaption.frame(width: sharedTitleWidth, alignment: .leading)
    attentionCaption.frame(width: attentionWidth, alignment: .center)
    VStack(spacing: 2) { groupCaption; HStack(spacing: 8) { leafCaptions } }
    ...other groups...
    stateCaption.frame(width: stateWidth, alignment: .center)
    Spacer(minLength: 0)
}
```

Use the framework's real alignment and shared size model, not this pseudocode as
an excuse to bypass native layout or hardcode calculated coordinates.

## Bounded title, compact columns, trailing spare space

Starting dimensions for this pattern (points; adjust only for justified content
or an explicitly approved design change):

| Element | Starting geometry |
| --- | --- |
| Desktop name/title field | **280 maximum**, leading-aligned; shrinks to fit |
| Main-line / leaf-column gap | **8** |
| Upper-to-lower header gap | **2** |
| Header captions | **11-point regular**, semantic muted foreground |
| Row name | **15-point semibold**, at most two lines |
| Secondary description | **12-point**, leading-aligned |
| Count slot | **72**, centered; preserve five-digit natural text width |
| Short status slot | **88**, centered, if its caption fits |
| Bar action's minimum native target | **44 × at least 32** |
| Horizontal row/header inset | **12** per side |
| Vertical row/header inset | **6** for the compact presentation |

An attention slot must fit its truthful text. For example, Zentoo Areas reserves
184 for Overdue and 88 for Review **data**; Edit/Mark Reviewed are no longer table
columns. These are content-specific examples, not mandatory columns elsewhere.

1. Define column widths and group membership in **one shared geometry owner**.
   A group width is the sum of child widths plus each internal gap exactly once.
2. Compute title width from the **actual final row proposal**: reserve side insets,
   attention edge, non-title columns and all internal/outer gaps first; cap the
   remaining title budget at 280. Header and rows call the same calculation.
   Include the gap before the trailing flexible spacer. Do not derive widths from
   a zero/minimum-size probe, stale captured geometry or a delayed resize callback.
3. Put a flexible spacer **after the final data column**, in header and data main
   lines. Extra desktop width must not keep stretching the name field or move
   the metric/status block farther away. Never distribute spare width between
   each column with multiple spacers or equal fractions of the whole pane.
4. Keep the row surface, separators, attention edge, pointer hit surface and
   secondary notes/descriptions full-width. Cap the **main-line title field**,
   not the entire row or the prose below it. Preserve stable scoped row identity.
5. Reserve empty signal/count slots. Missing data must not shift later columns.
   When fixed columns plus a usable name cannot fit, switch to the existing
   labelled stacked layout; do not hide clipping with a one-point title field.
   A breakpoint is derived from the chosen columns, not copied blindly from Areas.

If the row has an attention border, reserve the same width transparently in the
header so their content origins match (the Area example uses 5 points). Use the
ordinary semantic header surface with a subtle bottom separator, not another card
or toolbar. No decorative data icons: icons identify native actions; color and
text carry data signals.

## Shared selection action bar

- Place one leading-aligned bar **beneath/outside the list scroller** so it stays
  reachable on long pages. Order it **name, Add, Minus, supported domain action
  icons, Edit icon, trailing spacer**. Measure the name naturally up to 280; use
  8-point gaps and no flexible space between controls. Review/Edit are icon-only
  with effective tooltips; Minus uses normal foreground while still requesting
  confirmation. Omit “Selected:” and collection suffixes; keep source identity
  in accessibility and exact-target guards. Do not duplicate
  the old section-header Add. Add does not require selection; other actions do.
- Keep current data statuses in the rows and remove obsolete action headings.
  The bar is not permission to add universal review/completion/planning commands.
- Pointer activation selects without leaving the list; retain primary-open via
  Enter/command mode. Reuse semantic dispatch and effective hints. Remove opens
  existing named confirmation and does not save a draft or delete immediately.
- Observe frequent selection only in this small region; keep table data/page
  observation independent. Freeze the visible action context, including selection
  transitions, so stale callbacks (including A→B→A) refuse rather than retarget.
  Cached display eligibility never authorizes an operation.
- Keep bar height independent of selected name/selection absence. On narrow
  proposals put the caption above controls, and split action groups into further
  lines if needed; never let minimum native targets overflow. Preserve native
  focus and accessible names, current callbacks and readable full context.

## Native geometry oracles

Test the actual routed header and several rows, not only shared constants:

- Standalone captions have the same native vertical position as lower group
  captions; group captions share the upper level.
- Each heading and its data share column center/edges; all rows share positions,
  including empty signals, different digit lengths and due/fresh values.
- At wide proposals, increasing pane width leaves capped title/metric coordinates
  fixed and adds space only after the final data column. Test smaller desktop, narrow,
  resize-back and initial zero-probe paths too.
- Distinguish a **column slot** from its centered caption's natural glyph bounds.
  Use an independently measured slot, or its native center minus half the admitted
  slot width. A short Overdue caption's left edge is not the column's left edge.
  Do not use the implementation's new width helper as the test's only oracle.
- Verify no repeated row mutation controls, one Add, bar below the data scroller,
  initial/readonly disabling, plain selected name, exact selected action, stale/ABA
  callback refusal and Add without selection. Exercise narrow split bar groups.
- Preserve no-overlap, natural text width, row bounds, native sibling bar actions,
  focus/hit targets, current callbacks, no writes and attention/selection pixels.

For committed native allocation/scroll checks, require actual frame evidence when
needed; a fixed settling sleep is not proof of paint. Separately report latency
measurements and limits—do not hide slow frames by weakening geometry assertions.
