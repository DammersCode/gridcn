# Spec: row grouping and aggregation (W6-15, FEAT-12)

## Goal

The grid groups rows by the values of one or more columns, shows a header row per group with its
key, count, and per-column aggregates, and lets the user expand and collapse groups. Group rows are
view-only: they never enter `data`, `onDataChange`, history, or exports.

This item reopens a PLAN v1 non-goal ("row grouping/aggregation", `PLAN.md:32`). The scope boundary
below is part of the decision.

## Scope boundary

| In scope | Out of scope (follow-up items or never) |
|---|---|
| Group by 1–4 columns, controlled `groupBy` | Pivoting (values as columns) |
| Group header rows with key, leaf count, aggregates | Group footer rows; a grand-total row (pinned rows cover it) |
| Built-in reducers `sum`, `avg`, `min`, `max`, `count`, plus a function | Sorting groups by an aggregate |
| Expand and collapse, expand all, collapse all | Drag-a-column-to-group panel UI |
| "Group by" / "Ungroup" in the header menu and context menu | Server-side grouping; grouping with lazy holes |
| Filters before grouping; sorts inside groups | Grouping and tree data in the same grid |
| Treegrid ARIA and keyboard | Editing aggregates or group rows; cell merging (rejected); formulas (rejected) |
| | Custom group keys (for example dates by month): follow-up `ColumnDef.groupKey` |

## Current state (verified)

- `viewIndex` holds only data indices. 36 reads of the form `viewIndex[i]` in 13 files map a view
  row to `data` (`data-grid/store/{compute,data-write,hooks,commit,create-store,api,provider}.ts*`,
  `clipboard/use-grid-clipboard.ts`, `interaction/use-grid-interaction.ts`,
  `validation/bulk-generation.ts`, `data-grid-context-menu/context-menu.tsx`,
  `data-grid-fill/use-fill-handle.ts`, `data-grid-io/export-grid.ts`), plus 7 iterations
  (`viewIndex.map`/`indexOf`/`for…of`, including `data-grid-pinned-rows/use-data-grid-aggregate.ts:71`).
- A view row whose `data` entry is `undefined` is treated as a lazy hole: it renders a skeleton
  (`row.tsx:87`) and every write path skips it (`cell.tsx` comment on `resolveEditTarget` and
  `computeRowEditsBatch`).
- Aggregation exists only in the pinned-rows add-on: `AggregateReducer`, `aggregateColumn`, and
  `computeAggregate` (`data-grid-pinned-rows/use-data-grid-aggregate.ts:8-85`).
- W6-12 adds `getParentId`, `ExpandedState`, `viewTree` (`level`, `posInSet`, `setSize`), the
  treegrid role, the tree-column keys, and the toggle.

## Decisions

1. **Group rows live in the view index as negative entries.** An entry `e < 0` names
   `state.groups[−e − 1]`. Group rows are real view rows: the cursor can sit on them, so a collapsed
   group can be expanded from the keyboard. Rejected: synthetic rows inside `data` — they would leak
   into `onDataChange`, history ops, exports, row ops, and the streaming fast path. Rejected: display
   rows outside the view index — a collapsed group has no data row left to focus.
2. **One accessor for every view-to-data read.** New `store/view-rows.ts` exports
   `viewEntryAt(s, viewRow)` (`data` | `group` | `hole`) and `dataIndexAt(s, viewRow)` (`undefined`
   for a group). All 36 reads and 7 iterations move to it, and a structural unit test fails on any raw
   `viewIndex[` read outside that module. Every write path resolves through `dataIndexAt`, so a group
   row is skipped like a read-only row by default. Rejected: audit-only migration — the next new read
   site would silently treat a group as a hole.
3. **Grouping reuses the W6-12 tree machinery.** Group rows and leaves fill `viewTree`; expanded
   state is the same `expanded: ExpandedState` prop holding group ids; the same keys and toggle apply.
   Grouping and tree data are mutually exclusive (`getParentId` wins, dev error). Rejected: a second
   expansion API — two props with the same meaning.
4. **Group ids are value-derived and stable.** `__group:` followed by one `encodeURIComponent(columnId)
   =encodeURIComponent(keyText)` segment per level, joined by `/`. Expanded state survives sorting,
   filtering, and data refreshes. The `__` prefix follows the band-id convention (`__pinned-top-…`).
5. **Keys come from the type's text; order from the type's compare.** `keyText = toText(value)`;
   an empty value forms the `labels.grouping.empty` group, ordered last. Groups order by the
   column's `sortCompare` / type `compare` on the first leaf's value, ascending, or in the direction
   of an active sort on that column. Rejected: `String(value)` keys — dates and selects would group by
   storage format, not by what the user reads.
