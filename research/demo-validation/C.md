# Demo Validation C — Toolbar, Menus & Drag demos (Cluster C, Plan 014 Task 2 part 3)

Scope: 9 registry items, files under `registry/default/examples/`. `data-grid-drag-reorder-demo`
resolves to `data-grid-column-drag-demo` via registry.json; a standalone
`data-grid-filtering-demo` does not exist (filtering runs through `data-grid-sorting-filtering-demo`);
`data-grid-url-state-demo` exists ✓.

Checked: (1) strict installability (npm import → item `dependencies` + repo `package.json`),
(2) third-party API correctness against installed versions (d.ts), (3) gridcn API against
`registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx` + feature docs,
(4) existing demo unit tests.

Tested:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0** (all 42 items resolve).
  My items: only the global, harmless `react` boilerplate warning; plus, for
  `data-grid-column-drag-demo`, `import "lucide-react" is not declared in any closure item's
  registry.json dependencies` (detailed below).
- Demo unit tests: none exist in this cluster (the only demo tests are
  `data-grid-custom-cell-demo.test.tsx` + `data-grid-playground-demo.test.tsx`, other clusters)
  → nothing to run. The block level (add-on tests) and the fleet runtime proof
  (`demo-smoke.browser.test.tsx`, commit `f2d3143`, green) cover the demos.

## data-grid-sort-list-demo

- **External deps (installed versions):** none in the demo file (only `react`). Transitive via
  the `data-grid-toolbar`/`data-grid-sort-list` blocks: `@dnd-kit/react` 0.5.0, `@dnd-kit/dom` 0.5.0
  (both in their item `dependencies` ✓, repo `package.json` ✓).
- **APIs verified:**
  - `@dnd-kit/react` 0.5.0 (block `sort-list.tsx`): `DragDropProvider` with `plugins` as a
    `Customizable` function `(defaults) => defaults.filter(p => p !== AutoScroller)`
    (`DragDropManagerInput.plugins?: Customizable<Plugins>` ✓), `onDragStart`/`onDragEnd`;
    `dragend` event = `{ operation: {source, target}, canceled }` ✓ (`event.canceled`,
    `event.operation.source?.data` — `source: T | null`, `Entity.data` accessor ✓).
    `useSortable` from `@dnd-kit/react/sortable` (subpath exists ✓) with `{id, index, data,
    plugins: []}` → `{ref, handleRef, isDragSource}` ✓; `plugins: []` replaces the default
    `[SortableKeyboardPlugin, OptimisticSortingPlugin]` — intentional (documented in a block comment),
    keyboard reordering runs through the block's own ArrowUp/ArrowDown handler on the grip
    (the dnd-kit v1 keyboard-sensor API is not needed).
  - `AutoScroller` export from `@dnd-kit/dom` ✓ (installed d.ts).
- **gridcn API:** `DataGridProvider defaultData/columns/getRowId`, `DataGridToolbar` (children),
  `DataGridSortList` without props (`DataGridSortListProps = { className? }`), `defineColumns`,
  `useDataGridSortState`/`setSorts` in the block — all verified against `data-grid.tsx`/`store/types.ts` ✓.
- **Docs consistency:** `examples/addons/sort-list.mdx` (identical `<DataGridSortList />` snippet),
  `sorting-filtering-search.mdx` §Sort list — consistent.
- **Status:** OK
- **Changes:** none.
- **Observation (registry.json, not a demo file):** the item lists `data-grid-history` in
  `registryDependencies` but does not import it → consumers install the add-on unnecessarily.
  Central → to the Task-2 lead.

## data-grid-context-menu-demo

- **External deps:** none (only `react`; `@base-ui/react` + `components/ui/*` belong to the
  `data-grid-context-menu` block or are shadcn boilerplate). Item `dependencies`: none ✓.
- **APIs verified:**
  - `DataGridProvider.createRow?: (index) => TData` / `duplicateRow?: (row, index) => TData`
    (`data-grid.tsx` JSDoc) — the demo functions are module-level (stable identity), `duplicateRow`
    generates collision-free ids (`${row.id}-copy-…`) ✓.
  - `DataGridContextMenu { className?, children? }` ✓; `DataGridHeaderDropdown` props =
    the `renderHeaderMenu` ctx "exactly" (block JSDoc `header-dropdown.tsx:12`), the root prop
    `renderHeaderMenu` (`root.tsx:84`) ✓.
