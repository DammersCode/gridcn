# Demo-Validation D — Appearance & Sonstige Demos (Cluster-D, Plan 014 Task 2 Teil 3)

Scope: 18 registry-items (11 zugewiesen + 7 unzugeordnete Reste nach Vollauflösung der 42 `registry:example`-Items
gegen die Cluster-A/B/C-Zuordnungen: sorting-filtering, keybindings, pinning, column-layout, row-ops,
large-data, performance), Dateien unter `registry/default/examples/`.
Geprüft: (1) strikte Installierbarkeit, (2) Third-Party-APIs, (3) gridcn-API gegen
`registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx` + Feature-Docs,
(4) existierende Unit-Tests.

Getestet:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0** — "All registry:example items
  resolve: dependencies exist and every payload import resolves." (Nur `!`-Hinweise für `react` /
  `lucide-react` / `sonner` ohne explizite Deklaration — informationell; `lucide-react` wird von der
  shadcn-CLI automatisch geholt, `react` ist Consumer-Boilerplate).
- `pnpm vitest run --project=unit registry/default/examples/data-grid-playground-demo.test.tsx`:
  **2/2 passed** (einziger Unit-Test meines Clusters; `custom-cell` gehört zu Cluster A).
- `pnpm vitest run --project=browser registry/default/examples/demo-smoke.browser.test.tsx`:
  **42/42 passed** (mountet alle Demos, deckt meine 18 ab).
- `pnpm registry:verify`: Payload-Drift nur bei `data-grid-events-demo.json` (Cluster B; von B
  bereits dokumentiert). Meine 18 Payloads sind in Sync — die seit `689a49b` geänderten
  `data-grid-loading-demo.tsx` / `data-grid-performance-demo.tsx` (Token-Fixes + Loading-Startzustand)
  sind über den `registry.json`-Commit von `2a37d87` bereits neu gebaut.

## data-grid-i18n-demo

- **Externe Deps:** keine (nur `react`; `select` als shadcn-Registry-Dep direkt deklariert ✓).
- **Geprüfte APIs:** `DataGridProvider labels` (`DeepPartialLabels`, Deep-Merge über `DEFAULT_LABELS`;
  genutzte Keys `toolbar.searchPlaceholder/filter/columns`, `grid.emptyState/loading` — alle existieren
  in `labels.ts`); `DataGridRoot direction` (`GridDirection = "ltr"|"rtl"`, `windowing/direction.ts`);
  `DataGridToolbar`/`DataGridSearch`; `pin: "left"` (ColumnDef).
- **Docs-Konsistenz:** `i18n.mdx` — `labels`/`direction`/`DeepPartialLabels` alle dokumentiert ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-styling-patterns-demo

- **Externe Deps:** keine (nur `react`; `select` transitiv via `data-grid`).
- **Geprüfte APIs:** `DataGrid getRowClassName` (`GetRowClassName<TData>`, stabile Modul-Identität),
  `density` (`DensityMode = "compact"|"default"|"comfortable"`), per-Kolonne `cellClassName`/
  `headerClassName` String-Form (ColumnDef, `cn()`-Merge), `select`-Spalte mit `options.choices`.
- **Docs-Konsistenz:** `styling-theming.mdx` — `getRowClassName`/`getCellClassName`/`cellClassName`/
  `headerClassName`/`density`/`rowHeight` alle dokumentiert ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-conditional-styling-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `getRowClassName`, `getCellClassName` (`CellClassNameCtx = {value, row, column,
  viewRowIndex}` — Demo dekonstruiert `{column, value}` ✓), per-Kolonne `cellClassName`/
  `headerClassName` String-Form, `select`-choices.
- **Docs-Konsistenz:** `styling-theming.mdx` ✓ (wie oben).
- **Status:** OK
- **Änderungen:** keine.

## data-grid-custom-headers-demo

- **Externe Deps:** `lucide-react` — nicht in `registry.json`-`dependencies`, aber shadcn-CLI holt sie
  automatisch (OK, kein Defekt); in `package.json` deklariert (`^1.46.0`); Icons
  `ArrowDown/ArrowUp/Minus/TrendingDown/TrendingUp/User` alle in der installierten d.ts (1.46.0) vorhanden.
