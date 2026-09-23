# Demo-Validation C — Toolbar, Menüs & Drag-Demos (Cluster-C, Plan 014 Task 2 Teil 3)

Scope: 9 registry-items, Dateien unter `registry/default/examples/`. `data-grid-drag-reorder-demo`
lässt sich per registry.json auf `data-grid-column-drag-demo` auflösen; ein eigenständiges
`data-grid-filtering-demo` existiert nicht (Filtering läuft über `data-grid-sorting-filtering-demo`);
`data-grid-url-state-demo` existiert ✓.

Geprüft: (1) strikte Installierbarkeit (npm-Import → Item-`dependencies` + Repo-`package.json`),
(2) Third-Party-API-Korrektheit gegen installierte Versionen (d.ts), (3) gridcn-API gegen
`registry/default/blocks/**` + JSDoc + `content/docs/api-reference.mdx` + Feature-Docs,
(4) existierende Demo-Unit-Tests.

Getestet:
- `node scripts/verify-demo-install.mjs` (`pnpm demo:verify`): **exit 0** (alle 42 Items auflösbar).
  Meine Items: nur das globale, harmlose `react`-Boilerplate-Warning; zusätzlich bei
  `data-grid-column-drag-demo` `import "lucide-react" is not declared in any closure item's
  registry.json dependencies` (detailliert unten).
- Demo-Unit-Tests: existieren in diesem Cluster **keine** (einzigen Demo-Tests sind
  `data-grid-custom-cell-demo.test.tsx` + `data-grid-playground-demo.test.tsx`, andere Cluster)
  → nichts zu laufen lassen. Block-Ebene (Add-on-Tests) und der Fleet-Runtime-Beweis
  (`demo-smoke.browser.test.tsx`, commit `f2d3143`, grün) decken die Demos ab.

## data-grid-sort-list-demo

- **Externe Deps (installierte Versionen):** keine im Demo-File (nur `react`). Transitiv via
  `data-grid-toolbar`/`data-grid-sort-list`-Blocks: `@dnd-kit/react` 0.5.0, `@dnd-kit/dom` 0.5.0
  (beide in deren Item-`dependencies` ✓, Repo-`package.json` ✓).
- **Geprüfte APIs:**
  - `@dnd-kit/react` 0.5.0 (Block `sort-list.tsx`): `DragDropProvider` mit `plugins` als
    `Customizable`-Funktion `(defaults) => defaults.filter(p => p !== AutoScroller)`
    (`DragDropManagerInput.plugins?: Customizable<Plugins>` ✓), `onDragStart`/`onDragEnd`;
    `dragend`-Event = `{ operation: {source, target}, canceled }` ✓ (`event.canceled`,
    `event.operation.source?.data` — `source: T | null`, `Entity.data`-Accessor ✓).
    `useSortable` aus `@dnd-kit/react/sortable` (Subpath existiert ✓) mit `{id, index, data,
    plugins: []}` → `{ref, handleRef, isDragSource}` ✓; `plugins: []` ersetzt die Defaults
    `[SortableKeyboardPlugin, OptimisticSortingPlugin]` — beabsichtigt (doku-Comment im Block),
    Tastatur-Reorder läuft über den eigenen ArrowUp/ArrowDown-Handler auf dem Grip
    (dnd-kit v1 Keyboard-Sensor-API nicht nötig).
  - `AutoScroller`-Export aus `@dnd-kit/dom` ✓ (installierte d.ts).
- **gridcn-API:** `DataGridProvider defaultData/columns/getRowId`, `DataGridToolbar` (children),
  `DataGridSortList` ohne Props (`DataGridSortListProps = { className? }`), `defineColumns`,
  `useDataGridSortState`/`setSorts` im Block — alle gegen `data-grid.tsx`/`store/types.ts`
  verifiziert ✓.
