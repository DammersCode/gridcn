# Demo Validation B — Data & Fetching demos (Cluster B, Plan 014 Task 2 part 3)

Scope: 7 registry items, files under `registry/default/examples/`.
Checked: (1) strict installability, (2) third-party APIs (n/a — no external deps),
(3) gridcn API against `registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx` +
feature docs, (4) existing tests.

Tested:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0**, all items + payloads resolve (only note: `react` is declared in no item — a global, harmless boilerplate warning across all ~37 items).
- `pnpm vitest run --project=browser` (demo-fit + events + minimal + streaming): **4 files, 33 passed, 5 skipped**. Events test re-run after the fix: 3/3 green.

## data-grid-lazy-demo

- **External deps:** none (only `react`; repo: react ^19.3.0). `registry.json` item: no npm `dependencies` ✓.
- **APIs verified:** `useDataGridLazyRows({total, fetchRows(start,end,signal), getRowId, onError(error,range)})` → `gridProps.{data,getRowId,onRowWindowChange}`, `onDataChange`, `unloadedCount`, `isLoading` (all against `use-data-grid-lazy-rows.ts`); `DataGridLazyGuard hasHoles` (`lazy-guard.tsx`); `Range`; core `DataGridProvider`/`DataGridRoot onRowWindowChange`.
- **Docs consistency:** `lazy-loading.mdx` — basic snippet (same prop/callback names), `onError` semantics ("the next time that range comes into view, onRowWindowChange naturally re-requests it"), guard callout ("Mount `<DataGridLazyGuard hasHoles={lazy.unloadedCount > 0} />` inside `<DataGridProvider>`") — all consistent. Both demo failure buttons + retry (manual `onRowWindowChange(failedRange)` re-fire) match the docs' description of both failure shapes and "no separate retry mechanism".
- **Status:** OK
- **Changes:** none.

## data-grid-streaming-demo

- **External deps:** none (only `react`). `button`/`switch` are shadcn-ui registry deps, present as `components/ui/*` ✓.
- **APIs verified:** `useDataGridActions().updateCells(patches, {reorder: "immediate"|"defer"})` (`UpdateCellsReorder = "defer"|"immediate"|"never"`), `reconcileView()`, `useDataGridViewStale()`, `CellPatch {rowId, columnId, value}`, `DataGridProvider.headerClickBehavior="sort"`, `defaultData`.
- **Docs consistency:** `streaming-updates.mdx` — updateCells per rowId, ReSortBar pattern (`viewStale` + `reconcileView()`), reorder table, "The demo's auto-sort switch toggles `reorder` between the modes on every tick" — all consistent. Runtime proof: demo tests "holds row position and offers a re-sort …" + "re-sorts automatically on each tick once auto-sort is on" green.
- **Status:** OK
- **Changes:** none.

## data-grid-events-demo

- **External deps:** none (only `react`).
- **APIs verified:** all event props on `DataGridProvider` (`onDataChange`, `onSelectionChange` + `SelectionChangeDetails.getValues()` lazy, `onSortChange`, `onFilterChange`, `onJoinOperatorChange`, `onColumnLayoutChange`, `onColumnResizing`), `DataGridRoot<DemoRow>` generic + `onRowWindowChange`/`onCellClick` (`CellClickCtx<DemoRow, unknown>`)/`onRowClick` (`RowClickCtx<DemoRow>`), `renderHeaderMenu`-ctx → `<DataGridHeaderDropdown {...ctx} />` (prop shapes identical), `useDataGridPresence()` → `setPresenceHighlights` (view-space `PresenceHighlight` entry), `useDataGridFill({onFill})` → `FillArgs {source, target, values, preventDefault}`, `FillHandleTracker` as a child of `DataGridRoot`, `DataGridToolbar`/`DataGridSearch`/`DataGridFilterMenu`, `DataGridContextMenu`.
- **Docs consistency:** `events-state.mdx` §1–9 — all names and payload shapes consistent; §6 explicitly points at this demo as the `DataGridRoot<Person>` example (demo uses `DataGridRoot<DemoRow>` ✓).
- **Status:** DEFECT-FIXED
- **Change:** the component JSDoc claimed "`onFill` … veto shown via a no-op preventDefault call for odd sums" — present neither in the code (the handler only logs, no `preventDefault` call) nor in the docs. Stale claim from the initial commit removed (1 line). → **Payload drift:** `public/r/data-grid-events-demo.json` must be rebuilt via `pnpm registry:build` before the commit (lead gate; `verify-payload-content` flags it in the meantime).