- **Geprüfte APIs:** `header` als ReactNode + `headerText` (ColumnDef: String-Header bekommt die
  Built-in-Sort-Pfeile, ReactNode-Header "own their display" — mit Demoverhalten konsistent),
  `useDataGridSortState(): SortSpec[]` (`{columnId, direction}`), `DataGridProvider
  headerClickBehavior="sort"`.
- **Docs-Konsistenz:** `columns.mdx` (`headerText`/`accessorFn`/`flex` ✓) + `examples/columns/custom-headers.mdx`
  (`useDataGridSortState` ✓).
- **Status:** OK
- **Änderungen:** keine.

## data-grid-custom-markers-demo

- **Externe Deps:** `lucide-react` (s.o., OK): Icons `Check/Circle/List/ListChecks/ListMinus/Minus`
  alle in 1.46.0 vorhanden.
- **Geprüfte APIs:** `DataGridProvider rowMarkers="checkbox"` (`RowMarkersMode`),
  `DataGridRoot renderMarker` (`MarkerCellRenderCtx = {viewRowIndex, isRowChannelSelected,
  isCellSelected}` — `layout-context.ts`), `renderMarkerHeader` (`MarkerHeaderRenderCtx =
  {allSelected: "checked"|"indeterminate"|"unchecked"}`), `useDataGridActions().setAllRowsSelected`.
- **Docs-Konsistenz:** `examples/rows/row-markers.mdx` — `rowMarkers`/`renderMarker`/`renderMarkerHeader`
  dokumentiert ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-row-markers-demo

- **Externe Deps:** keine (nur `react`; `select` direkt deklariert ✓).
- **Geprüfte APIs:** `rowMarkers` auf dem Provider, `RowMarkersMode`-Werte `none|number|checkbox|both`
  (Demo-Subset von `none|number|checkbox|both|reorder` — gültig).
- **Docs-Konsistenz:** `examples/rows/row-markers.mdx` ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-loading-demo

- **Externe Deps:** keine (nur `react`; `switch` direkt deklariert ✓).
- **Geprüfte APIs:** `DataGridProvider data` (kontrolliert, vs. `defaultData`), `DataGridRoot loading`
  (JSDoc: 0 Rows + loading = Skeleton, Rows + loading = Indeterminate-Bar, sonst Empty-State —
  deckungsgleich mit den drei Demo-Zuständen).
- **Docs-Konsistenz:** `examples/appearance/loading-states.mdx` — `loading`/Skeleton/Empty-State
  konsistent ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-presence-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `useDataGridPresence()` → `{plugin, setPresenceHighlights}` (eigener Store,
  Plugin-Identität stabil); `PresenceHighlightEntry` = view-space `PresenceHighlight {id, color,
  range: GridRect, label?}` ODER rowId-native `RowIdRangePresenceHighlight {id, color, rowIds,
  columnIds, label?}` (beide Demo-Formen gegen `presence-store.ts`); `DataGridProvider overlayPlugins`,
  `headerClickBehavior="sort"` (Linus-Highlight folgt den Row-Ids über Sorts hinweg).
- **Docs-Konsistenz:** `examples/addons/presence.mdx` — `useDataGridPresence`/`setPresenceHighlights`/
  `rowIds`/`columnIds` konsistent ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-pinned-rows-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `useDataGridState(rows, {getRowId})` (History-Add-on, spreadable),
  `useDataGridPinnedRows({topRows, bottomRows})` → `rowBands` (stabile Identität bei stabilen
  Arrays), `DataGridProvider rowBands`, `DataGridAggregateReporter {specs, onChange}` +
  `AggregateSpecs` (`"avg"`/`"sum"` + Custom-Reducer `(values, rows) => unknown`),
  `DataGridToolbar`/`DataGridFilterMenu` (filter-aware Aggregation via `viewIndex`).
- **Docs-Konsistenz:** `examples/addons/pinned-rows.mdx` — `useDataGridPinnedRows`/
  `DataGridAggregateReporter`/`topRows`/`bottomRows` konsistent ✓ (`AggregateSpecs`-Typname selbst
  dort nicht genannt — Nit, kein Defekt).
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung:** Dev-Warnung "rowBands identity changed" im Smoke (1× pro Band beim ersten
  Aggregate-Report vom EMPTY-Row auf den berechneten Wert) — legitimer einmaliger Content-Change,
  kein per-Render-Churn (Aggregat ist auf `viewIndex/data/specs`-Identitäten gememoized, Specs in
  Modul-Scope) → kein Defekt.