- **Docs-Konsistenz:** `examples/addons/sort-list.mdx` (identisches `<DataGridSortList />`-Snippets),
  `sorting-filtering-search.mdx` §Sort list — konsistent.
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung (registry.json, kein Demo-File):** Item listet `data-grid-history` in
  `registryDependencies`, importiert es aber nicht → Consumer installiert das Add-on unnötig mit.
  Zentral → ans Task-2-Lead.

## data-grid-context-menu-demo

- **Externe Deps:** keine (nur `react`; `@base-ui/react` + `components/ui/*` gehören zum
  `data-grid-context-menu`-Block bzw. sind Shadcn-Boilerplate). Item-`dependencies`: keine ✓.
- **Geprüfte APIs:**
  - `DataGridProvider.createRow?: (index) => TData` / `duplicateRow?: (row, index) => TData`
    (`data-grid.tsx` JSDoc) — Demo-Funktionen modulweit (stabile Identität), `duplicateRow`
    erzeugt kollisionsfreie Ids (`${row.id}-copy-…`) ✓.
  - `DataGridContextMenu { className?, children? }` ✓; `DataGridHeaderDropdown`-Props =
    `renderHeaderMenu`-ctx "exactly" (Block-JSDoc `header-dropdown.tsx:12`), Root-Prop
    `renderHeaderMenu` (`root.tsx:84`) ✓.
- **gridcn-API:** `DataGridRoot renderHeaderMenu`, `DataGridHeader`/`DataGridBody`,
  `type: "select"` mit `options.choices` (werte decken `generateDemoRows`-Roles ab) ✓.
- **Docs-Konsistenz:** `examples/addons/context-menu.mdx` (cut/copy/paste/clear + Row-ops,
  `createRow`-Callout) und `row-operations.mdx` (Enable-Props) — konsistent.
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung (registry.json, kein Demo-File):** unnötiges `data-grid-history`-registryDep
  (wie oben) → Lead.

## data-grid-keybindings-demo

- **Externe Deps:** keine (nur `react`; `button` = Shadcn-UI). Item-`dependencies`: keine ✓.
- **Geprüfte APIs:**
  - `DataGridKeybindingsDialog { open?, onOpenChange?, defaultOpen?, trigger? }` — Demo kontrolliert
    `open`/`onOpenChange` extern (Toolbar-Button), Dialog direkt im Provider ✓.
  - `DataGridKeybindingsShortcut { onOpen }` — JSDoc: INSIDE `DataGridRoot` mounten (liest den
    Container), Dialog nur Provider nötig — Demo befolgt beides ✓. `?` (shift+/) wird
    `stopImmediatePropagation` vor Grid-Keymap/Type-to-Edit beansprucht (Block-JSDoc).
  - `Button variant="outline" size="sm"` ✓ (`size`-Variants inkl. `xs` in `components/ui/button.tsx`).
- **gridcn-API:** `useDataGridKeymap()` (effektives Keymap = `DEFAULT_KEYMAP` + Override) und
  `useDataGridLabels()` im Dialog-Block — gegen `data-grid.tsx`-Exports verifiziert ✓.
- **Docs-Konsistenz:** Keybindings-Bezug in `api-reference.mdx` + `examples/addons`-Nav —
  konsistent.
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung (registry.json, kein Demo-File):** unnötiges `data-grid-history`-registryDep → Lead.

## data-grid-io-demo

- **Externe Deps (installierte Versionen):** `xlsx` 0.18.5, `papaparse` 5.7.0 — beide im
  `data-grid-io`-Item-`dependencies` ✓ (Demo-File selbst importiert weder xlsx noch papaparse;
  beides wird in den Block-Files via lazy `import("xlsx")`/`import Papa` genutzt) und in
  Repo-`package.json` ✓. Item-`dependencies` des Demos: keine — korrekt, kein direkter npm-Import.