## data-grid-history-demo

- **External deps:** none (only `react`).
- **APIs verified:** `useDataGridState(rows, {getRowId})` → `{data, getRowId, onDataChange, onUndo, onRedo, history:{canUndo,canRedo,undo,redo,clear,record}}`; `<DataGridProvider {...grid}>` accepts `onUndo`/`onRedo` (part of `DataGridSyncProps`); the buttons use `grid.history.{canUndo,canRedo,undo,redo}`.
- **Docs consistency:** `quick-start.mdx` (identical undo-&-redo snippet) and `examples/addons/undo-redo.mdx` (quick-start identical; the `grid.history` field list there omits `record`, which is documented on the same page in the `record` callout — docs nit, not a demo defect).
- **Status:** OK
- **Changes:** none.

## data-grid-pagination-demo

- **External deps:** none (only `react`).
- **APIs verified:** `useDataGridPagination({data, pageSize})` client mode → `{pageData, controls}`; `<DataGridPaginationBar {...pager.controls} />` (`DataGridPaginationBarProps = DataGridPaginationControls & {...}`); id-keyed `onDataChange` merge back into the full dataset; footer outside the provider.
- **Docs consistency:** `pagination.mdx` client mode — identical snippet (including the merge callout "Edits need a merge step, not a wholesale replace" and "It is a standalone component … works whether you render it inside or outside the provider").
- **Status:** OK
- **Changes:** none.
- **Observation (registry.json, not a demo file):** the item lists `DammersCode/gridcn/data-grid-history` in `registryDependencies` but the demo does not import it (`data-grid-pagination` itself is not imported either) → consumers install the add-on unnecessarily. registry.json is central → report to the Task-2 lead.

## data-grid-demo (hero)

- **External deps:** none (only `react`).
- **APIs verified:** `DataGridProvider defaultData` + `defineColumns` with all 5 built-in cell types (`text`, `number {min,max}`, `checkbox`, `select {choices}`, `date {displayFormat: Intl.DateTimeFormatOptions}` — all against `GridCellTypes` in `types.ts`); `useDataGridFill({})` → `plugin` + `FillHandleTracker` inside `DataGridRoot`, `overlayPlugins` as a stable `useMemo` array.
- **Docs consistency:** `fill.mdx` wiring snippet (identical composition pattern including the callout "`<DataGrid>` does not wire fill in automatically … see the hero demo above"), `quick-start.mdx`.
- **Status:** OK
- **Changes:** none.

## data-grid-minimal-demo

- **External deps:** none (only `react`).
- **APIs verified:** `DataGrid` wrapper with `defaultData`/`columns`/`getRowId`/`className`; `defineColumns` with `text`/`number`/`checkbox`.
- **Docs consistency:** `quick-start.mdx` (identical `PeopleGrid` snippet, `defaultData` semantics, `getRowId` callout).
- **Status:** OK
- **Changes:** none.

## Cross-cutting notes (no cluster defects, documented only)

- `events-state.mdx` §1 shows the `DataChange.source` union without `"app"` (`types.ts` includes `"app"`) — docs drift, `content/**` outside my scope.
- `react` as an npm import is declared in no `registry.json` item → `demo:verify` warning (global, all items; consumer boilerplate).
- No demo in the cluster imports an external npm package → the Task-2 conflict rule (only the lead touches `package.json`) does not apply.