## data-grid-fill-patterns-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `useDataGridFill({})` → `{plugin, FillHandleTracker}` (Options `disabled`/
  `onFill` optional); `overlayPlugins` via stabiles `useMemo`; `<FillHandleTracker />` als Kind in
  `DataGridRoot` (braucht Root-Subtree, JSDoc bestätigt).
- **Docs-Konsistenz:** `examples/addons/fill.mdx` — `useDataGridFill`/`FillHandleTracker`-Wiring
  identisch ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-playground-demo

- **Externe Deps:** `lucide-react` (s.o., OK): Icons `ArrowDown/ArrowUp/Check/Circle/List/ListChecks/
  Minus/TrendingDown/TrendingUp/Upload/User` alle in 1.46.0 vorhanden. `@dnd-kit/*` (Toolbar/
  Sort-List) und `xlsx`/`papaparse` (io) transitiv über die Block-Items; alle in `package.json`.
- **Geprüfte APIs:** (alle gegen Quell-JSDoc) `useDataGridState`-Spread + `grid.data`;
  `useDataGridActions().updateCells(CellPatch[], {reorder})` (`"defer"|"immediate"` ⊂
  `UpdateCellsReorder`); `useDataGridFill`/`useDataGridPresence` (Plugin-Array `useMemo`);
  `useDataGridPinnedRows` + `DataGridAggregateReporter` (Bottom-Band-Muster);
  `useDataGridLazyRows({total, fetchRows(start,end,signal), getRowId})` →
  `gridProps.{data,getRowId,onRowWindowChange}`, `onDataChange`, `unloadedCount`;
  `DataGridLazyGuard hasHoles` (im Provider, neben dem Root); kontrolliertes `sortState={[]}` +
  `onSortChange` (Server-Sort, `sortState` bewusst leer); `useDataGridPagination({data, pageSize})`
  → `pageData`/`controls` + `<DataGridPaginationBar {...pager.controls} />`;
  `DataGridContextMenu` + `renderHeaderMenu`-ctx `{column, index, trigger}` =
  `DataGridHeaderDropdown`-Props (identisch); `DataGridSortList`;
  `DataGridKeybindingsDialog {open, onOpenChange}` (Provider-Genüge) +
  `DataGridKeybindingsShortcut {onOpen}` (in Root); `DataGridExportButton` (props optional) +
  `DataGridImportButton {createRow, onImport}`; `enableRowReorder`, `rowMarkers` (inkl. `"reorder"`),
  `density`/`direction`/`readOnly`/`loading` auf `DataGridRoot`; `validate`-Swap auf Age-Spalte
  (Function-Form, `string|null`); `defineColumns`-Typen (`ColumnDef<DemoRow, unknown>[]`).
- **Docs-Konsistenz:** `playground.mdx` + `lazy-loading.mdx` (Server-Sort-Escape-Hatch: kontrollierte
  `sortState` bleibt leer, Spec geht an die API) + `pagination.mdx` + `examples/addons/*` —
  konsistent ✓.
- **Status:** OK
- **Änderungen:** keine.
- **Tests:** `data-grid-playground-demo.test.tsx` (unit, Mode-Umschaltung virtualized→paginated→lazy,
  Rules-of-Hooks über Remounts) 2/2 grün; Smoke-Mount grün.

## data-grid-sorting-filtering-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `headerClickBehavior="sort"` (Click-Zyklus asc→desc→clear, Shift für
  Multi-Sort — Header-Verhalten), `DataGridSearch` (Quick-Search + Match-Navigation),
  `DataGridFilterMenu`, per-Kolonne `filterable: true`.
- **Docs-Konsistenz:** `sorting-filtering-search.mdx` — `headerClickBehavior`/`DataGridSearch`/
  `DataGridFilterMenu` konsistent ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-keybindings-demo

