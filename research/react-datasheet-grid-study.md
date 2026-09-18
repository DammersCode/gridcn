# react-datasheet-grid — Implementation Study

Source: `references/react-datasheet-grid/src/`. DOM-based Excel-like editable grid; closest prior art for gridcn's interaction layer. Engine is one ~1850-line component (`DataSheetGrid.tsx`).

**Load-bearing decision:** the grid is **stateless about data** — it never stores a copy; every mutation calls `onChange(newArray, operations[])` and the parent feeds the new array back. All interaction state (active, selection, editing) is grid-local.

Files: `components/DataSheetGrid.tsx` (engine), `components/Grid.tsx` (virtualization+rendering), `components/SelectionRect.tsx` (overlay), `components/Cell.tsx`, `hooks/useRowHeights.ts`, `hooks/useColumnWidths.ts`, `hooks/useColumns.tsx`, `columns/textColumn.tsx`, `columns/keyColumn.tsx`, `utils/copyPasting.ts`, `style.css`.

## 1. Virtualization

`@tanstack/react-virtual`, two virtualizers on one scroll element: rows (`paddingStart: headerRowHeight`, overscan 5) + columns (horizontal, overscan 1). Custom `rangeExtractor` force-includes the gutter (index 0) and sticky-right column in every window — the trick that keeps sticky columns alive under column virtualization.

Positioning: **absolute, not CSS Grid** — scroll box (`overflow:auto; position:relative`) → inner sizer div (`width/height = totalSize`) → `.dsg-row { position:absolute; top:<start> }` → `.dsg-cell { position:absolute; left:<start>; width:<size> }`.

Row heights: constant → O(1) math; variable → lazily-filled `{height, top}[]` cache + binary search + `resetAfter(index)`; heights must be **data-derived, not DOM-measured**.

Sticky bits are pure CSS: gutter `position:sticky; left:0; z-index:30`; header row `sticky; top:0; z-index:40`. Scroll-driven JS is only edge-shadow class toggling + imperative `scrollTo` for active cell.

## 2. Selection model

Stored as **two corner cells**, not a rectangle:
```ts
activeCell:    { col, row } | null   // anchor + focused cell
selectionCell: { col, row } | null   // drag/extend corner
selection = derived { min, max }     // normalized
```
Cells carry transient `doNotScrollX/Y` flags so mutations can move the active cell without scrolling. NOTE: `col` is the data index; the runtime columns array has a gutter prepended, so `columns[col + 1]` everywhere — a recurring foot-gun to avoid in gridcn (keep index spaces separate).

Mouse drag: `selectionMode = { columns, rows, active }` state machine set by mousedown target (header → columns-only, gutter → rows-only, cell → both); document-level mousemove recomputes `selectionCell`; mouseup clears. Shift-click sets only `selectionCell`. Cursor→cell mapping via cumulative `columnRights.findIndex` + row binary search.

### Selection rendering: overlay rectangles, NOT per-cell classes
Six absolutely-positioned sibling divs rendered once at grid level, `pointer-events: none`, `z-index: 20`:
1. `.dsg-active-cell` — ring around active cell
2. `.dsg-selection-rect` — range fill, with a **`clip-path` evenodd polygon punching the active-cell hole** so the anchor stays crisp
3. col/row markers on header/gutter
4. expand-rows rect + fill-handle indicator

Dragging a selection re-renders **zero cells**. Only per-cell styling is the header/gutter active tint.

## 3. Editing lifecycle

One boolean: `editing`. A cell is editing iff it's the active cell AND `editing`. **The grid never renders an editor — cell components are always mounted and react to a `focus` prop** (`focus = active && editing`), with `pointerEvents: focus ? 'auto' : 'none'`, `tabIndex -1`.

Cell contract (`CellProps`):
```ts
{ rowData, rowIndex, columnIndex, columnData, active, focus, disabled,
  setRowData(rowData), stopEditing({nextRow?}), insertRowBelow, duplicateRow, deleteRow }
```

`textColumn` pattern — uncontrolled `<input>` driven by `useLayoutEffect(..., [focus])`: on focus → set value, `.focus()`, `.select()`; on blur → commit via `setRowData(parseUserInput(value))` unless Esc pressed or unchanged. Two modes: `continuousUpdates` (commit per keystroke, default) vs commit-on-blur. "Type-to-replace vs Enter-to-edit-in-place" emerges from select-all + uncontrolled input.

Typing starts edit: printable key, no modifiers → `setEditing(true)`. Enter/F2 edit preserving content. `stopEditing({nextRow:true})` moves down (auto-adds row if `autoAddRow` on last row). checkboxColumn toggles immediately on focus and stops editing; selectColumn opens its menu via `menuIsOpen={focus}` and uses `disableKeys`/`keepFocus` escape hatches.

**gridcn note:** prefer explicit editor commit/cancel semantics over the `focusedAt`/`changedAt`/`escPressed` timestamp bookkeeping (their pain point).

## 4. Clipboard

Document-level `copy`/`cut`/`paste` listeners, guarded by `!editing && activeCell`.

**Copy — dual format:**
```ts
event.clipboardData.setData('text/plain', rows.map(r => r.join('\t')).join('\n'))
event.clipboardData.setData('text/html', `<table>...<td>${encodeHtml(v).replace(/\n/g,'<br/>')}</td>...</table>`)
```
Fallback chain outside clipboard events: `navigator.clipboard.write(ClipboardItem)` → `writeText` → `execCommand('copy')`. Cut = copy + delete selection.