- **Geprüfte APIs:**
  - SheetJS 0.18.5 (`parse-import-file.ts`/`export-grid.ts`): `XLSX.read(buffer, {type:"array"})`,
    `workbook.SheetNames`/`workbook.Sheets[name]`, `XLSX.utils.sheet_to_json(sheet, {header:1,
    raw:false, defval:""})`, `XLSX.utils.aoa_to_sheet`, `book_new`/`book_append_sheet`,
    `XLSX.write(wb, {bookType:"xlsx", type:"array"})` — alle Standard-0.18.5-APIs ✓.
  - papaparse 5.7.0: `Papa.parse<string[]>(text, {delimiter, skipEmptyLines:true})` →
    `result.data` + `result.meta.delimiter` (Auto-Detect) ✓.
- **gridcn-API:** `useDataGridState(rows, {getRowId})` → `{data, onDataChange, history}`
  (`use-data-grid-state.ts` JSDoc: kontrolliertes `data`-Spread); `<DataGridProvider {...grid}>` ✓;
  `DataGridImportButton {createRow (required), onImport(rows)}` — Demo-`onImport` baut einen
  id-keyed Op-Batch (`delete` alle alten + `insert` neue, `source: "import"` — gültiges
  `DataChange.source`-Union-Mitglied ✓); `applyChange` sammelt Deletes zuerst und platziert
  Inserts danach (`history.ts:56ff`) → Replace-by-batch funktioniert ✓. `DataGridExportButton`
  ohne Props ✓.
- **Docs-Konsistenz:** `examples/addons/import-export.mdx` (identisches
  `<DataGridImportButton createRow={…} onImport={…} />`-Snippet, `createRow`-required-Callout,
  "The dialog never writes to the grid directly") — konsistent.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-row-reorder-demo

- **Externe Deps:** keine (nur `react`; `button` = Shadcn-UI). Item-`dependencies`: keine ✓.
- **Geprüfte APIs:**
  - `DataGridProvider.rowMarkers: RowMarkersMode` inkl. `"reorder"` (`types.ts:94`) +
    `enableRowReorder` ✓; Drag reihenbasiert via Marker-Grip (Core-eigene DnD, kein @dnd-kit —
    `data-grid`-Block deklariert nur `zustand` 5.0.15 ✓).
  - `useDataGridActions().reorderRows(from, to): boolean` (`store/types.ts:629`);
    `useDataGridActiveCell(): CellCoord | null` = `{col, row}` (`types.ts:81`) — Demo nutzt
    `activeCell.row` ✓; `canMove`-Guard gegen letzte Zeile ✓.
  - `grid.history.canUndo`/`grid.history.undo` ✓; `onDataChange`-Wrapper (grid.onDataChange +
    lokal halten) — kontrollierter `data`-Modus via `useDataGridState`-Spread, JSDok-konform ✓.
  - `DataChange<TData>.ops` — `move`-Op = `{type, rowId, row, from, to}` (`types.ts:147`) ✓;
    `MoveOp`-Type im Demo identisch.
- **Docs-Konsistenz:** `row-operations.mdx` — `rowMarkers="reorder"`, `enableRowReorder`-Tabelle,
  `reorderRows(from, to)` (data-space), No-op-Callout (sort/filter aktiv — Demo hat weder Sort
  noch Filter, konsistent) — alles übereinstimmend.
- **Status:** OK
- **Änderungen:** keine.

## data-grid-sorting-filtering-demo

- **Externe Deps:** keine (nur `react`; `@dnd-kit/*` transitiv via `data-grid-toolbar`-Block,
  dessen Item-`dependencies` ✓). Item-`dependencies`: keine ✓.
- **Geprüfte APIs:**
  - `headerClickBehavior: "sort"` (`HeaderClickBehavior = "select" | "sort" | "none"`,
    `types.ts:432`) — Click-Cycling asc→desc→clear + Shift-Click-Multi-Sort (Core-Verhalten,
    `header-cell.tsx`) ✓.
  - Column-Flag `filterable?: boolean` (`types.ts:401`) auf `number`- und `select`-Spalte ✓;
    Operatoren via `operatorsForColumnType` im Filter-Menu-Block.
  - `DataGridSearch {className?, placeholder?, modF?}` / `DataGridFilterMenu {className?}` —
    alle optional, Demo rendert beide nackt im `DataGridToolbar` ✓.
  - Filter-Menu-Block nutzt dasselbe `@dnd-kit/react`-Sortable-Pattern wie `sort-list` (s.o.) —
    gegen installierte d.ts identisch verifiziert ✓.
