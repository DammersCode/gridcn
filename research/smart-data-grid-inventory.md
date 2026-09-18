# Smart Data Grid — Feature & Architecture Inventory

Source: `C:\repos\focus\fifes-web\src\Web\src\components\smart-data-grid` (~35 files).
This is the author's prior grid — a wrapper around `@glideapps/glide-data-grid` v6 (canvas). gridcn replaces it with a custom DOM engine, but several parts are worth carrying over.

**One-line summary:** A spreadsheet-style grid built as a thin, opinionated wrapper around **`@glideapps/glide-data-grid` v6** (canvas-rendered). All data is `string[][]`; the wrapper adds a toolbar, filtering/sorting/search, undo/redo history, import/export (xlsx/csv), fill-handle pattern prediction, and a shadcn-styled column context menu.

## 1. Feature list (how each works)

| Feature | How it works |
|---|---|
| **Rendering / virtualization** | Delegated entirely to glide-data-grid's `<DataEditor>` (canvas-based, row/column virtualized out of the box). No custom virtualization. |
| **Cell editing** | glide's built-in overlay editors; committed via `onCellsEdited` → writes into `string[][]`, pushes a new history snapshot. Emits per-cell `onCellEdit({row,col,colId,value})`. Blocked when `readonly` or column is `columnConfig[id].readonly`. |
| **Cell types / renderers** | Only two kinds: `Text` and `Boolean` (checkbox). Chosen per-column via `columnConfig[id].kind`. Booleans parse via `parseGridBoolean` (`true/1/yes`). No custom cell-renderer plugin system. |
| **Selection** | glide's `gridSelection` (cells/rows/columns via `CompactSelection`). Controlled row selection (`selectedRows` prop maps data-indices ↔ display-indices), fires `onSelectionChange` / `onRowSelectionChange(indices, data)`. |
| **Keyboard nav** | Entirely glide-native. App-level hotkeys: `mod+z`/`mod+y` for undo/redo. |
| **Copy / paste** | Paste handled by `onPaste` — writes a 2D block starting at target, skips row-number col + readonly cols, one history snapshot. Copy is glide-native (`getCellsForSelection={true}`). |
| **Fill handle** | Enabled (`fillHandle`, `allowedFillDirections="orthogonal"`). `onFillPattern` + `fill-utils.ts` do **smart series prediction**: arithmetic progressions, zero-padded numbers (`001→002`), `"Item 1"→"Item 2"` prefix+number patterns, else repeat. Can extend past the last row (auto-adds rows). |
| **Undo / redo** | Snapshot-based: full `SmartGridState` copies in a `history[]` array capped at 50. `updateState(state, skipHistory?)`. `onFlushHistory` exposes a flush fn; `onHasChangesChange` fires when `historyIndex !== 0`. |
| **Sorting** | Client-side, single-column only. Context-menu driven. `localeCompare(..., {numeric:true})`. Index-based (data not mutated). |
| **Filtering** | Client-side. Operators: contains/notContains/is/equals/isNot/notEquals/startsWith/endsWith/empty/notEmpty. Single value only. |
| **Search** | Toolbar text input → client filter across all cells; plus glide's own `showSearch` overlay (separate). |
| **Server-side mode** | If any of `onFilterChange`/`onSortChange`/`onSearchChange` is provided, client filter/sort is bypassed and the consumer owns it. |
| **Column resize** | `onColumnResize` writes `width`, `skipHistory=true`. Initial widths auto-measured from header text via canvas (min 60 / max 400). |
| **Column reorder** | `onColumnMoved` (drag), splices both columns and every data row. Gated by `mode`. |
| **Row reorder** | `onRowMoved` (drag). Disabled when sorted/searched/filtered or in fixed/readonly modes. |
| **Add/remove rows** | `createRow`, `removeRow`, `setRowCount(n)`. Toolbar buttons + "set row count" dialog. Auto-scrolls to new row. |
| **Add/remove/rename columns** | `createColumn(title?)` (auto-names A,B,C…), `removeColumn(idx)`, `renameColumn(idx,title)`. Rename via Popover at click coords; delete via ConfirmPopover; driven by header context menu. Gated by `canRename`/`canDelete`. |
| **Pinning / freezing** | **Not implemented.** Only a fixed `#` row-number marker column. |
| **Row markers** | `rowMarkers="checkbox"` — glide-native checkbox column for row selection. |
| **Context menu** | Custom shadcn-styled menu on **header** right-click only: Sort asc/desc, Clear sort, Rename, Delete. No cell/body context menu. |
| **Validation** | No built-in engine. Consumer-driven: `getCellStyle` returns per-cell `themeOverride`; presets `overwritten`/`invalid`/`invalidText` sourced from CSS tokens. |
| **Import** | `.xlsx/.xls` via SheetJS; `.csv` via preview dialog + papaparse with explicit delimiter (`;`, `,`, `\t`). Everything coerced to strings. |
| **Export** | xlsx or csv (default `;` separator) via SheetJS. Optional server-side ExportDialog vs direct download. Exports respect current sort order. |
| **Multi-user presence** | `highlightRegions` prop passed straight to glide. `onVisibleRegionChanged` exposed for viewport sync. |
| **Theming / dark mode** | Maps ~30 glide theme keys to app CSS custom properties, re-resolving on a `MutationObserver` watching `<html>` class/style. |
| **Loading** | Separate skeleton component (pure Tailwind). |

