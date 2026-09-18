# Glide Data Grid — Excel Interaction Behavior Spec

Extracted from `references/glide-data-grid/packages/core/src`. A behavioral contract to implement against in the gridcn DOM engine; canvas details omitted. Coordinates 0-indexed `[col, row]`.

## 1. Selection model

```ts
GridSelection {
  current?: {
    cell:  [col, row]        // the "active"/anchor cell (Excel's white cell)
    range: Rectangle         // primary rectangular selection {x,y,width,height}
    rangeStack: Rectangle[]  // additional rects (ctrl-click multi-range), EXCLUDING `range`
  }
  columns: CompactSelection  // fully-selected columns
  rows:    CompactSelection  // fully-selected rows
}
```

Invariants:
- `current.cell` is always inside/a corner of `current.range`. Single cell = 1×1 range.
- `range` is primary; starting a new range with a modifier pushes the old one onto `rangeStack`. Active rect never duplicated in the stack.
- `columns`/`rows` are a **distinct channel** from `current`; selection retains *provenance* (selected-as-row vs selected-as-range) so delete/copy behave differently. Row selection copy = whole row width; column selection copy = full column height.
- Rectangular only; multi-select = list of rects + row/col channels.
- `Rectangle = {x,y,width,height}`, half-open far edge. Helpers: combineRects (bbox union), rectContains, intersectRect, pointInRect.

### CompactSelection (row/col set)
Immutable, run-length-encoded integer set: sorted merged half-open `[start, end)` slices. Contract: `add`, `remove` (splits interior), `hasIndex`, `hasAll`, `first`, `last`, `length` (member count), `offset(delta)` (shift on row insert/delete), `toArray`, iterable, `equals`, `empty()` singleton, `fromSingleSelection`.

### Blending modes
Per channel (range/column/row): `exclusive` (default — selecting one channel clears others) | `mixed` (coexist only while Ctrl held or during drag) | `additive`. `rangeSelect`: `none|cell|rect|multi-cell|multi-rect` (default `rect`).

## 2. Keyboard map

`primary` = Ctrl on Win/Linux, Cmd on macOS.

### Navigation (collapses selection to 1×1)
| Keys | Action |
|---|---|
| Arrows | move active cell 1 |
| Tab / Shift+Tab | move right / left |
| Alt+Arrow | move active cell but **retain selection** as secondary range |
| Home / End | first / last column of current row |
| primary+Arrow | jump to grid edge in that direction (NOTE: glide is flat edge-jump; Excel jumps to next data boundary — gridcn should do Excel-style data-boundary jump) |
| primary+Home / primary+End | cell [0,0] / last cell |
| PageUp/PageDown | move by `visibleHeight − 4` rows |
| primary+Enter | scroll active cell into view without moving |