6. **Aggregation moves to core.** `AggregateReducer`, `AggregateSpecs`, and `aggregateColumn` move to
   `data-grid/aggregation/aggregate.ts` (sdk export); the pinned-rows add-on imports them and keeps
   exporting the types it documents. Aggregates run over the filtered, loaded leaves of each group.
7. **Group rows are view-only.** No edit, paste, fill target, delete, or row op ever writes a group
   row; copy includes its displayed text (what the user sees is what they copy); exports and print
   include data rows only.

## API

```ts
// DataGridSyncProps (recompute phase)
groupBy?: readonly string[];               // column ids, outermost first; normalized, max 4
defaultGroupBy?: readonly string[];
onGroupByChange?: (next: readonly string[]) => void;   // gesture-first, W5-11 echo rules
aggregates?: AggregateSpecs<TData>;        // column id -> reducer, for group rows
groupColumn?: string;                      // column with toggle + label; default: first visible (config phase)

// DataGridRootProps (render slot)
renderGroupLabel?: (ctx: GroupLabelCtx) => ReactNode;  // default: "<key> (<count>)"
export type GroupLabelCtx = { groupId: string; columnId: string; key: string; value: unknown; count: number; depth: number };

// DataGridActions
setGroupBy(next: readonly string[]): void;
// expand/collapse: W6-12's setExpanded / toggleExpanded / expandAll / collapseAll, with group ids

// data-grid-sdk
export type ViewEntry = { kind: "data"; dataIndex: number; row: unknown } | { kind: "group"; group: GroupNode } | { kind: "hole"; dataIndex: number };
export type GroupNode = { id: string; depth: number; columnId: string; key: string; value: unknown; count: number; aggregates: Readonly<Record<string, unknown>> };
export function viewEntryAt(s: DataGridReadState, viewRow: number): ViewEntry | undefined;
export function dataIndexAt(s: DataGridReadState, viewRow: number): number | undefined;
```

## Behavior

- **Build.** Filter → bucket leaves per level (`Map<keyText, …>`) → order groups (decision 5) →
  sort leaves inside each innermost group by the remaining sorts → flatten, emitting a group entry
  per group and its children only when expanded. Aggregates are reduced in the bucket pass.
- **Rendering.** The body picks `DataGridGroupRow` for a group entry: the group column cell holds
  the indent, toggle, and `renderGroupLabel` output; an aggregated column cell shows the aggregate
  through the column type's `toDisplayText ?? toText` when the type is numeric and the reducer is
  numeric, else `String(value)`; other cells are empty. Group rows use the base `rowHeight`
  (W6-13 `getRowHeight` is not called for them).
- **Selection and CellRef.** Group cells are navigable. A group row's `rowId` is its group id, so
  W5-11 identity remap and `SelectionState.rowIds` work unchanged; `CellRef`s on group rows resolve
  through the group id map. Collapsing a group that holds the cursor moves it to the group row.
- **Sort.** A header sort on a group-by column flips that level's group order; other sorts order the
  leaves inside groups.
- **Filter and search.** Filters run on leaves before grouping; empty groups disappear and aggregates
  reflect the filtered leaves. Quick search matches visible rows, including group labels.
- **Editing.** A group cell never opens an editor (`startEditingAt` resolves no data row). A write to
  a group-by column regroups the row on the next view rebuild, exactly when a write to a sort column
  re-sorts today.
- **Streaming.** `updateCells` `"defer"` writes in place and recomputes only the aggregates of the
  groups that contain touched rows; `"immediate"` falls back to the full rebuild.
- **Clipboard and fill.** Copy writes group rows as their displayed text. Paste, fill, cut, and
  `deleteSelection` skip group cells as targets; fill source cells on group rows count as empty.
- **Row ops.** `insertRow`/`duplicateRows` from a leaf insert in data order; the new row lands in its
  group by value. On a group row they are disabled (context menu items hidden, keys no-op).
  `deleteRows` skips group rows; `reorderRows` no-ops in grouped mode with a dev warning.
- **readOnly.** Grouping, toggling, and `setGroupBy` stay available (view state).
- **Menus and commands.** The header dropdown and context menu (W5-04 menu specs) add "Group by
  column" and "Ungroup" items; `setGroupBy` is a plain action a consumer can bind through `commands`.
- **Pinned rows.** `useDataGridAggregate({ scope: "view" })` reads leaves through `dataIndexAt`, so
  totals never count group rows.
- **Export, print, lazy.** Exports and print read data rows only. Lazy holes with `groupBy` set are
  unsupported (dev error); the grid renders ungrouped.

## Security

