# Demo Validation D — Appearance & Misc demos (Cluster D, Plan 014 Task 2 part 3)

Scope: 18 registry items (11 assigned + 7 unassigned leftovers after fully resolving the 42 `registry:example` items
against the cluster A/B/C assignments: sorting-filtering, keybindings, pinning, column-layout, row-ops,
large-data, performance), files under `registry/default/examples/`.
Checked: (1) strict installability, (2) third-party APIs, (3) gridcn API against
`registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx` + feature docs,
(4) existing unit tests.

Tested:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0** — "All registry:example items
  resolve: dependencies exist and every payload import resolves." (Only `!` notes for `react` /
  `lucide-react` / `sonner` without explicit declarations — informational; `lucide-react` is fetched
  automatically by the shadcn CLI, `react` is consumer boilerplate).
- `pnpm vitest run --project=unit registry/default/examples/data-grid-playground-demo.test.tsx`:
  **2/2 passed** (the only unit test of my cluster; `custom-cell` belongs to cluster A).
- `pnpm vitest run --project=browser registry/default/examples/demo-smoke.browser.test.tsx`:
  **42/42 passed** (mounts all demos, covers my 18).
- `pnpm registry:verify`: payload drift only for `data-grid-events-demo.json` (cluster B; already
  documented by B). My 18 payloads are in sync — the `data-grid-loading-demo.tsx` /
  `data-grid-performance-demo.tsx` changed since `689a49b` (token fixes + loading start state)
  were already rebuilt via the `registry.json` commit `2a37d87`.

## data-grid-i18n-demo

- **External deps:** none (only `react`; `select` declared directly as a shadcn-registry dep ✓).
- **APIs verified:** `DataGridProvider labels` (`DeepPartialLabels`, deep merge over `DEFAULT_LABELS`;
  keys used `toolbar.searchPlaceholder/filter/columns`, `grid.emptyState/loading` — all exist
  in `labels.ts`); `DataGridRoot direction` (`GridDirection = "ltr"|"rtl"`, `windowing/direction.ts`);
  `DataGridToolbar`/`DataGridSearch`; `pin: "left"` (ColumnDef).
- **Docs consistency:** `i18n.mdx` — `labels`/`direction`/`DeepPartialLabels` all documented ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-styling-patterns-demo

- **External deps:** none (only `react`; `select` transitively via `data-grid`).
- **APIs verified:** `DataGrid getRowClassName` (`GetRowClassName<TData>`, stable module identity),
  `density` (`DensityMode = "compact"|"default"|"comfortable"`), per-column `cellClassName`/
  `headerClassName` string form (ColumnDef, `cn()` merge), `select` column with `options.choices`.
- **Docs consistency:** `styling-theming.mdx` — `getRowClassName`/`getCellClassName`/`cellClassName`/
  `headerClassName`/`density`/`rowHeight` all documented ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-conditional-styling-demo

- **External deps:** none (only `react`).
- **APIs verified:** `getRowClassName`, `getCellClassName` (`CellClassNameCtx = {value, row, column,
  viewRowIndex}` — the demo destructures `{column, value}` ✓), per-column `cellClassName`/
  `headerClassName` string form, `select` choices.
- **Docs consistency:** `styling-theming.mdx` ✓ (as above).
- **Status:** OK
- **Changes:** none.

## data-grid-custom-headers-demo

- **External deps:** `lucide-react` — not in `registry.json` `dependencies`, but the shadcn CLI fetches it
  automatically (OK, no defect); declared in `package.json` (`^1.46.0`); icons
  `ArrowDown/ArrowUp/Minus/TrendingDown/TrendingUp/User` all present in the installed d.ts (1.46.0).
- **APIs verified:** `header` as a ReactNode + `headerText` (ColumnDef: a string header gets the
  built-in sort arrows, a ReactNode header "owns its display" — consistent with the demo behavior),
  `useDataGridSortState(): SortSpec[]` (`{columnId, direction}`), `DataGridProvider
  headerClickBehavior="sort"`.
