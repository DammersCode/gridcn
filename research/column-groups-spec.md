# Spec: column groups and multi-level headers (W6-10, FEAT-7)

## Goal

Columns that belong together get a shared header above their own headers ("Address" over
Street / City / Zip), nested to any reasonable depth. Groups stay contiguous under reorder, hide,
pin, and restored layouts, and the header block stays aligned with the virtualized body.

Written against the API after Wave 5: W5-11's `normalizeColumnLayout`, `setColumnLayout`, and
`state.columnLayout`; W5-12's sync-prop home.

## Current state (verified)

- One header row: the header layer is a CSS grid with `gridAutoRows: headerHeight`
  (`header.tsx:132`) and every header cell sits on `gridRowStart: 1` (`header-cell.tsx:85`).
- Columns are flat (`ColumnDef`, `types.ts:436-547`); the visible order is
  pinned-left, middle, pinned-right (`store/compute.ts:446-461`).
- Reorder constraint today is the pin zone only (`reorderColumnIds`, `store/compute.ts:723-747`).
- The header uses the full column template (`template`, the RLE track string) and places each
  windowed cell at its real index (`header.tsx:143-172`), so a cell can span tracks that the column
  window did not render.
- ARIA: header cells carry `aria-colindex` (`header-cell.tsx:120`); data rows use
  `aria-rowindex = viewRowIndex + 2 + pinnedTopCount` (`row.tsx:94`); the root sets
  `aria-rowcount = rowCount + 1 + bands` (`root.tsx:499`). The `2` and `1` assume one header row.
- Everything below the header measures from the context's `headerHeight`: the body's data-row top
  (`body.tsx:76`), the root's `effectiveHeaderHeight` (`root.tsx:221`), the pinned-top band inset
  (`data-grid-pinned-rows/pinned-row-band.tsx:53`), the fill tracker (`fill-tracker.tsx:26`).

## Decisions

1. **A separate `columnGroups` prop, columns stay flat.** Groups reference column ids. Every
   existing flat-column path (layout, windowing, selection, export) stays unchanged. Rejected:
   nested `children` inside `columns` — every consumer of `columns` would need a flatten step and
   `defineColumns` typing would change.
2. **Groups are contiguous by construction.** `normalizeColumnLayout` and `reorderColumnIds`
   enforce it: a member moves only within its group; a group moves as a block within its parent
   group or its pin zone; a restored `order` that splits a group is repaired by placing all members
   at the first member's position in their def order. Rejected: allow splits and render one header
   per fragment — the same group label twice reads as two groups.
3. **Pinning stays per column; the header splits per band.** A group with members in pinned-left
   and middle renders one header segment per band, both labeled. Rejected: pin whole groups — the
   pin gesture and `pinnable` are per column today, and a forced group pin would move columns the
   user did not touch.
4. **Context `headerHeight` becomes the whole header block.** `headerHeight` (prop) stays the
   height of one header row; the root context exposes `headerHeight = rowHeightOfHeader ×
   headerRowCount` plus `headerRowCount` and `headerRowHeight`. Every consumer that asks "where do
   data rows start" keeps working unchanged. Rejected: a new `headerBlockHeight` field — five
   consumers would need edits and a missed one misplaces rows.
5. **An ungrouped column spans all header rows** (`gridRow: 1 / -1`); a leaf under a shallower group
   spans the remaining rows. This is a header-only span; data cells never merge (the rejected
   cell-merge item stays rejected).
6. **Group headers select, never sort or resize.** A press selects the group's visible columns in the
   column channel (`shift` extends, `mod` adds); `headerClickBehavior: "sort"` makes a group press a
   no-op. Resize stays on leaf headers. Rejected: proportional group resize — it changes widths the
   user did not drag.

## API

```ts
export type ColumnGroupDef = {
  id: string;                         // unique across groups and columns
  header: string | ReactNode;
  headerText?: string;                // plain text for a11y and the columns menu when header is a node
  children: readonly (string | ColumnGroupDef)[]; // column ids or nested groups
  headerClassName?: string;
};

// DataGridSyncProps (recompute phase: feeds visible columns and the layout normalizer)
columnGroups?: readonly ColumnGroupDef[];

// derived store state
headerRows: readonly HeaderSegment[][];   // one array per group level, top first
type HeaderSegment = { groupId: string; start: number; end: number; pin?: "left" | "right"; depth: number };

// DataGridRootContextValue additions
headerRowCount: number;   // group depth + 1
headerRowHeight: number;  // the headerHeight prop
// headerHeight now = headerRowHeight * headerRowCount

// renderHeaderCell ctx (W5-01/R-50) gains: group?: ColumnGroupDef (for group cells, `column` is undefined)
```

`computeHeaderRows(visibleColumns, columnGroups)` in `store/compute.ts` builds `headerRows` when
`visibleColumns` or `columnGroups` change: one pass per level, splitting a group's segment at a pin
zone boundary. `start`/`end` are real visible-column indices `[start, end)`.

## Behavior

- **Rendering.** `DataGridHeader` renders group segments whose `[start, end)` intersects the windowed
  column range, then leaf cells on row `headerRowCount`. A segment cell gets
  `gridRow: depth + 1`, `gridColumn: start + markerColOffset / end + markerColOffset`, and for a
  pinned segment `pinnedInsetStyle(pin, start)`. The marker header spans all rows. The label of a
  wide unpinned segment stays readable with a CSS-only offset from `--grid-scroll-left`
  (`max(0px, min(scroll − segmentLeft, segmentWidth − 8rem))`), no per-tick JS.