## 2. Architecture

- **Underlying:** `@glideapps/glide-data-grid` `^6.0.3` + `xlsx` (SheetJS) + `papaparse`.
- **State:** custom hooks; core state in a **mutable `useRef` (`stateRef`)**, parallel `history[]` in `useState` for undo/redo; `setTick` forces re-render for `skipHistory` mutations. Data model `SmartGridState = { columns: GridColumn[]; data: string[][] }`. Row-number column prepended in the view layer only → recurring `col - 1` / `sortedIndices[row]` index math (fragile).
- **Components:** `SmartDataGrid` composes `SmartDataGridRoot` (provider + all dialogs/popovers, ~440-line giant component), `SmartDataGridToolbar`, `SmartDataGridGrid`.
- **State flow:** one orchestrator hook (`use-smart-data-grid`) over four sub-hooks — `use-grid-state` (data+history), `use-grid-selection`, `use-grid-operations` (mutations + glide callbacks), `use-grid-io`. Return value spread into a React context.
- **Cell plug-in model: effectively none.** Cell kind is a hard branch (`text` vs `boolean`) inside `getCellContent`.

## 3. Public API surface

Top-level props: `data?: string[][]` (header row at `[0]`), `columnConfig`, `mode ("default" | "fixed-columns" | "fixed-rows" | "fixed" | "readonly")`, `onChange(data)`, `onCellEdit(edit)`, `onImport/onExport`, `onHasChangesChange`, `onFlushHistory`, `onSelectionChange`, `onRowSelectionChange`, `onVisibleRegionChanged`, `onFilterChange/onSortChange/onSearchChange` (switch to server-side mode), `getCellStyle`, `highlightRegions`, `selectedRows`, `canRename`, `canDelete`, `withExportDialog`, `assetId`, `className`, `toolbarActions`, `onImportClick`. Imperative ref: `{ importData(data) }`.

Column config is out-of-band, keyed by column id **which equals the header title** (fragile on rename):
```ts
type ColumnConfig = Record<string, { readonly?: boolean; kind?: "text" | "boolean" }>
```

## 4. Styling

Tailwind + shadcn/ui for all chrome. Canvas cells styled via a bridge reading shadcn CSS custom properties (`--primary`, `--foreground`, `--muted`, `--border`, …) with `getComputedStyle`, feeding resolved colors into glide's theme object, re-resolving on light/dark change.

## 5. Verdict for gridcn

**Carry over (redesigned):**
- Fill-prediction engine (`fill-utils.ts`): arithmetic series, zero-pad preservation, prefixed-number sequences; well unit-tested.
- Hook decomposition pattern (state / selection / operations / io).
- IO/export utilities and CSV-preview import dialog concept.
- Server-side escape hatch pattern (delegating filter/sort/search).
- Column auto-sizing via text measurement.

**Design around (known pain):**
- Stringly-typed `string[][]` model → typed generic rows.
- Column id == title → stable ids decoupled from titles.
- Closed cell-type system → pluggable cell-type registry.
- Snapshot-based history (full deep copies) → op-based, id-keyed history.
- Mutable-ref + setTick + JSON.stringify equality → explicit reducer state.
- Giant Root component → real composition.
- Hand-rolled context menu → Base UI menu primitives.
- No pinning, no multi-sort → include both.