**Paste — html → plain preference.** HTML parsed via `DOMParser` walking `table.rows[].cells[].textContent`. Plain text parsed by a **hand-written TSV state machine** handling Excel quoting: quoted fields, `""` escapes, embedded newlines inside quotes. (Do NOT `split('\t')`.)

**Paste application:** per-column `prePasteValues(values[])` (can be async — name→id lookups), then `pasteValue({rowData, value})` per cell. Single pasted row → **fills the whole selection height**; multiple rows → auto-creates missing rows (unless `lockRows`). Skips disabled cells; emits UPDATE + CREATE ops; selection covers pasted region.

## 5. Keyboard

**Single document-level `onKeyDown`** (~230 lines) is the whole keymap; cells don't handle keys. Early-return on `!activeCell` and `event.isComposing` (IME).

| Key | Action |
|---|---|
| Arrows | move active (clamped); +Shift extends selectionCell; +Ctrl jumps to edge |
| Tab / Shift+Tab | right/left, wraps rows; at boundary hands focus to real DOM via sentinel divs |
| Enter / F2 | edit (preserve); commit+down if editing |
| Shift+Enter | insert row after |
| Esc | cancel edit / clear selection |
| printable | edit (replace) |
| Backspace/Delete | smart delete: clears values; if all already empty → deletes rows (disable: `disableSmartDelete`) |
| Ctrl+A | select all |
| Ctrl+D | duplicate rows |

**Virtual focus:** the browser's focus is NOT on cells; active cell is state + overlay. Editors take real DOM focus only while `focus===true`. Tab-order integration via two sentinel `tabIndex=0` divs wrapping the grid: focusing one sets active cell to first/last; tabbing out finds next real tabbable.
**gridcn note:** we use roving tabindex on real cells instead (adazzle pattern) for a11y; scope listeners to the container, not document (multi-grid pages).

## 6. Fill handle ("expand selection")

Vertical only. `.dsg-expand-rows-indicator` (bottom-right, `cursor:crosshair`) rendered by SelectionRect. Drag sets `expandSelectionRowsCount = cursorRow - fromRow`; preview rect drawn; on mouseup values copied via the **same copy/paste value pipeline** with **modulo cycling**: `copyData[(rowIndex - max.row - 1) % copyData.length]`. One UPDATE op; selection extends. Handle hidden when editing, mid-drag, last row, or right-side columns disabled.

## 7. Undo/redo

**Not implemented** — deliberate consequence of stateless data. The `operations[]` in onChange is the intended hook for host-side history. gridcn ships the opt-in history hook they left as homework.

## 8. Column API & reusable cell types

```ts
type Column<T, C> = {
  id?, title?, headerClassName?, cellClassName?,
  basis, grow, shrink, minWidth, maxWidth,      // flexbox-like sizing
  component: CellComponent<T, C>, columnData?: C,
  disabled: boolean | (opt) => boolean,
  disableKeys?, keepFocus?,                      // editor keyboard escape hatches
  // the value pipeline — powers copy, paste, fill, delete with ONE mechanism:
  copyValue({rowData, rowIndex}): string | number | null,
  pasteValue({rowData, value, rowIndex}): T,
  prePasteValues?(values[]): PasteValue[] | Promise<...>,
  deleteValue({rowData, rowIndex}): T,
  isCellEmpty({rowData, rowIndex}): boolean,
}
```

`createTextColumn<T>(options)` — base factory; `intColumn`/`floatColumn`/`percentColumn`/`dateColumn`/`isoDateColumn` are one-liners over format/parse options.

`keyColumn(key, column)` — **the composability trick**: adapts a scalar-cell column to an object-row column; inner component sees `row[key]`, `setRowData(v)` writes `{...row, [key]: v}`; wraps the whole value pipeline. Payoff: a cell re-renders only when *its* field changes. Compose: `{ ...keyColumn('qty', intColumn), title: 'Quantity' }`.

`useColumnWidths` reimplements the flexbox resolution algorithm (grow/shrink/basis, freeze-violated-items loop) → `columnWidths[]` + cumulative `columnRights[]`.

## 9. Pain points (design around)

1. 1850-line engine component, ~15 useStates, dataRef-vs-data stale-closure threading → use a reducer/state machine.
2. Gutter shares the column index space (`columns[col+1]`, `length - 3` everywhere) → keep gutter/marker columns OUT of the data index space.
3. Two virtualizers + manual `measure()` on width change; sticky columns only survive via hand-patched rangeExtractor.
4. Uncontrolled inputs + imperative DOM writes + timestamp bookkeeping → explicit editor value + commit/cancel.
5. No undo, no sync-path validation, no cell error state.
6. Variable heights data-derived only.
7. clip-path pixel math with fudge factors — with a CSS Grid engine, place overlays by grid lines instead.
8. Document-level listeners for everything → scope to container.
9. Mixed index conventions between internal and public props.

**Steal:** overlay selection rendering; the column value pipeline; keyColumn projection; the proper TSV parser; dual-format clipboard; `onChange(value, operations[])`; paste single-row-fills-selection + multi-row-adds-rows semantics; smart delete.