- **Reorder.** Dragging a group header moves the block; the drop indicator uses the block edges.
  `reorderColumnIds` gains a `groups` argument; a cross-group drop of a leaf is ignored like a
  cross-zone drop today.
- **Hide.** Hiding every member removes the group segment; partial hide shrinks the span. The
  columns menu (`data-grid-toolbar/columns-menu.tsx`) lists members under a non-interactive group
  heading.
- **Layout persistence and URL (W6-07).** Groups are defs, not layout. A saved or URL `order` passes
  `normalizeColumnLayout`, which repairs splits (decision 2), so a crafted URL cannot break
  contiguity.
- **Selection and CellRef.** Group selection writes the column channel by `columnId`; W5-11's
  `SelectionState.columnIds` carries the members. No new selection shape.
- **Sort, filter, editing, clipboard, fill, readOnly.** Unchanged: all run on leaf columns. Copy
  never includes header text.
- **Export (io) and print (W6-03).** Leaf headers only in this item; group header rows in XLSX/CSV
  export and print are a follow-up.
- **Plugins and keyboard.** No new commands. Header cells are not keyboard stops today; that stays.
- **Pinned rows.** The pinned-top band sits under the whole header block (decision 4).

## Security

`columnGroups` comes from consumer code, but it is validated like the layout: unknown ids drop
(dev warning), a column listed twice keeps its first group, depth above 8 is truncated with a dev
error, and the walk is iterative, so a cyclic object graph cannot overflow the stack (visited set).

## Performance

- `computeHeaderRows` is O(columns × depth), runs only when `visibleColumns` or `columnGroups`
  change, never on scroll.
- Rendering adds O(segments intersecting the window) cells per header render; scroll moves the
  header by the existing transform, so no per-tick React work is added.
- Budget: 500 columns, depth 3, `computeHeaderRows` ≤ 1 ms; the `perf.browser` horizontal-scroll FPS
  ratio stays within its bar with a 3-level header.
- An inline `columnGroups` literal is compared structurally in the sync (the R-38 rule) so it does
  not rebuild the header every render.

## Accessibility

- Each header row is `role="row"` with `aria-rowindex` 1…`headerRowCount`; data rows start at
  `headerRowCount + pinnedTopCount + 1` and `aria-rowcount` adds `headerRowCount` (`row.tsx:94`,
  `root.tsx:499,535,546` switch from the literal `1`/`2`).
- A group cell is `role="columnheader"` with `aria-colindex = start + 1` and
  `aria-colspan = end − start`. A split segment gets the same label.
- Leaf headers keep `aria-colindex`; `aria-colcount` stays the leaf count.

## Files to add or change

- `data-grid/types.ts`: `ColumnGroupDef`; `store/types.ts`: sync prop, `headerRows` state.
- `data-grid/store/compute.ts`: `computeHeaderRows`, group-aware `reorderColumnIds`, contiguity in
  `normalizeColumnLayout` (W5-11).
- `data-grid/header.tsx`, `header-cell.tsx` (row placement from props), new
  `data-grid/columns/group-header-cell.tsx`.
- `data-grid/layout-context.ts`, `root.tsx`, `row.tsx`, `rows/marker-header.tsx`: header row count,
  ARIA indices.
- `data-grid-pinned-rows/pinned-row-band.tsx`, `use-data-grid-pinned-rows.tsx`: `ariaRowIndexBase`
  from the root ctx (no literal).
- `data-grid-toolbar/columns-menu.tsx`: group headings.
- `data-grid/data-grid.tsx`: barrel exports `ColumnGroupDef`.

## Docs, registry, CHANGELOG

- `columns.mdx`: "Column groups" section; new example `data-grid-column-groups-demo` under
  `examples/columns/`; `accessibility.mdx`: header ARIA.
- CHANGELOG `### Added`; **Breaking:** the context `headerHeight` meaning (sdk consumers that render
  below the header) and the `aria-rowindex` shift for data rows when groups are set.
- Payloads for `data-grid`, `data-grid-pinned-rows`, `data-grid-toolbar`; `test:e2e-install`.

## Test plan

- Unit `column-groups.test.ts`: `computeHeaderRows` for flat, nested, partially hidden, and
  pin-split groups; contiguity repair of a split `order`; group drag moves the block; a leaf drop
  across groups is ignored; depth cap; duplicate and unknown ids; structural compare of an inline
  literal.
- Unit `column-groups-layout.test.tsx`: `setColumnLayout({ order })` with a split repairs and fires
  `onColumnLayoutChange` once; group press selects the members; sort mode ignores group presses.
- Browser: 3-level header aligns with body cells at scroll 0, mid, and end, LTR and RTL; pinned
  segment stays put while the middle scrolls; pinned-top band sits under the block; axe clean;
  `aria-colspan` and `aria-rowindex` values.
- Perf: the budget above.

## Dependencies

- W5-11 (normalizer, `setColumnLayout`, `state.columnLayout`), W5-12 (sync-prop home), R-50
  (grid-owned header cell placement), W5-01 (`renderHeaderCell`).

## Open product questions

1. Should XLSX/CSV export and print write group header rows? Recommendation: yes, as a follow-up
   item in `data-grid-io` (merged header cells in XLSX, repeated labels in CSV); out of this item to
   keep the core change reviewable.