- **Docs consistency:** `columns.mdx` (`headerText`/`accessorFn`/`flex` ✓) + `examples/columns/custom-headers.mdx`
  (`useDataGridSortState` ✓).
- **Status:** OK
- **Changes:** none.

## data-grid-custom-markers-demo

- **External deps:** `lucide-react` (as above, OK): icons `Check/Circle/List/ListChecks/ListMinus/Minus`
  all present in 1.46.0.
- **APIs verified:** `DataGridProvider rowMarkers="checkbox"` (`RowMarkersMode`),
  `DataGridRoot renderMarker` (`MarkerCellRenderCtx = {viewRowIndex, isRowChannelSelected,
  isCellSelected}` — `layout-context.ts`), `renderMarkerHeader` (`MarkerHeaderRenderCtx =
  {allSelected: "checked"|"indeterminate"|"unchecked"}`), `useDataGridActions().setAllRowsSelected`.
- **Docs consistency:** `examples/rows/row-markers.mdx` — `rowMarkers`/`renderMarker`/`renderMarkerHeader`
  documented ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-row-markers-demo

- **External deps:** none (only `react`; `select` declared directly ✓).
- **APIs verified:** `rowMarkers` on the provider, `RowMarkersMode` values `none|number|checkbox|both`
  (the demo's subset of `none|number|checkbox|both|reorder` — valid).
- **Docs consistency:** `examples/rows/row-markers.mdx` ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-loading-demo

- **External deps:** none (only `react`; `switch` declared directly ✓).
- **APIs verified:** `DataGridProvider data` (controlled, vs. `defaultData`), `DataGridRoot loading`
  (JSDoc: 0 rows + loading = skeleton, rows + loading = indeterminate bar, otherwise empty state —
  one-to-one with the three demo states).
- **Docs consistency:** `examples/appearance/loading-states.mdx` — `loading`/skeleton/empty state
  consistent ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-presence-demo

- **External deps:** none (only `react`).
- **APIs verified:** `useDataGridPresence()` → `{plugin, setPresenceHighlights}` (own store,
  plugin identity stable); `PresenceHighlightEntry` = view-space `PresenceHighlight {id, color,
  range: GridRect, label?}` OR rowId-native `RowIdRangePresenceHighlight {id, color, rowIds,
  columnIds, label?}` (both demo forms against `presence-store.ts`); `DataGridProvider overlayPlugins`,
  `headerClickBehavior="sort"` (the Linus highlight follows the row ids across sorts).
- **Docs consistency:** `examples/addons/presence.mdx` — `useDataGridPresence`/`setPresenceHighlights`/
  `rowIds`/`columnIds` consistent ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-pinned-rows-demo

- **External deps:** none (only `react`).
- **APIs verified:** `useDataGridState(rows, {getRowId})` (history add-on, spreadable),
  `useDataGridPinnedRows({topRows, bottomRows})` → `rowBands` (stable identity for stable
  arrays), `DataGridProvider rowBands`, `DataGridAggregateReporter {specs, onChange}` +
  `AggregateSpecs` (`"avg"`/`"sum"` + custom reducer `(values, rows) => unknown`),
  `DataGridToolbar`/`DataGridFilterMenu` (filter-aware aggregation via `viewIndex`).
- **Docs consistency:** `examples/addons/pinned-rows.mdx` — `useDataGridPinnedRows`/
  `DataGridAggregateReporter`/`topRows`/`bottomRows` consistent ✓ (the `AggregateSpecs` type name itself
  is not named there — nit, no defect).
- **Status:** OK
- **Changes:** none.
- **Observation:** the dev warning "rowBands identity changed" in the smoke (1× per band on the first
  aggregate report from the empty row to the computed value) — a legitimate one-time content change,
  not per-render churn (the aggregate is memoized on `viewIndex/data/specs` identities, specs in
  module scope) → no defect.

## data-grid-fill-patterns-demo

- **External deps:** none (only `react`).
- **APIs verified:** `useDataGridFill({})` → `{plugin, FillHandleTracker}` (options `disabled`/
  `onFill` optional); `overlayPlugins` via a stable `useMemo`; `<FillHandleTracker />` as a child of
  `DataGridRoot` (needs the root subtree, JSDoc confirms).
- **Docs consistency:** `examples/addons/fill.mdx` — `useDataGridFill`/`FillHandleTracker` wiring
  identical ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-playground-demo

- **External deps:** `lucide-react` (as above, OK): icons `ArrowDown/ArrowUp/Check/Circle/List/ListChecks/
  Minus/TrendingDown/TrendingUp/Upload/User` all present in 1.46.0. `@dnd-kit/*` (toolbar/
  sort-list) and `xlsx`/`papaparse` (io) transitively via the block items; all in `package.json`.
- **APIs verified:** (all against source JSDoc) the `useDataGridState` spread + `grid.data`;
  `useDataGridActions().updateCells(CellPatch[], {reorder})` (`"defer"|"immediate"` ⊂
  `UpdateCellsReorder`); `useDataGridFill`/`useDataGridPresence` (plugin arrays `useMemo`);
  `useDataGridPinnedRows` + `DataGridAggregateReporter` (bottom-band pattern);
  `useDataGridLazyRows({total, fetchRows(start,end,signal), getRowId})` →
  `gridProps.{data,getRowId,onRowWindowChange}`, `onDataChange`, `unloadedCount`;
  `DataGridLazyGuard hasHoles` (in the provider, next to the root); controlled `sortState={[]}` +
  `onSortChange` (server sort, `sortState` deliberately empty); `useDataGridPagination({data, pageSize})`
  → `pageData`/`controls` + `<DataGridPaginationBar {...pager.controls} />`;
  `DataGridContextMenu` + `renderHeaderMenu` ctx `{column, index, trigger}` =
  `DataGridHeaderDropdown` props (identical); `DataGridSortList`;
  `DataGridKeybindingsDialog {open, onOpenChange}` (provider suffices) +
  `DataGridKeybindingsShortcut {onOpen}` (in the root); `DataGridExportButton` (props optional) +
  `DataGridImportButton {createRow, onImport}`; `enableRowReorder`, `rowMarkers` (incl. `"reorder"`),
  `density`/`direction`/`readOnly`/`loading` on `DataGridRoot`; the `validate` swap on the Age column
  (function form, `string|null`); `defineColumns` types (`ColumnDef<DemoRow, unknown>[]`).
- **Docs consistency:** `playground.mdx` + `lazy-loading.mdx` (the server-sort escape hatch: controlled
  `sortState` stays empty, the spec goes to the API) + `pagination.mdx` + `examples/addons/*` —
  consistent ✓.
- **Status:** OK
- **Changes:** none.
- **Tests:** `data-grid-playground-demo.test.tsx` (unit, mode switching virtualized→paginated→lazy,
  rules-of-hooks across remounts) 2/2 green; smoke mount green.

## data-grid-sorting-filtering-demo

- **External deps:** none (only `react`).
- **APIs verified:** `headerClickBehavior="sort"` (click cycle asc→desc→clear, shift for
  multi-sort — header behavior), `DataGridSearch` (quick search + match navigation),
  `DataGridFilterMenu`, per-column `filterable: true`.
- **Docs consistency:** `sorting-filtering-search.mdx` — `headerClickBehavior`/`DataGridSearch`/
  `DataGridFilterMenu` consistent ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-keybindings-demo

- **External deps:** none (only `react`; `button` transitively via `data-grid`).
- **APIs verified:** `DataGridKeybindingsDialog {open, onOpenChange}` (in the provider, outside the
  root is allowed — JSDoc: "the dialog itself only needs the provider"),
  `DataGridKeybindingsShortcut {onOpen}` (mounted inside `DataGridRoot` — JSDoc: "mount INSIDE
  DataGridRoot").
- **Docs consistency:** `examples/addons/keybindings.mdx` ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-pinning-demo

- **External deps:** none (only `react`).
- **APIs verified:** `pin: "left"`/`"right"` (ColumnDef), `resizable: false`,
  an `accessorFn`-only column (read-only by construction, JSDoc), `flex: 1`,
  `renderHeaderMenu` → `DataGridHeaderDropdown`, `DataGridColumnsMenu` (hidden-restore).
- **Docs consistency:** `columns.mdx` (`pin`/`resizable`/`accessorFn` ✓) + `examples/columns/pinning.mdx`
  ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-column-layout-demo

- **External deps:** none (only `react`; `button` transitively via `data-grid`).
- **APIs verified:** `ColumnLayout = {widths, order, pins, hidden}` (persisted snapshot shape,
  the demo shows `layout.order`), `defaultColumnLayout` (uncontrolled seed, JSDoc),
  `onColumnLayoutChange` (store-actions layer), `number` options `{min, max}`.
- **Docs consistency:** `examples/columns/column-layout.mdx` — `defaultColumnLayout`/
  `onColumnLayoutChange` consistent ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-row-ops-demo

- **External deps:** none (only `react`; `switch` directly, `button` transitively via `data-grid`).
- **APIs verified:** `DataGridProvider createRow`/`duplicateRow`,
  `useDataGridActions().insertRows(viewRowIndex, count, "above"|"below")` /
  `duplicateRows(viewRowIndexes)` / `deleteRows(viewRowIndexes)` (view-based — matches
  `selection.rows.toArray()` (`CompactSelectionLike`: `length`/`toArray()`) and
  `useDataGridActiveCell().row`), `DataGridRoot readOnly`, `DataChange = {ops, source, label?}` with
  `DataOp {type, rowId, ...}` (the panel renders exactly these fields).
- **Docs consistency:** `row-operations.mdx` + `examples/rows/row-operations.mdx` —
  `createRow`/`duplicateRow`/`insertRows`/`duplicateRows`/`deleteRows`/`onDataChange` consistent ✓.
- **Status:** OK
- **Changes:** none.

## data-grid-large-data-demo

- **External deps:** none (only `react`).
- **APIs verified:** the `DataGrid` wrapper with 100k rows (windowed rendering, all built-in
  cell types `text`/`number`/`checkbox`/`select`/`date` against `GridCellTypes`).
- **Docs consistency:** `examples/data/large-data.mdx` + `performance.mdx` ✓.
- **Status:** OK
- **Changes:** none.
- **Observation:** the dev warning "viewport shows more than 200 rows" in the smoke harness — a harness artifact
  (the browser setup loads no CSS, so `h-[420px]`/`h-full` do not apply there); in the app/docs preview with
  Tailwind the height is bounded. No defect.

## data-grid-performance-demo

- **External deps:** none (only `react`).
- **APIs verified:** as large-data + `rowMarkers="number"` on the provider; the FpsMeter is pure
  React (rAF/`performance.now()`), no grid APIs.
- **Docs consistency:** `performance.mdx` (the virtualization claim) ✓.
- **Status:** OK
- **Changes:** none.

## Cross-cutting notes (no cluster defects, documented only)

- **registry.json (central → to the Task-2 lead):** 8 of my items declare
  `DammersCode/gridcn/data-grid-history` in `registryDependencies` without importing the add-on
  (styling-patterns, conditional-styling, row-markers, sorting-filtering, keybindings, pinning,
  large-data, performance) — consumers install the add-on unnecessarily (harmless; the block is
  standalone). Same pattern as cluster B's observation.
- **`lucide-react`** is in `dependencies` of none of the 42 items (CLI auto-install);
  `package.json` declares `^1.46.0`; all 12 icons used in my demos exist in the
  installed version (d.ts check). Consistent, no defect.
- **Payload drift:** `pnpm registry:verify` flags only `data-grid-events-demo.json` (cluster B,
  already documented there as a rebuild requirement). My 18 items are drift-free.
- **`react` notes** in `demo:verify` are global (all items), consumer boilerplate.
