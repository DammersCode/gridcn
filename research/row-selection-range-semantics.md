# Row range checking: anchor, Shift, Ctrl/Cmd

Decision record for how the row marker (number zone and checkbox) and the keyboard check a
range of rows. Status: decided. Sources: WAI-ARIA Authoring Practices, listbox and grid
patterns (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/, .../grid/); desktop platform
list-view and list-box guidelines; the documented behavior of common file managers, mail lists,
spreadsheet-style apps and data grids.

## Decision

One model for every row gesture. A **range gesture** holds three values:

- `anchor`: the row where the gesture started.
- `base`: the row channel as it was when the anchor was set (a `CompactSelection`).
- `checked`: the state that the range applies (`true` checks, `false` unchecks).

Every Shift step computes `rows = checked ? base.add([lo, hi + 1]) : base.remove([lo, hi + 1])`
with `lo..hi` = anchor..target. The previous Shift range is therefore replaced, never unioned:
the range grows and shrinks, and rows outside it keep their `base` state. The anchor never moves
on a Shift step.

| # | Gesture | Result | Anchor after | `base` after |
|---|---------|--------|--------------|--------------|
| 1 | Click marker number, row r | Rows = {r} (or {} when r was the only checked row) | r | {} |
| 2 | Click checkbox, row r | Toggle r, others stay | r | rows before the click, `checked` = new state of r |
| 3 | Ctrl/Cmd+click marker, row r | Toggle r, others stay | r | as 2 |
| 4 | Shift+click row t (marker or checkbox) | `base` op anchor..t | unchanged | unchanged |
| 5 | Example: click 1, Shift+click 5, Shift+click 3 | {1..5}, then {1..3} | 1 | {} |
| 6 | Example: click 1, Ctrl+click 8, Shift+click 5 | {1, 5..8} | 8 | {1} |
| 7 | Example: check 2, check 9, uncheck 4 (anchor 4 off), Shift+click 7 | 4..7 unchecked: {2, 9} | 4 | {2, 9} |
| 8 | Shift+click upward (t < anchor) | Same rule, `lo..hi` is ordered | unchanged | unchanged |
| 9 | Shift+click inside or outside the previous range | Same rule; inside shrinks, outside grows or flips side | unchanged | unchanged |
| 10 | Ctrl/Cmd+Shift+click row t | Commit: `base` := current rows, then add anchor..t | unchanged | current rows |
| 11 | Shift+click, no valid gesture | Anchor = active row if there is one, else t alone (as 2) | active row or t | current rows |
| 12 | Press marker number and drag | Moving edge: rows = `base` op anchor..pointer | press row | {} |
| 13 | Press checkbox and drag | Moving edge, `checked` = new state of the pressed row, others stay | press row | rows before the press |
| 14 | Shift+press and drag | Continues gesture 4 with the pointer as the target | unchanged | unchanged |
| 15 | Ctrl/Cmd+press and drag | As 13 from the marker number | press row | rows before the press |
| 16 | Ctrl+Shift+Space (`toggleRow`) | Toggle the active row; sets the gesture as 2 | active row | as 2 |
| 17 | Shift+Space (`selectRow`) | Rows = {active row}; sets the gesture as 1 | active row | {} |
| 18 | Shift+ArrowUp/Down after 16 or 17 (row channel holds the gesture, the cell selection is empty or only the active cell) | Gesture 4 with target = active row ± 1; the active row moves | unchanged | unchanged |
| 18b | Shift+Home/End, Shift+PageUp/PageDown in the same state | Gesture 4 with target = first row, last row, active row ∓ one page; the active row moves | unchanged | unchanged |
| 19 | Header checkbox | Unchanged: checks all view rows, or unchecks all and clears hidden checked rows | cleared | cleared |
| 20 | Touch tap on checkbox / number | Unchanged: toggle / exclusive select; no Shift on touch | as 2 / 1 | as 2 / 1 |

Notes on the choices:

- Rows 6 and 7 follow mail lists and the platform check-box list model: Shift never clears rows
  outside the range. Desktop file managers without check boxes clear them on a plain
  Shift+click; we do not, because the checkbox makes the selection a deliberate list.
- Row 7: the range takes the anchor's state ("shift-uncheck"). The alternative (Shift always
  checks) cannot uncheck a block without a filter.