- **gridcn API:** `DataGridRoot renderHeaderMenu`, `DataGridHeader`/`DataGridBody`,
  `type: "select"` with `options.choices` (values cover the `generateDemoRows` roles) ✓.
- **Docs consistency:** `examples/addons/context-menu.mdx` (cut/copy/paste/clear + row ops,
  the `createRow` callout) and `row-operations.mdx` (enable props) — consistent.
- **Status:** OK
- **Changes:** none.
- **Observation (registry.json, not a demo file):** an unnecessary `data-grid-history` registryDep
  (as above) → lead.

## data-grid-keybindings-demo

- **External deps:** none (only `react`; `button` = shadcn-ui). Item `dependencies`: none ✓.
- **APIs verified:**
  - `DataGridKeybindingsDialog { open?, onOpenChange?, defaultOpen?, trigger? }` — the demo controls
    `open`/`onOpenChange` externally (toolbar button), the dialog sits directly in the provider ✓.
  - `DataGridKeybindingsShortcut { onOpen }` — JSDoc: mount INSIDE `DataGridRoot` (reads the
    container), the dialog only needs the provider — the demo follows both ✓. `?` (shift+/) is
    claimed via `stopImmediatePropagation` ahead of the grid keymap/type-to-edit (block JSDoc).
  - `Button variant="outline" size="sm"` ✓ (`size` variants incl. `xs` in `components/ui/button.tsx`).
- **gridcn API:** `useDataGridKeymap()` (effective keymap = `DEFAULT_KEYMAP` + overrides) and
  `useDataGridLabels()` in the dialog block — verified against `data-grid.tsx` exports ✓.
- **Docs consistency:** the keybindings references in `api-reference.mdx` + the `examples/addons` nav —
  consistent.
- **Status:** OK
- **Changes:** none.
- **Observation (registry.json, not a demo file):** an unnecessary `data-grid-history` registryDep → lead.

## data-grid-io-demo

- **External deps (installed versions):** `xlsx` 0.18.5, `papaparse` 5.7.0 — both in the
  `data-grid-io` item `dependencies` ✓ (the demo file itself imports neither xlsx nor papaparse;
  both are used in the block files via lazy `import("xlsx")`/`import Papa`) and in the
  repo `package.json` ✓. The demo's item `dependencies`: none — correct, no direct npm import.
- **APIs verified:**
  - SheetJS 0.18.5 (`parse-import-file.ts`/`export-grid.ts`): `XLSX.read(buffer, {type:"array"})`,
    `workbook.SheetNames`/`workbook.Sheets[name]`, `XLSX.utils.sheet_to_json(sheet, {header:1,
    raw:false, defval:""})`, `XLSX.utils.aoa_to_sheet`, `book_new`/`book_append_sheet`,
    `XLSX.write(wb, {bookType:"xlsx", type:"array"})` — all standard 0.18.5 APIs ✓.
  - papaparse 5.7.0: `Papa.parse<string[]>(text, {delimiter, skipEmptyLines:true})` →
    `result.data` + `result.meta.delimiter` (auto-detect) ✓.
- **gridcn API:** `useDataGridState(rows, {getRowId})` → `{data, onDataChange, history}`
  (`use-data-grid-state.ts` JSDoc: controlled `data` spread); `<DataGridProvider {...grid}>` ✓;
  `DataGridImportButton {createRow (required), onImport(rows)}` — the demo's `onImport` builds an
  id-keyed op batch (`delete` all old + `insert` new, `source: "import"` — a valid
  `DataChange.source` union member ✓); `applyChange` collects deletes first and places
  inserts after (`history.ts:56ff`) → replace-by-batch works ✓. `DataGridExportButton`
  without props ✓.
- **Docs consistency:** `examples/addons/import-export.mdx` (identical
  `<DataGridImportButton createRow={…} onImport={…} />` snippet, the `createRow`-required callout,
  "The dialog never writes to the grid directly") — consistent.
- **Status:** OK
- **Changes:** none.

## data-grid-row-reorder-demo