- `groupBy` (also from URL or storage) is normalized: unknown ids drop, duplicates drop, at most 4
  levels.
- Key text is percent-encoded inside group ids, so a value containing `/` or `=` cannot forge another
  group's id. Labels render as text nodes.
- A function reducer that throws yields an empty aggregate and dev-warns once per column.
- Group count is bounded by the row count; the build is iterative.

## Performance

- Build at 100k rows, 2 levels (~1,000 groups), 3 aggregates (new
  `sort-filter/group-view-perf.test.ts`, measured baseline + 20 %): ≤ flat `buildViewIndex` × 1.5
  plus ≤ 20 ms of aggregation.
- Toggle: re-flatten from cached buckets, ≤ 8 ms at 100k.
- Stream tick, 20 touched rows, `"defer"`: ≤ 2 ms including aggregates of the touched groups (group
  size ≤ 5,000).
- The accessor migration adds one sign check per view-to-data read; no per-cell work on render.
- Memory: one `GroupNode` per group plus the `viewTree` arrays from W6-12.

## Accessibility

- `role="treegrid"` (W6-12). Group rows: `aria-level` = depth + 1, `aria-expanded`,
  `aria-setsize`/`aria-posinset` among sibling groups; leaves: `aria-level` = `groupBy.length + 1`.
- Group row cells carry `aria-readonly="true"`; the label cell's text includes the count.
- Keys per W6-12 decision 6 on the group column; the toggle is a labelled button.

## Files to add or change

- Add `data-grid/store/view-rows.ts`, `data-grid/sort-filter/build-group-view.ts`,
  `data-grid/aggregation/aggregate.ts`, `data-grid/rows/group-row.tsx`,
  `data-grid/store/view-rows.structure.test.ts` (no raw reads outside the accessor).
- Migrate the 13 files listed under "Current state" plus `data-grid/store/row-index.ts` and
  `data-grid-pinned-rows/use-data-grid-aggregate.ts` to the accessor.
- `types.ts`, `store/types.ts`, `store/create-store.ts`, `store/compute.ts`, `body.tsx`, `row.tsx`,
  `labels.ts` (`grouping` group), `data-grid-sdk.ts`.
- `data-grid-context-menu/menu-items.tsx`, `header-dropdown.tsx`: group items.
- `PLAN.md`: move "row grouping/aggregation" out of the v1 non-goals, pointing at this spec.

## Docs, registry, CHANGELOG

- New page `content/docs/row-grouping.mdx` with example `data-grid-row-grouping-demo`;
  `addons/pinned-rows.mdx` (reducers now come from core, same names); `accessibility.mdx`.
- CHANGELOG `### Added`; **Breaking:** `viewIndex` may hold negative entries when `groupBy` is set
  (sdk readers of `useDataGridViewIndex` or `state.viewIndex` must use `viewEntryAt`).
- Payloads: `data-grid`, `data-grid-pinned-rows`, `data-grid-context-menu`, `data-grid-fill`,
  `data-grid-io`; `test:e2e-install`.

## Test plan

- Unit `build-group-view.test.ts`: one and two levels; empty-key group last; order by type compare
  and by sort direction; leaf sort inside groups; filters drop empty groups; collapsed groups emit
  headers only; aggregates for each reducer and a throwing function; id encoding with `/` and `=` in
  values.
- Unit `row-grouping.test.tsx`: every write path skips group rows (edit, paste, fill, cut, delete,
  `updateCells` by group id, row ops); copy text of a group row; cursor moves to the group on
  collapse; `groupBy` echo and normalization; stream tick recomputes only touched groups' aggregates;
  pinned totals exclude group rows; export excludes group rows.
- Structural test: no `viewIndex[` read outside `store/view-rows.ts`.
- Browser: group toggles by click and keys (LTR and RTL); header menu "Group by column"; axe clean on
  the treegrid; variable heights keep group rows at `rowHeight`.
- Perf: the budgets above.

## Dependencies

- W6-12 (expanded state, `viewTree`, treegrid ARIA, keys, toggle), W6-13 (geometry for mixed row
  kinds), W5-11 (identity remap and echo rules), W5-13 (`DataGridReadState`, overlay ctx), W5-04
  (menu specs for the header and context menu items).

## Open product questions

1. New groups start collapsed or expanded? Recommendation: collapsed (the W6-12 default); the first
   view is the group overview, and `defaultExpanded={{ mode: "expanded", ids: [] }}` opens all.
2. Should copy include group rows? Recommendation: yes, as displayed text; it matches what the user
   selected. Exports stay data-only.
3. Custom group keys (dates by month, number buckets)? Recommendation: follow-up item with
   `ColumnDef.groupKey(value, row): string`, after this item ships.
