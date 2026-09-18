# react-data-grid (adazzle) — Implementation Study

Version studied: `7.0.0-beta.59` in `references/react-data-grid/src/`. Modern DOM grid leaning on CSS Grid `subgrid`, container queries, `content-visibility`. Virtualizes rows and columns. This is the primary rendering-architecture reference for the gridcn engine.

## 0. Architecture at a glance

The entire grid is a **single CSS Grid container** (`role="grid"`, `display: grid`, `overflow: auto`). It is both the scroll container and the grid formatting context. Header rows, data rows, frozen-column shadows, the drag handle, measuring cells, scroll sentinels — all are grid items placed by `grid-column` / `grid-row` line numbers. **No separate viewport div, no transform offsets**: real browser scroll; virtualized rows placed at their true grid line via `gridRowStart`.

Key files: `DataGrid.tsx` (~1280 lines, god component); `style/core.ts`, `style/cell.ts`, `style/row.ts`; `hooks/` (useViewportRows, useViewportColumns, useCalculatedColumns, useColumnWidths, useGridDimensions, useScrollState, useScrollToPosition, useRovingTabIndex, useActivePosition).

## 1. Virtualization

### Rows — CSS Grid `grid-template-rows` + grid-line placement
`grid-template-rows` enumerates **every** row track (header + all N data rows) so scroll height is correct, but only rows in the overscan window render. Each rendered row pins itself via `gridRowStart = headerRowsCount + rowIdx + 1`.

```ts
let templateRows = `repeat(${headerRowsCount}, ${headerRowHeight}px)`;
if (rows.length) templateRows += gridTemplateRows; // ` repeat(N, 35px)`
```

- Fixed height: `findRowIdx(scrollTop) = floor(scrollTop / rowHeight)` — O(1).
- Variable height: precomputed `rowPositions[] = {top, height}` (O(N) upfront, acknowledged scaling risk) + **binary search**; `gridTemplateRows` run-length-encoded into `repeat(k, Hpx)` groups.
- Overscan: fixed 4 rows each side.
- **The active (selected) row is always rendered even outside the window** — but then only its active column — so DOM focus never dies during off-screen navigation.

### The `subgrid` trick
```css
.rdg-row { display: grid; grid-column: 1 / -1; grid-template: subgrid / subgrid; }
```
Cells align to the root's column tracks with zero per-row width bookkeeping. Header rows use `display: contents` instead, so header cells are direct grid items (needed for `position: sticky` against the scroll container).

### Columns
`useCalculatedColumns` computes per-column `{left, width}` and finds first/last non-frozen column intersecting `[scrollLeft + frozenWidth, scrollLeft + viewportWidth]`, ±1 overscan. Frozen columns always emitted. Iteration via **generators** yielding `[column, isActive, colSpan]`, skipping colSpan-consumed columns and walking back when a span from off-window reaches in. All column tracks stay in `grid-template-columns` (real px) so scroll extent is right.

### Scroll performance & modern CSS
- `useScrollState`/`useGridDimensions`: `useSyncExternalStore` keyed on the **ref object** with module-level `WeakMap` cache → tear-free, survives Suspense/`<Activity>`.
- One shared `ResizeObserver` for all grid instances.
- Root: `content-visibility: auto` + `contain: content` (NOT `strict` — Chromium zoom bug 40840864; `size` containment breaks `width: min-content`).
- `font-variant-numeric: tabular-nums`; cells `overflow: clip` (cheaper than hidden) + ellipsis.
- No transforms, no will-change, no RAF loops. React 19 idioms throughout (`useEffectEvent`).

## 2. Sticky / frozen — pure CSS

- Frozen cells: `position: sticky; z-index: 1; inset-inline-start: var(--rdg-frozen-left-<idx>)` (cumulative px emitted as CSS vars).
- Header cells: `position: sticky; inset-block-start: 0; z-index: 2` (frozen header: 3).
- **Frozen shadow with zero JS**: a sticky grid item whose opacity is driven by a scroll-state container query:
```css
/* root: container-type: scroll-state */
.frozenColumnShadow {
  position: sticky; z-index: 1;
  background-image: linear-gradient(to right, rgb(0 0 0 / 15%), transparent);
  @container rdg-root not scroll-state(scrollable: inline-start) { opacity: 0; }
  &:dir(rtl) { transform: scaleX(-1); }
}
```

## 3. Focus & keyboard