- Row 10 is the "add another range" chord of desktop list views. With row 4 already keeping
  `base`, its only effect is that the previous range no longer shrinks back.
- Row 11 mirrors spreadsheet-style apps (extend from the active cell) and the listbox pattern
  ("from the most recently selected item").

- Drags write the row channel live on every step. A cancelled drag (`pointercancel`, lost pointer
  capture, window blur) keeps the rows written so far and only tears the gesture down. A checkbox
  press that wrote no row restores the earlier anchor on cancel.
- The header checkbox, `clearSelection` (Escape) and `setSelection(null)` drop the gesture, so the
  next Shift+click starts from the active row (row 11). A sort or filter keeps it stale, and the
  anchor follows its row id.
- A keyboard step moves the gesture's moving edge (`edge`), not the active cell, so it continues a
  mouse range from where the range ends. The active cell moves to the new edge.
- A controlled `selection` echo writes nothing to the store, so the gesture stays live.

## Gaps found (ranked by user value, then cost)

| Rank | Gap | Today | Cost |
|------|-----|-------|------|
| 1 | Shift steps only union; the range never shrinks (the maintainer's bug) | `extendFromLast` = `channel.add(span)` | S |
| 2 | Anchor moves to every Shift target | `selectRow` writes `lastHighlightedRow = index` on Shift too | S |
| 3 | A checkbox drag clobbers other checked rows | `replaceFromLast` makes the channel exactly the span | S |
| 4 | Shift+press+drag on the marker also clobbers rows outside the span, while a Shift click keeps them | same `replaceFromLast` | S |
| 5 | Shift+click cannot uncheck a range | Shift on the checkbox routes to `onMarkerPointerDown`, which only adds | S |
| 6 | Ctrl/Cmd+drag can only grow | `extendFromLast` from the last row | S |
| 7 | No keyboard range check: Shift+Arrow after Shift+Space replaces the rows with a cell range | `_moveActiveCell` extends `selectCellOf(active)` when `selection.current` is null | M |
| 8 | No "N rows checked" announcement; a range change is silent for screen readers | only row-move announcements exist | M (label + live region) |
| 9 | Anchor shares `lastHighlightedRow` with keyboard cell moves and column extends | one field, three meanings | S (new field) |
| 10 | No Shift+PageUp/PageDown, Shift+Home/End (row extend) chords | not in `DEFAULT_KEYMAP` | M (check reservations, docs rows) |
| 11 | No checked-row count shown near the grid | consumer builds it | docs example only |
| 12 | No "invert checked rows" | none | S, low value |

Checked and fine: the grid root has `select-none`, so Shift+click starts no text selection;
the drag auto-scrolls and hands capture to the scroll element; ranges are view indices, so a
hidden checked row (kept by id outside the channel) is never touched; bands are outside the body
view index; checking rows is not a data write, so `readOnly` does not gate it (unchanged).

Not recommended: undo of selection changes (no common app does it for checks); Ctrl/Cmd+A checking
rows (Ctrl/Cmd+A selects cells, as documented); long-press multi-select mode on touch (the
checkbox already gives touch a multi-select path).

## Implementation sketch

Store (`store/create-store.ts`, `store/types.ts`):

- New internal field `rowRangeGesture: { anchor: number; anchorRowId: string; base: CompactSelection; checked: boolean; rows: CompactSelectionLike; viewIndex: readonly number[] } | null`.
  `rows` is the channel the gesture last wrote. The gesture is **live** only while
  `state.selection.rows === gesture.rows` and `state.viewIndex === gesture.viewIndex`. Any other
  write (filter, sort, header checkbox, cell selection, consumer `selection` prop) makes it stale
  without extra bookkeeping, like `selectAllStage`.
- After a view rebuild the stale gesture re-resolves `anchorRowId` to its new view index for
  row 11; a hidden or removed anchor falls back to the active row.
- New action `checkRowRange(target, { commit?: boolean })`:
  live gesture -> `rows = op(base, span)`; `commit` -> `base = current rows` first; stale ->
  start a gesture per row 11. One `set`, then compare with `equals` and skip unchanged writes.
- `selectRow` (plain, additive) and `setRowSelected` set a fresh gesture (rows 1 to 3). `setAllRowsSelected` clears it.
- The span op is `CompactSelection.add/remove([lo, hi + 1])`: O(slices), never a spread, never
  `toArray`. `base` is immutable and shared, so storing it costs one reference.
- Keep `lastHighlightedRow` for the cell-range code; row gestures stop reading it.
- Remove `replaceFromLast`/`extendFromLast` from the row path once nothing calls them; the column
  path keeps `extendFromLast` (out of scope).

Interaction (`interaction/use-grid-interaction.ts`):

- `onMarkerPointerDown`: Shift -> `checkRowRange(row, { commit: isMultiKey })`; Ctrl/Cmd ->
  `selectRow(row, { additive: true })`; plain -> `selectRow(row)`. Every branch then
  `beginDrag("row", ...)` without an `anchor` argument.
- `onMarkerCheckboxPointerDown`: Shift -> as above, and the checkbox's `onCheckedChange` keeps
  skipping the pointer Shift click. No Shift: arm a pending gesture (`anchor` = press row,
  `checked` = !isChecked(press row), `base` = current rows) without writing rows, so a
  stationary click still resolves through `onCheckedChange`.
- `runDragFrame`, row mode: `checkRowRange(clamped.row)` on every frame. The drag no longer
  needs `drag.anchor` for the range; keep `pendingOffAnchor`/`leftAnchor` for the click swallow.
- Keyboard: `toggleRow` and `selectRow` set the gesture; `extendUp`/`extendDown` call
  `checkRowRange(active.row ± 1)` and move the active row while the gesture is live and
  `selection.current` is null. Otherwise they keep extending cells.
- Announcement: a polite live region in `body.tsx` with a new label
  `labels.markers.checkedRowsAnnouncement(count, total)`, written only for gestures that change
  more than one row (count = `rows.length`, O(slices)).

## Test list (gesture -> expected row channel)

Unit (`selection` / store tests, 0-based view rows):

1. click 1, Shift 5 -> [1..5]; Shift 3 -> [1..3]; anchor 1.
2. click 5, Shift 1 -> [1..5]; Shift 8 -> [5..8].
3. click 1, Ctrl 8, Shift 5 -> {1, 5..8}; Shift 9 -> {1, 8..9}.
4. check 2, check 9, uncheck 4, Shift 7 -> {2, 9}; Shift 1 -> {9}.
5. click 1, Shift 5, Ctrl+Shift 8 -> [1..8]; Shift 2 -> [1..5] (the committed base keeps 1..5).
6. nothing checked, active row 3, Shift 6 -> [3..6]; no active row -> {6}.
7. Shift steps after a filter change start a new gesture; the anchor follows its row id.
8. 100k rows: click 0, Shift 99_999, Shift 50 -> one slice [0, 51); no `toArray` call (spy).
9. header checkbox between two Shift clicks -> the second Shift click starts a new gesture.
10. `keepHiddenCheckedRows`: a hidden checked row survives a Shift range over its neighbors.
11. lazy source: a range over unloaded holes checks the view indices; row id readers skip holes.
12. unchanged Shift target -> no `onSelectionChange`.

Browser (`row-markers.browser.test.tsx`):

13. checkbox plain drag from 2 to 5 with 9 checked -> {2..5, 9}; drag back to 3 -> {2..3, 9}.
14. checkbox drag starting on a checked row unchecks the dragged span only.
15. Shift+press on the number zone and drag -> moving edge from the anchor; rows outside stay.
16. Ctrl+drag shrinks when dragged back.
17. Shift+click on a checkbox fires no `onCheckedChange` toggle (no double write).
18. Shift+Space, Shift+ArrowDown x2, Shift+ArrowUp -> rows [r..r+1]; active row r+1.
19. pointercancel mid-drag keeps the rows written so far and clears the drag (no commit step
    exists for selection).
20. touch tap on the checkbox toggles one row; no range.

## Decisions

1. Shift after an uncheck (row 7) unchecks the range: the range takes the anchor's state.
2. A plain Shift+click keeps the rows checked outside the range (row 6).
3. Keyboard range checking ships with this change: Shift+Arrow, Shift+Home/End and Shift+PageUp/PageDown
   extend and shrink the checked range after a row check (gap 7 and gap 10).