- **Externe Deps:** keine (nur `react`; `button` transitiv via `data-grid`).
- **Geprüfte APIs:** `DataGridKeybindingsDialog {open, onOpenChange}` (im Provider, außerhalb des
  Roots erlaubt — JSDoc: "the dialog itself only needs the provider"),
  `DataGridKeybindingsShortcut {onOpen}` (in `DataGridRoot` gemountet — JSDoc: "mount INSIDE
  DataGridRoot").
- **Docs-Konsistenz:** `examples/addons/keybindings.mdx` ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-pinning-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `pin: "left"`/`"right"` (ColumnDef), `resizable: false`,
  `accessorFn`-only-Kolonne (read-only by construction, JSDoc), `flex: 1`,
  `renderHeaderMenu` → `DataGridHeaderDropdown`, `DataGridColumnsMenu` (Hidden-Wiederherstellung).
- **Docs-Konsistenz:** `columns.mdx` (`pin`/`resizable`/`accessorFn` ✓) + `examples/columns/pinning.mdx`
  ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-column-layout-demo

- **Externe Deps:** keine (nur `react`; `button` transitiv via `data-grid`).
- **Geprüfte APIs:** `ColumnLayout = {widths, order, pins, hidden}` (persisted-Snapshot-Shape,
  Demo zeigt `layout.order`), `defaultColumnLayout` (uncontrolled Seed, JSDoc),
  `onColumnLayoutChange` (Store-Actions-Layer), `number`-Options `{min, max}`.
- **Docs-Konsistenz:** `examples/columns/column-layout.mdx` — `defaultColumnLayout`/
  `onColumnLayoutChange` konsistent ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-row-ops-demo

- **Externe Deps:** keine (nur `react`; `switch` direkt, `button` transitiv via `data-grid`).
- **Geprüfte APIs:** `DataGridProvider createRow`/`duplicateRow`,
  `useDataGridActions().insertRows(viewRowIndex, count, "above"|"below")` /
  `duplicateRows(viewRowIndexes)` / `deleteRows(viewRowIndexes)` (view-basiert — deckt sich mit
  `selection.rows.toArray()` (`CompactSelectionLike`: `length`/`toArray()`) und
  `useDataGridActiveCell().row`), `DataGridRoot readOnly`, `DataChange = {ops, source, label?}` mit
  `DataOp {type, rowId, ...}` (Panel rendert exakt diese Felder).
- **Docs-Konsistenz:** `row-operations.mdx` + `examples/rows/row-operations.mdx` —
  `createRow`/`duplicateRow`/`insertRows`/`duplicateRows`/`deleteRows`/`onDataChange` konsistent ✓.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-large-data-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** `DataGrid`-Wrapper mit 100k Rows (windowed Rendering, alle Built-in-
  Cell-Typen `text`/`number`/`checkbox`/`select`/`date` gegen `GridCellTypes`).
- **Docs-Konsistenz:** `examples/data/large-data.mdx` + `performance.mdx` ✓.
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung:** Dev-Warnung "viewport shows more than 200 rows" im Smoke-Harness — Harness-Artefakt
  (Browser-Setup lädt kein CSS, `h-[420px]`/`h-full` greifen dort nicht); im App-/Doku-Preview mit
  Tailwind ist die Höhe boundiert. Kein Defekt.

## data-grid-performance-demo

- **Externe Deps:** keine (nur `react`).
- **Geprüfte APIs:** wie large-data + `rowMarkers="number"` auf dem Provider; FpsMeter ist reines
  React (rAF/`performance.now()`), keine Grid-APIs.
- **Docs-Konsistenz:** `performance.mdx` (Virtualisierung-Claim) ✓.
- **Status:** OK
- **Änderungen:** keine.

## Quervermerke (kein Cluster-Defekt, nur dokumentiert)

- **registry.json (zentral → ans Task-2-Lead):** 8 meiner Items deklariert
  `DammersCode/gridcn/data-grid-history` in `registryDependencies`, ohne das Add-on zu importieren
  (styling-patterns, conditional-styling, row-markers, sorting-filtering, keybindings, pinning,
  large-data, performance) — Consumer installiert das Add-on unnötig mit (harmlos; Block ist
  standalone). Gleiches Muster wie bei Cluster B's Beobachtung.
- **`lucide-react`** steht in keinem der 42 Items unter `dependencies` (CLI-Auto-Install);
  `package.json` deklariert `^1.46.0`; alle 12 in meinen Demos verwendeten Icons existieren in der
  installierten Version (d.ts-Check). Konsistent, kein Defekt.
- **Payload-Drift:** `pnpm registry:verify` flaggt nur `data-grid-events-demo.json` (Cluster B,
  dort bereits als Rebuild-Bedarf dokumentiert). Meine 18 Items sind driftfrei.
- **`react`-Hinweise** in `demo:verify` sind global (alle Items), Consumer-Boilerplate.