- **External deps:** none (only `react`; `button` = shadcn-ui). Item `dependencies`: none ✓.
- **APIs verified:**
  - `DataGridProvider.rowMarkers: RowMarkersMode` incl. `"reorder"` (`types.ts:94`) +
    `enableRowReorder` ✓; drag is index-based via the marker grip (core-owned DnD, no @dnd-kit —
    the `data-grid` block declares only `zustand` 5.0.15 ✓).
  - `useDataGridActions().reorderRows(from, to): boolean` (`store/types.ts:629`);
    `useDataGridActiveCell(): CellCoord | null` = `{col, row}` (`types.ts:81`) — the demo uses
    `activeCell.row` ✓; the `canMove` guard against the last row ✓.
  - `grid.history.canUndo`/`grid.history.undo` ✓; the `onDataChange` wrapper (grid.onDataChange +
    hold locally) — controlled `data` mode via the `useDataGridState` spread, JSDoc-compliant ✓.
  - `DataChange<TData>.ops` — the `move` op = `{type, rowId, row, from, to}` (`types.ts:147`) ✓;
    the demo's `MoveOp` type is identical.
- **Docs consistency:** `row-operations.mdx` — `rowMarkers="reorder"`, the `enableRowReorder` table,
  `reorderRows(from, to)` (data space), the no-op callout (sort/filter active — the demo has neither sort
  nor filter, consistent) — everything matching.
- **Status:** OK
- **Changes:** none.

## data-grid-sorting-filtering-demo

- **External deps:** none (only `react`; `@dnd-kit/*` transitively via the `data-grid-toolbar` block,
  whose item `dependencies` ✓). Item `dependencies`: none ✓.
- **APIs verified:**
  - `headerClickBehavior: "sort"` (`HeaderClickBehavior = "select" | "sort" | "none"`,
    `types.ts:432`) — click cycling asc→desc→clear + shift-click multi-sort (core behavior,
    `header-cell.tsx`) ✓.
  - The column flag `filterable?: boolean` (`types.ts:401`) on the `number` and `select` columns ✓;
    operators via `operatorsForColumnType` in the filter-menu block.
  - `DataGridSearch {className?, placeholder?, modF?}` / `DataGridFilterMenu {className?}` —
    all optional, the demo renders both bare in the `DataGridToolbar` ✓.
  - The filter-menu block uses the same `@dnd-kit/react` sortable pattern as `sort-list` (see above) —
    verified identical against the installed d.ts ✓.
- **Docs consistency:** `sorting-filtering-search.mdx` (header sort cycling, shift-click,
  per-column filters) — consistent.
- **Status:** OK
- **Changes:** none.
- **Observation (registry.json, not a demo file):** an unnecessary `data-grid-history` registryDep → lead.

## data-grid-pinning-demo

- **External deps:** none (only `react`). Item `dependencies`: none ✓.
- **APIs verified:**
  - Column flags `pin?: "left" | "right"` (`types.ts:397`), `resizable?: boolean` (L405),
    `reorderable?: boolean` (L407), `pinnable?: boolean` (L409) ✓; `accessorFn?: (row) =>
    unknown` (`column-helpers.ts:91`) ✓.
  - Grid-wide: `enableColumnPinning`/`enableColumnReorder`/`enableColumnResize` (provider props,
    default `true`, the per-column flag wins) ✓ — the demo's JSDoc claims match `types.ts`.
  - `DataGridColumnsMenu {className?}` (show/hide + restore) ✓; `DataGridContextMenu` +
    `DataGridHeaderDropdown` (pin/unpin/autosize) verified like the context-menu demo ✓.
- **Docs consistency:** `columns.mdx` (`enableColumnReorder={false}`, pin zones,
  imperative actions) — consistent.
- **Status:** OK
- **Changes:** none.
- **Observation (registry.json, not a demo file):** an unnecessary `data-grid-history` registryDep → lead.

## data-grid-column-drag-demo

- **External deps (installed versions):** `lucide-react` 1.46.0 (repo: ^1.46.0 ✓) — imported
  DIRECTLY in the demo file (`ChevronLeft`/`ChevronRight`). Item `dependencies`: `[]` →
  **missing from the registry.json item** (no closure item declares it either; the `data-grid` block
  declares only `zustand`, and the shadcn default-registry items for `button`/`select` do not pull
  in `lucide-react`). A minimal consumer without `lucide-react` breaks at build time.
- **APIs verified:**
  - `DataGridProvider.enableColumnReorder` (default true, the demo sets it explicitly) +
    `reorderable: false` (Name) + `pin: "right"` (Score, reorders only within the pin zone) —
    against `types.ts`/`data-grid.tsx` ✓.
  - `useDataGridActions().setColumnOrder(id, targetId, position: "before" | "after")`
    (`store/types.ts:520`) — the demo calls `setColumnOrder(selectedId, neighborId, step===-1 ?
    "before" : "after")` ✓ (semantics: the selected column before/after its neighbor).
  - `useDataGridVisibleColumns<DemoRow>(): readonly ColumnDefOf<TData>[]` (`store/hooks.ts:239`)
    → `column.id`/`column.header` ✓; the controls sit outside `DataGridRoot` but inside the provider
    (the hooks only need the provider context) ✓.
