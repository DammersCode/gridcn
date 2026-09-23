# Demo-Validation B — Data & Fetching-Demos (Cluster-B, Plan 014 Task 2 Teil 3)

Scope: 7 registry-items, Dateien unter `registry/default/examples/`.
Geprüft: (1) strikte Installierbarkeit, (2) Third-Party-APIs (n/a — keine externen Deps),
(3) gridcn-API gegen `registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx` +
Feature-Docs, (4) existierende Tests.

Getestet:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0**, alle Items + Payloads auflösbar (einziger Hinweis: `react` in keinem Item deklariert — globaler, harmlloser Boilerplate-Warning für alle ~37 Items).
- `pnpm vitest run --project=browser` (demo-fit + events + minimal + streaming): **4 Files, 33 passed, 5 skipped**. Events-Test nach dem Fix erneut: 3/3 grün.

## data-grid-lazy-demo

- **Externe Deps:** keine (nur `react`; Repo: react ^19.3.0). `registry.json`-Item: keine npm-`dependencies` ✓.
- **Geprüfte APIs:** `useDataGridLazyRows({total, fetchRows(start,end,signal), getRowId, onError(error,range)})` → `gridProps.{data,getRowId,onRowWindowChange}`, `onDataChange`, `unloadedCount`, `isLoading` (alle gegen `use-data-grid-lazy-rows.ts`); `DataGridLazyGuard hasHoles` (`lazy-guard.tsx`); `Range`; core `DataGridProvider`/`DataGridRoot onRowWindowChange`.
- **Docs-Konsistenz:** `lazy-loading.mdx` — Basic-Snippet (gleiche Prop-/Callback-Namen), `onError`-Semantik ("the next time that range comes into view, onRowWindowChange naturally re-requests it"), Guard-Callout ("Mount `<DataGridLazyGuard hasHoles={lazy.unloadedCount > 0} />` inside `<DataGridProvider>`") — alles konsistent. Demos-Beide-Fehler-Buttons + Retry (manueller `onRowWindowChange(failedRange)`-Refire) stimmen mit der Docs-Beschreibung beider Failure-Shape und "no separate retry mechanism" überein.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-streaming-demo

- **Externe Deps:** keine (nur `react`). `button`/`switch` sind shadcn-ui-Registry-Deps, als `components/ui/*` vorhanden ✓.
- **Geprüfte APIs:** `useDataGridActions().updateCells(patches, {reorder: "immediate"|"defer"})` (`UpdateCellsReorder = "defer"|"immediate"|"never"`), `reconcileView()`, `useDataGridViewStale()`, `CellPatch {rowId, columnId, value}`, `DataGridProvider.headerClickBehavior="sort"`, `defaultData`.
- **Docs-Konsistenz:** `streaming-updates.mdx` — updateCells-per-rowId, ReSortBar-Muster (`viewStale` + `reconcileView()`), reorder-Tabelle, "The demo's auto-sort switch toggles `reorder` between the modes on every tick" — alles konsistent. Runtime-Beweis: Demo-Test "holds row position and offers a re-sort …" + "re-sorts automatically on each tick once auto-sort is on" grün.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-events-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** alle Event-Props auf `DataGridProvider` (`onDataChange`, `onSelectionChange` + `SelectionChangeDetails.getValues()` lazy, `onSortChange`, `onFilterChange`, `onJoinOperatorChange`, `onColumnLayoutChange`, `onColumnResizing`), `DataGridRoot<DemoRow>`-Generic + `onRowWindowChange`/`onCellClick` (`CellClickCtx<DemoRow, unknown>`)/`onRowClick` (`RowClickCtx<DemoRow>`), `renderHeaderMenu`-ctx → `<DataGridHeaderDropdown {...ctx} />` (Prop-Shapes identisch), `useDataGridPresence()` → `setPresenceHighlights` (view-space `PresenceHighlight`-Entry), `useDataGridFill({onFill})` → `FillArgs {source, target, values, preventDefault}`, `FillHandleTracker` als Kind in `DataGridRoot`, `DataGridToolbar`/`DataGridSearch`/`DataGridFilterMenu`, `DataGridContextMenu`.
- **Docs-Konsistenz:** `events-state.mdx` §1–9 — alle Namen und Payload-Shapes konsistent; §6 verweist explizit auf diese Demo als `DataGridRoot<Person>`-Beispiel (Demo: `DataGridRoot<DemoRow>` ✓).
- **Status:** DEFECT-FIXED
- **Änderung:** Komponente-JSDoc behauptete "`onFill` … veto shown via a no-op preventDefault call for odd sums" — existiert weder im Code (Handler loggt nur, kein `preventDefault`-Aufruf) noch in den Docs. Stale-Claim aus dem Initial-Commit entfernt (1 Zeile). → **Payload-Drift:** `public/r/data-grid-events-demo.json` muss vor dem Commit per `pnpm registry:build` neu gebaut werden (Lead-Gate; `verify-payload-content` flaggt dazwischen).