### Selection growth (anchor-relative)
| Keys | Action |
|---|---|
| Shift+Arrow | grow far edge / shrink near edge if anchor on opposite side (Excel-correct contraction) |
| primary+Shift+Arrow | grow to the data boundary in that direction (Excel-style, per the primary+Arrow note above — not a flat grid edge) |
| primary+Shift+Home/End | grow to [0,0] / bottom-right |
| Shift+Space | select whole current row (toggles) |
| Ctrl+Space | select whole current column (toggles) |
| primary+A | select entire grid in ONE stage (keeps anchor, clears rows/cols). (Excel's two-stage block-then-sheet is NOT in glide; gridcn may adopt two-stage.) |

### Editing / activation
| Keys | Action |
|---|---|
| printable char | open editor **replacing** content, typed char seeds `initialValue` (gated: no ctrl/meta, `key.length===1`, Unicode letter/number/symbol/punct, cell read-write) |
| Enter / Shift+Enter / Space | open editor **highlighting** existing content (select-all, not replace). Boolean cells: toggle in place, no overlay. On trailing blank row: append row |
| Delete / Backspace | clear selection contents. Order: primary range → each secondary range → columns → rows |
| Escape | editor open → close discarding; else clear entire selection |

### Fill shortcuts (off by default in glide; gridcn: on)
- primary+D: fill top row of selection downward (needs height > 1)
- primary+R: fill left column rightward (needs width > 1)

### Clipboard
Wired to **native `copy`/`cut`/`paste` events** (not key combos) so OS-native shortcuts work. Cut = copy + delete primary range.

### Editor-overlay-local keys
- Enter → commit + move down. Shift+Enter → commit + move up (but inside multiline text = newline).
- Tab / Shift+Tab → commit + move right/left.
- Escape → cancel, discard temp value, no movement.

## 3. Mouse interaction

`isMultiKey` = Cmd (mac) / Ctrl (else).

### Cell clicks
- Plain click: active = clicked, range 1×1, close overlay, focus grid.
- Shift+click: extend range from existing anchor to clicked cell (anchor stays).
- Ctrl+click (multi-rect): push current range to stack, start new rect.
- A click counts only if mouseup cell == mousedown cell (else it was a drag).

### Activation → edit (`cellActivationBehavior`, default `second-click`)
- `single-click`: any click activates. `double-click`: only dblclick. `second-click` (Excel-like default): a second click on the already-active cell opens the editor; double-click always works.

### Header clicks
- Plain: select whole column (toggle). Shift: contiguous column range from last-selected. Ctrl: additive toggle single column. Corner marker: select/deselect all rows. Group header: select the group's columns.

### Row-marker clicks
- Click: select row (toggle if only selected). Shift: row range from last highlighted. Ctrl: additive toggle.

### Drag
- Cell drag: live-update range anchor→hover; rangeStack preserved during drag. Row-marker drag extends row range. Auto-scroll past viewport edge.

### Fill handle
- Small square at selection's bottom-right. Drag highlight computed by `getClosestRect(prevRange, cursor, allowedDirections)`.
- `allowedFillDirections`: `horizontal | vertical | orthogonal (default) | any`. Orthogonal = snap to the single axis (up/down/left/right) the cursor is closest to; no diagonal.
- Mouseup: fill target = `combineRects(source, highlight)`; fillPattern writes; selection expands to combined rect.

### Column resize
- Drag header right edge: `onColumnResizeStart` → `onColumnResize` (live) → `onColumnResizeEnd`. **Double-click edge = autosize** (measure visible rows' content, clamp min/max).

### Click outside grid → clear selection, fire onSelectionCleared.

## 4. Copy / paste format

### Copy — writes BOTH representations
- `text/plain` = TSV: rows `\n`, cells `\t`; cell wrapped in `"…"` with doubled quotes ONLY if it contains tab/newline/quote.
- `text/html` = `<table><tbody>` where each `<td>` carries `gdg-format="string|number|boolean|url|string-array"` and `gdg-raw-value="…"` (attribute-escaped raw value); visible text = formatted display value. URL cells emit `<a href=raw>`. Runs of ≥2 spaces wrapped in spans, tabs → 4 spaces (Excel/Sheets fidelity).
- Write path: `clipboardData.setData` → `navigator.clipboard.write(ClipboardItem{both})` → `writeText` fallback.
- Scope: `current.range` if present; else selected rows (full width); else selected columns (full height). Optional `copyHeaders` prepends header row.

### Paste — HTML first, plaintext fallback
1. Target = top-left of `current.range`, else selected column at row 0, else selected row at col 0.
2. Parse `text/html` table if usable (read `gdg-raw-value`, `<a href>`, `<br>`→`\n`; handle Apple Numbers quirks); else parse `text/plain` with a quoted-TSV state machine (`""` escapes).
3. **Anchored expand**: write source shape at target top-left, clip at grid bounds. Glide does NOT tile-to-fill a larger selection. (gridcn: adopt react-datasheet-grid's nicety — single pasted row tiles down a taller selection.)
4. Each cell written via the cell type's paste hook (must return same kind); readonly cells skipped; `coercePasteValue` override.
5. User `onPaste(target, string[][])` can veto or take over.

## 5. Editing semantics

- Open modes: **highlight** (Enter/Space/second-click — content selected, typing replaces or cursor repositions) vs **replace** (type-to-edit — seeded with typed char).
- Commit: Enter (move down), Tab/Shift+Tab (move right/left), Shift+Enter (move up), **click-away commits with no movement**. On last row with append enabled, Enter appends a row.
- Cancel: Escape (no write). `validateCell` false → write suppressed (editor shows invalid state; cannot commit invalid).
- Overlay positioned over the cell rect (portal in glide; gridcn uses inline editor per adazzle), 1px bloom, shifted back on-screen near viewport edges.

## 6. Search & fill-pattern

### Search (glide: primary+F, off by default)
- Case-insensitive **literal** (regex-escaped) substring match.
- Runs incrementally in rAF chunks (~10ms/frame batches), wraps around dataset, starts at current scroll, caps at 1000 results, reports progress.
- Enter → next, Shift+Enter → prev (wrapping); result cell scrolled to + made active. Escape closes, returns focus to grid. Matches highlighted.

### Fill-pattern (one algorithm for handle-drag, Ctrl+D, Ctrl+R)
- Source rect + destination rect (contains source). Every destination cell outside source gets `source[y % srcH][x % srcW]` — **modulo tiling** ("copy cells", no series inference in glide).
- fillDown collapses source to top row; fillRight to left column.
- `onFillPattern({fillDestination, patternSource, preventDefault})` hook.
- **gridcn divergence**: layer smart series inference on top (from smart-data-grid fill-utils: arithmetic progressions on numeric runs, zero-pad preservation, "Item 1"→"Item 2" prefix+number), with a modifier to force plain copy (Excel: Ctrl toggles copy vs series).

## 7. Implementation notes for the DOM grid

- Model selection exactly as `{current:{cell,range,rangeStack}, rows, cols}` + RLE CompactSelection (offset() maps to row insert/delete shifting).
- Anchor cell drives all shift-growth math; store separately from range top-left.
- Clipboard: emit both TSV and `<table>` with raw-value/format attributes for round-trip; parse HTML-first.
- Paste = anchored expand; fill = tile + series inference with orthogonal snap.
- Deliberate gridcn upgrades over glide: Ctrl+Arrow → next-data-boundary (Excel-style), optional two-stage Ctrl+A, fill series inference, fill shortcuts on by default.