- **Roving tabindex** (ARIA grid APG): exactly one tabbable element inside the grid. `useRovingTabIndex` → cell `tabIndex = isActive ? 0 : -1`; if the cell contains an interactive child, focus is delegated to it. First header cell is the "focus sink" entry point when no active cell.
- `useActivePosition`: `{ idx, rowIdx, mode: 'ACTIVE' | 'EDIT' }`. **Signed row indices**: header/summary rows negative, data rows 0.., unifying navigation in one coordinate space. `validatePosition` classifies in/out of viewport/bounds and gates editability, clipboard, nav, scroll.
- Focus applied imperatively in `useLayoutEffect` on a separate `positionToFocus` state: `querySelector('& > [role="row"] > [tabindex="0"]').focus({ preventScroll: true })`.
- ARIA: root `role="grid"` + `aria-colcount/rowcount/multiselectable`; rows `aria-rowindex` (1-based incl. header); cells `role="gridcell"` + `aria-colindex/colspan/selected/readonly`; headers `role="columnheader"` + `aria-sort`.
- **Scroll-into-view**: native `scrollIntoView({inline:'nearest', block:'nearest', behavior:'instant'})` + CSS `scroll-padding-inline-start: <frozenWidth>` / `scroll-padding-block-start: <headerHeight>` so "nearest" never tucks a cell under sticky elements. For unrendered targets: throwaway sentinel div at the target grid line, `scrollIntoView` in ref callback, repeat until settled.
- Tab at grid boundary: commit editor, don't preventDefault — focus escapes naturally.

## 4. Editing

**No portals.** The editor renders inline as the active cell (Row swaps in `EditCell` when active+editing). Lifecycle:
1. Enter edit: double-click or printable key (`isDefaultCellInput`) → `mode:'EDIT'`, stash `row` + `originalRow`.
2. `onRowChange(row, commitChanges, shouldFocus)`; committing wrapped in `flushSync` (prevents double-fire when closing by clicking another cell).
3. Escape discards; Enter commits; Tab navigates if editor is sole input; blur commits.
4. **Commit-on-outside-click**: global `mousedown` capture schedules a commit via `scheduler.postTask({priority:'user-blocking'})` (fallback rAF); cancelled if the mousedown reaches the editor container (`onMouseDownCapture`). Robust against `stopPropagation` and editor-owned portals.
5. Editor auto-closes if the underlying row identity changes externally.
`editorOptions`: `commitOnOutsideClick`, `displayCellContent`, `closeOnExternalRowChange`.

## 5. Column resize & reorder

### Resize — Pointer Events + measuring pass
10px handle strip at header inline-end. `setPointerCapture(pointerId)`; width updates on `onPointerMove`; end on **`onLostPointerCapture`** (not pointerup — pointerup can be missed on alt-tab). `touch-action: none` on the header. Double-click → `onColumnResize(col, 'max-content')`.

`useColumnWidths`: numeric width → `${w}px` in template; `'max-content'` → literal in template, browser lays out, `useLayoutEffect` **measures the hidden measuring cell** and stores concrete px (`flushSync` for synchronous measure). Measuring cells: one per viewport column, `visibility: hidden; contain: strict; grid-row: 1`, spanning exactly one column. `ColumnWidths = Map<key, {type:'measured'|'resized', width}>`; `resized` never re-measured; `measured` re-flexes on grid resize.

### Reorder — native HTML DnD
`draggable` header, `onDragStart` `flushSync`es state so a styled drag-image div renders first, then `dataTransfer.setDragImage`. `isEventPertinent` filters child enter/leave noise. Drop → `onColumnsReorder(sourceKey, targetKey)` — app owns the array reorder.

## 6. Sizing summary

Column widths: `number | 'max-content' | 'auto'`/CSS strings; non-numeric read back via measuring cells. Row heights: `number | (row) => number`; variable = eager precompute + binary search (NOT DOM-measured).

## 7. Verdict

**Steal:** single grid + subgrid rows; real scroll + declared tracks; sticky frozen with CSS-var offsets; scroll-state container query shadow; roving tabindex + signed row space; native scrollIntoView + scroll-padding; keep active cell mounted; pointer-capture resize + max-content measuring; `useSyncExternalStore` scroll/size state.

**Avoid:** eager variable-row-height precompute for huge data; the `flushSync` sprinkle (minimize); god component; `contain: strict` (Chromium bugs); inline editors get clipped by cell bounds (fine for v1, note for tall editors).