- **Docs consistency:** `examples/columns/drag-reorder.mdx` — `enableColumnReorder`,
  `setColumnOrder(id, targetId, "before" | "after")`, the pin-zone description — consistent.
- **Status:** DEFECT-OPEN (strict installability; the demo code itself is correct)
- **Changes:** none in the demo file.
  - **registry.json (NOT edited, central, to the Task-2 lead):** add `lucide-react` to the
    `data-grid-column-drag-demo` item `dependencies` + `pnpm registry:build`
    (same finding as the `demo:verify` warning; precedent: the cluster A `sonner` case).

## data-grid-url-state-demo

- **External deps (installed versions):** `nuqs` 2.10.1 — in the item `dependencies` ✓ AND in the
  repo `package.json` (^2.10.1) ✓.
- **APIs verified:**
  - `NuqsAdapter` from `nuqs/adapters/next/app` (installed subpath export ✓, `package.json`
    `exports["./adapters/next/app"]` ✓); the `<Suspense>` wrapper: the app-router adapter reads
    `useSearchParams()` — Next.js requires Suspense for static prerendering (nuqs docs) —
    the demo follows it ✓; "adapters must not be nested" (demo JSDoc + docs callout) ✓.
  - `useQueryState(key, { defaultValue, parse, serialize, history: "replace" })` (nuqs 2.10.1
    d.ts: `UseQueryStateOptions = GenericParser & Options` incl. the `history` mode ✓; `null`
    clears the query — the block uses `setX(… || null)` correctly ✓).
  - `useDataGridUrlState({ prefix })` → `DataGridUrlState prefix="demo"` (props = options,
    renders null) ✓; `useDataGridUrlPagination({ prefix, defaultPageSize: 10 })` →
    `{page, pageSize, onPageChange, onPageSizeChange}` ✓.
- **gridcn API:** `useDataGridPagination({ total, ...url })` = server mode (detection via
  `"total" in options`) → `pager.controls` (`DataGridPaginationControls`); `pageRange(page,
  pageSize, total)` → `{start, end}` half-open ✓; `rows.slice(start, end)` + controlled
  `data={pageRows}` ✓; `DataGridPaginationBar {...pager.controls}` OUTSIDE the provider
  (JSDoc: standalone, no store access) ✓; `headerClickBehavior="sort"` so the URL
  sort-state sync is reachable ✓; prefix collisions: `demo_sort/filter/join/q/page/pageSize`
  separated ✓.
- **Docs consistency:** `examples/addons/url-state.mdx` — identical composition
  (`useDataGridUrlPagination` + `useDataGridPagination({ total, ...url })` +
  `<DataGridPaginationBar {...pager.controls} />`), the NuqsAdapter callouts, the pagination options —
  all consistent.
- **Status:** OK
- **Changes:** none.
- **Observation (registry.json, not a demo file):** an unnecessary `data-grid-history` registryDep → lead.

## Cross-cutting notes (no cluster defects, documented only)

- 6 of the 9 items (`sort-list`, `context-menu`, `keybindings`, `sorting-filtering`, `pinning`,
  `url-state`) list `DammersCode/gridcn/data-grid-history` in `registryDependencies` but do not
  import it → unnecessary payload for consumers. registry.json is central → Task-2 lead
  (same finding as cluster B for `data-grid-pagination-demo`).
- The `@/components/ui/*` and `@/lib/utils` imports of the blocks/demos (`button`, `select`, `dialog`,
  `popover`, `dropdown-menu`, `context-menu`, `badge`, `input`) have NO items in this
  `registry.json` → resolution via the shadcn CLI auto-resolution from the default registry
  (cluster A precedent: `sonner`); empirical proof = Task-2 part 4 (the e2e install spot-check).
  `kbd` is included on its own (the `data-grid-keybindings` item ships `components/ui/kbd.tsx`).
- `react` as an npm import is declared in no item → `demo:verify` warning (global, all items;
  consumer boilerplate).
- No demo file in the cluster changed → no payload drift, no `pnpm registry:build` needed.