- **Docs-Konsistenz:** `sorting-filtering-search.mdx` (Header-Sort-Cycling, Shift-Click,
  per-column Filter) — konsistent.
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung (registry.json, kein Demo-File):** unnötiges `data-grid-history`-registryDep → Lead.

## data-grid-pinning-demo

- **Externe Deps:** keine (nur `react`). Item-`dependencies`: keine ✓.
- **Geprüfte APIs:**
  - Column-Flags `pin?: "left" | "right"` (`types.ts:397`), `resizable?: boolean` (L405),
    `reorderable?: boolean` (L407), `pinnable?: boolean` (L409) ✓; `accessorFn?: (row) =>
    unknown` (`column-helpers.ts:91`) ✓.
  - Grid-weit: `enableColumnPinning`/`enableColumnReorder`/`enableColumnResize` (Provider-Props,
    Default `true`, per-Column-Flag gewinnt) ✓ — JSDoc-Claims der Demo stimmen mit `types.ts`
    überein.
  - `DataGridColumnsMenu {className?}` (Show/Hide + Restore) ✓; `DataGridContextMenu` +
    `DataGridHeaderDropdown` (Pin/Unpin/Autosize) wie context-menu-Demo verifiziert ✓.
- **Docs-Konsistenz:** `columns.mdx` (`enableColumnReorder={false}`, Pin-Zonen,
  imperative Actions) — konsistent.
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung (registry.json, kein Demo-File):** unnötiges `data-grid-history`-registryDep → Lead.

## data-grid-column-drag-demo

- **Externe Deps (installierte Versionen):** `lucide-react` 1.46.0 (Repo: ^1.46.0 ✓) — wird im
  Demo-File DIREKT importiert (`ChevronLeft`/`ChevronRight`). Item-`dependencies`: `[]` →
  **fehlt im registry.json-Item** (auch kein Closure-Item deklariert es; `data-grid`-Block
  deklariert nur `zustand`, Shadcn-Default-Registry-Items für `button`/`select` ziehen
  `lucide-react` nicht mit). Ein minimaler Consumer ohne `lucide-react` bricht beim Build.
- **Geprüfte APIs:**
  - `DataGridProvider.enableColumnReorder` (Default true, Demo setzt es explizit) +
    `reorderable: false` (Name) + `pin: "right"` (Score, reordert nur in der Pin-Zone) —
    gegen `types.ts`/`data-grid.tsx` ✓.
  - `useDataGridActions().setColumnOrder(id, targetId, position: "before" | "after")`
    (`store/types.ts:520`) — Demo ruft `setColumnOrder(selectedId, neighborId, step===-1 ?
    "before" : "after")` ✓ (Semantik: gewählte Spalte vor/nach Nachbar).
  - `useDataGridVisibleColumns<DemoRow>(): readonly ColumnDefOf<TData>[]` (`store/hooks.ts:239`)
    → `column.id`/`column.header` ✓; Controls außerhalb des `DataGridRoot`, aber im Provider
    (Hooks brauchen nur Provider-Context) ✓.
- **Docs-Konsistenz:** `examples/columns/drag-reorder.mdx` — `enableColumnReorder`,
  `setColumnOrder(id, targetId, "before" | "after")`, Pin-Zone-Beschreibung — konsistent.
- **Status:** DEFECT-OPEN (strikte Installierbarkeit; Demo-Code selbst korrekt)
- **Änderungen:** keine in Demo-Datei.
  - **registry.json (NICHT editiert, zentral, ans Task-2-Lead):** `lucide-react` in die
    Item-`dependencies` von `data-grid-column-drag-demo` aufnehmen + `pnpm registry:build`
    (gleicher Befund wie `demo:verify`-Warning; Präzedenz: Cluster-A `sonner`-Fall).

