# CellRef as the public cell coordinate (W5-08)

Decision record for making `CellRef = { rowId, columnId }` the public cell
coordinate, and `ViewCoord` (the renamed `CellCoord`) the explicit view-space
one.

## Problem

Every public ctx and action today names the same cell three different ways:
`CellCoord { row, col }` (view indices), `rowIndex`/`viewRowIndex`/`viewRow`
(inconsistent naming), and `rowId` + `columnId` (only in the data-write paths).
A consumer who receives `onCellClick(ctx)` cannot stably address that cell
later: `ctx.rowIndex` reshuffles under sort/filter, and the ctx has no id.
`CellPatch` already proved the id-keyed shape works (`CellPatch.rowId` +
`columnId`).

## Decisions

### 1. Two coordinates, two names

- `CellRef = { rowId: string; columnId: string }` — new exported type. `rowId`
  is the `getRowId()` value; stable across sort/filter/reorder. The public
  coordinate.
- `CellCoord` renamed `ViewCoord` (same shape `{ row, col }`), JSDoc states it
  is 0-based view space and never stable: do not persist it or compare it
  across a reorder. Everything internal keeps `ViewCoord`.

Both export from the consumer barrel and the `data-grid-sdk` surface (add-ons
use `ViewCoord` heavily: presence, pinned-rows, fill, io, keybindings).

### 2. Actions take a ref; the positional variant gets `*At`

Every public action that takes a cell coordinate gets a `CellRef` primary and
a `ViewCoord` `*At` variant (the `*At` bodies are the old implementations
verbatim):

| New (`CellRef`) | `*At` (`ViewCoord`) | Replaces |
|---|---|---|
| `selectCell(ref)` | `selectCellAt(coord)` | `selectCell(coord)` |
| `setActiveCell(ref \| null)` | `setActiveCellAt(coord \| null)` | `setActiveCell(coord \| null)` |
| `extendTo(ref)` | `extendToAt(coord)` | `extendTo(coord)` |
| `pushRange(ref)` | `pushRangeAt(coord)` | `pushRange(coord)` |
| `startEditing(ref, initialText?)` | `startEditingAt(coord, initialText?)` | `startEditing(coord, initialText?)` |
| `commitCellValue(ref, value)` | `commitCellValueAt(coord, value)` | `commitCellValue(coord, value)` |

Row-level and row-op actions (`selectRow`, `setRowSelected`, `armRowDragAnchor`,
`insertRow`, `deleteRows`, `duplicateRows`, `reorderRows`) keep their view-index
signatures this item — selection-in-refs is W5-11's scope.

`useDataGridScrollToCell(): (ref: CellRef) => void`; new
`useDataGridScrollToCellAt(): (coord: ViewCoord) => void` (the old behavior).

### 3. Ref resolution

One store helper `resolveCellRef(state, ref): ViewCoord | null`:

- `rowId` → data index via the row-index cache, data index → view index via the
  `viewIndex` inverse.
- `columnId` → visible-column index (hidden column → `null`).
- A ref that resolves to a row outside the rendered window is fine — that is
  `scrollToCell`'s whole point.
- Unresolvable ref (row no longer in `data`, hidden column): dev-warn once and
  no-op — the same convention as `CellPatch` ids not present in `data`.

The `*At` variants are what internal gestures call (they already hold a
`ViewCoord`), so gesture/keyboard code paths are untouched.

### 4. Every cell ctx carries identity; one name for view space

Cell-level ctx gains `rowId: string` and `columnId: string`; the view-space row
index is spelled `viewRowIndex` everywhere:

| Type | Change |
|---|---|
| `CellRenderProps` | `rowIndex` → `viewRowIndex`; add `rowId`, `columnId` |
| `CellClassNameCtx` | add `rowId`, `columnId` (`viewRowIndex` already) |
| `CellClickCtx` | `rowIndex` → `viewRowIndex`, `columnIndex` → `viewColumnIndex`; add `rowId`, `columnId` |
| `RowClickCtx` | `rowIndex` → `viewRowIndex`; add `rowId` |
| `MarkerCellRenderCtx` | add `rowId` (the marker column is not a data column — no `columnId`) |
| `CellMenuItemsCtx` (context-menu add-on) | `row: number` → `viewRowIndex`; add `rowId` (`columnId` already) |
| `GridBulkValidationError` | `viewRow` → `viewRowIndex`; add `rowId` |
| `applyCellUpdates` update shape | `viewRow` → `viewRowIndex` |

Out of scope, deliberately:

- Events keep view-space coordinates (renamed to `ViewCoord`):
  `onActiveCellChange`, `onEditStart`, `GridEditEndEvent.coord`. They report
  transient UI state; stable identity reaches the consumer through the ctx of
  the same gesture and through `onDataChange` ops.
- `GetRowClassName(row, viewRowIndex)` keeps its positional signature — the
  consumer owns `getRowId` and can derive the id.
- `GridSelection` / rects / row-column channels stay view-index based — the
  selection model is view space by construction (W5-11 revisits).
- `flashCells` keys, `setCellErrors`/`clearCellErrors` targets — `rowId:columnId`
  keyed. (Claimed here as pre-existing; the flash keys were view-row-based at the
  time of this spec and a later fix, `516f795`, made them row-id-keyed.)

## Impact surface

- `CellCoord` referenced by 23 registry files (core + add-ons + tests) and 3
  doc pages; rename is mechanical.
- Breaking: the action signatures, the `useDataGridScrollToCell` return type,
  the ctx field renames/additions above, the `CellMenuItemsCtx` shape
  (W5-04's add-on API).
- CHANGELOG `**Breaking:**` entry.

## Execution order

1. `types.ts`: `ViewCoord` rename + `CellRef`; ctx/event type updates.
2. Store: `resolveCellRef`; action split (ref primary + `*At`);
   `applyCellUpdates` field rename.
3. Hooks: `useDataGridScrollToCell` (ref) + `useDataGridScrollToCellAt`;
   ctx assembly in `cell.tsx`/`row.tsx`/marker cell adds the identity fields.
4. Add-ons: `data-grid-context-menu` `CellMenuItemsCtx`; rename `CellCoord`
   usages across all add-on blocks.
5. Type tests + unit/browser tests updated to the new names.
6. Docs (`api-reference`, selection, editing, events, context-menu,
   custom-markers, streaming/bulk pages): simple-english self-check.
7. Gates, registry:build + verify, e2e-install (payloads change), CHANGELOG.