## data-grid-history-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `useDataGridState(rows, {getRowId})` → `{data, getRowId, onDataChange, onUndo, onRedo, history:{canUndo,canRedo,undo,redo,clear,record}}`; `<DataGridProvider {...grid}>` akzeptiert `onUndo`/`onRedo` (Teil von `DataGridSyncProps`); Buttons nutzen `grid.history.{canUndo,canRedo,undo,redo}`.
- **Docs-Konsistenz:** `quick-start.mdx` (Undo-&-redo-Snippet identisch) und `examples/addons/undo-redo.mdx` (Quick-start identisch; `grid.history`-Feldliste dort ohne `record`, das wird aber auf derselben Seite im `record`-Callout dokumentiert — Docs-nit, kein Demo-Defekt).
- **Status:** OK
- **Änderungen:** keine.

## data-grid-pagination-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `useDataGridPagination({data, pageSize})` Client-Mode → `{pageData, controls}`; `<DataGridPaginationBar {...pager.controls} />` (`DataGridPaginationBarProps = DataGridPaginationControls & {...}`); id-keyed `onDataChange`-Merge zurück in den Gesamtdatensatz; Footer außerhalb des Providers.
- **Docs-Konsistenz:** `pagination.mdx` Client-Mode — identisches Snippet (inkl. Merge-Callout "Edits need a merge step, not a wholesale replace" und "It is a standalone component … works whether you render it inside or outside the provider").
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung (registry.json, kein Demo-File):** Item listet `DammersCode/gridcn/data-grid-history` in `registryDependencies`, importiert das Demo aber nicht (auch `data-grid-pagination` selbst nicht) → Consumer installiert das Add-on unnötig mit. registry.json ist zentral → ans Task-2-Lead melden.

## data-grid-demo (Hero)

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `DataGridProvider defaultData` + `defineColumns` mit allen 5 Built-in-Cell-Typen (`text`, `number {min,max}`, `checkbox`, `select {choices}`, `date {displayFormat: Intl.DateTimeFormatOptions}` — alle gegen `GridCellTypes` in `types.ts`); `useDataGridFill({})` → `plugin` + `FillHandleTracker` in `DataGridRoot`, `overlayPlugins` als stabiles `useMemo`-Array.
- **Docs-Konsistenz:** `fill.mdx` Wiring-Snippet (identisches Kompositions-Muster inkl. Callout "`<DataGrid>` does not wire fill in automatically … see the hero demo above"), `quick-start.mdx`.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-minimal-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `DataGrid`-Wrapper mit `defaultData`/`columns`/`getRowId`/`className`; `defineColumns` mit `text`/`number`/`checkbox`.
- **Docs-Konsistenz:** `quick-start.mdx` (identisches `PeopleGrid`-Snippet, `defaultData`-Semantik, `getRowId`-Callout).
- **Status:** OK
- **Änderungen:** keine.

## Quervermerke (kein Cluster, nur dokumentiert)

- `events-state.mdx` §1 zeigt den `DataChange.source`-Union ohne `"app"` (`types.ts` enthält `"app"`) — Docs-Drift, `content/**` außerhalb meines Scopes.
- `react` als npm-Import in keinem `registry.json`-Item deklariert → `demo:verify`-Warning (global, alle Items; Consumer-Boilerplate).
- Kein Demo des Clusters importiert ein externes npm-Paket → Task-2-Konflikt-Regel (nur Lead toucht `package.json`) greift nicht.