## data-grid-url-state-demo

- **Externe Deps (installierte Versionen):** `nuqs` 2.10.1 — im Item-`dependencies` ✓ UND in
  Repo-`package.json` (^2.10.1) ✓.
- **Geprüfte APIs:**
  - `NuqsAdapter` aus `nuqs/adapters/next/app` (installiertes Subpath-Export ✓, `package.json`
    `exports["./adapters/next/app"]` ✓); `<Suspense>`-Wrapper: App-Router-Adapter liest
    `useSearchParams()` — Next.js verlangt Suspense bei statischem Prerender (nuqs-Doku) —
    Demo befolgt es ✓; "adapters must not be nested" (Demo-JSDoc + Docs-Callout) ✓.
  - `useQueryState(key, { defaultValue, parse, serialize, history: "replace" })` (nuqs 2.10.1
    d.ts: `UseQueryStateOptions = GenericParser & Options` inkl. `history`-Mode ✓; `null`
    setzt den Query — Block nutzt `setX(… || null)` korrekt ✓).
  - `useDataGridUrlState({ prefix })` → `DataGridUrlState prefix="demo"` (Props = Options,
    rendert null) ✓; `useDataGridUrlPagination({ prefix, defaultPageSize: 10 })` →
    `{page, pageSize, onPageChange, onPageSizeChange}` ✓.
- **gridcn-API:** `useDataGridPagination({ total, ...url })` = Server-Mode (Detection via
  `"total" in options`) → `pager.controls` (`DataGridPaginationControls`); `pageRange(page,
  pageSize, total)` → `{start, end}` half-open ✓; `rows.slice(start, end)` + kontrolliertes
  `data={pageRows}` ✓; `DataGridPaginationBar {...pager.controls}` AUSSERHALB des Providers
  (JSDoc: standalone, kein Store-Zugriff) ✓; `headerClickBehavior="sort"` so die URL-
  SortState-Sync erreichbar ist ✓; Prefix-Kollisionen: `demo_sort/filter/join/q/page/pageSize`
  getrennt ✓.
- **Docs-Konsistenz:** `examples/addons/url-state.mdx` — identische Komposition
  (`useDataGridUrlPagination` + `useDataGridPagination({ total, ...url })` +
  `<DataGridPaginationBar {...pager.controls} />`), NuqsAdapter-Callouts, Pagination-Optionen —
  alles konsistent.
- **Status:** OK
- **Änderungen:** keine.
- **Beobachtung (registry.json, kein Demo-File):** unnötiges `data-grid-history`-registryDep → Lead.

## Quervermerke (kein Cluster, nur dokumentiert)

- 6 der 9 Items (`sort-list`, `context-menu`, `keybindings`, `sorting-filtering`, `pinning`,
  `url-state`) listen `DammersCode/gridcn/data-grid-history` in `registryDependencies`, importieren
  es aber nicht → unnötiger Payload für Consumer. registry.json ist zentral → Task-2-Lead
  (gleicher Befund wie Cluster-B beim `data-grid-pagination-demo`).
- `@/components/ui/*`- und `@/lib/utils`-Imports der Blocks/Demos (`button`, `select`, `dialog`,
  `popover`, `dropdown-menu`, `context-menu`, `badge`, `input`) haben KEINE Items in dieser
  `registry.json` → Auflösung über die Shadcn-CLI-Auto-Resolution aus dem Default-Registry
  (Präzedenz Cluster-A: `sonner`); empirischer Beweis = Task-2-Teil-4 (e2e-Install-Spotcheck).
  `kbd` ist selbst enthalten (`data-grid-keybindings`-Item ships `components/ui/kbd.tsx`).
- `react` als npm-Import in keinem Item deklariert → `demo:verify`-Warning (global, alle Items;
  Consumer-Boilerplate).
- Keine Demo-Datei des Clusters geändert → kein Payload-Drift, kein `pnpm registry:build` nötig.
