import { describe, it, expect } from "vitest";
import { CompactSelection } from "./compact-selection";
import type { GridSelection } from "../types";
import {
  rectFromCorners,
  combineRects,
  rectContains,
  pointInRect,
  intersectRect,
  emptySelection,
  selectCell,
  isSelectionEmpty,
  extendTo,
  extendSelection,
  pushRange,
  selectionContainsCell,
  selectionRects,
  selectRow,
  selectColumn,
  offsetSelectionForRows,
  selectAllProgression,
  computeDataRegion,
  type IsEmptyAt,
} from ".";

describe("rect helpers", () => {
  it("rectFromCorners normalizes regardless of drag direction", () => {
    expect(rectFromCorners({ col: 2, row: 3 }, { col: 5, row: 7 })).toEqual({ x: 2, y: 3, width: 4, height: 5 });
    expect(rectFromCorners({ col: 5, row: 7 }, { col: 2, row: 3 })).toEqual({ x: 2, y: 3, width: 4, height: 5 });
  });

  it("rectFromCorners handles a single cell", () => {
    expect(rectFromCorners({ col: 1, row: 1 }, { col: 1, row: 1 })).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });

  it("combineRects returns the bounding box union", () => {
    const a = { x: 0, y: 0, width: 2, height: 2 };
    const b = { x: 3, y: 3, width: 2, height: 2 };
    expect(combineRects(a, b)).toEqual({ x: 0, y: 0, width: 5, height: 5 });
  });

  it("rectContains / pointInRect agree and respect the half-open far edge", () => {
    const rect = { x: 1, y: 1, width: 2, height: 2 }; // cols 1-2, rows 1-2
    expect(rectContains(rect, { col: 1, row: 1 })).toBe(true);
    expect(rectContains(rect, { col: 2, row: 2 })).toBe(true);
    expect(rectContains(rect, { col: 3, row: 1 })).toBe(false);
    expect(rectContains(rect, { col: 1, row: 3 })).toBe(false);
    expect(pointInRect({ col: 1, row: 1 }, rect)).toBe(true);
    expect(pointInRect({ col: 3, row: 1 }, rect)).toBe(false);
  });

  it("intersectRect returns overlap or null when disjoint", () => {
    const a = { x: 0, y: 0, width: 4, height: 4 };
    const b = { x: 2, y: 2, width: 4, height: 4 };
    expect(intersectRect(a, b)).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    const c = { x: 10, y: 10, width: 2, height: 2 };
    expect(intersectRect(a, c)).toBeNull();
  });

  it("intersectRect returns null for merely adjacent (touching) rects", () => {
    const a = { x: 0, y: 0, width: 2, height: 2 };
    const b = { x: 2, y: 0, width: 2, height: 2 };
    expect(intersectRect(a, b)).toBeNull();
  });
});

describe("emptySelection / selectCell", () => {
  it("emptySelection has no current and empty channels", () => {
    const s = emptySelection();
    expect(s.current).toBeNull();
    expect(s.rows.length).toBe(0);
    expect(s.columns.length).toBe(0);
  });

  it("selectCell anchors a 1x1 range at the cell", () => {
    const s = selectCell({ col: 3, row: 4 });
    expect(s.current).toEqual({
      cell: { col: 3, row: 4 },
      range: { x: 3, y: 4, width: 1, height: 1 },
      rangeStack: [],
    });
    expect(s.rows.length).toBe(0);
    expect(s.columns.length).toBe(0);
  });

  it("isSelectionEmpty recognizes all three selection channels", () => {
    expect(isSelectionEmpty(emptySelection())).toBe(true);
    expect(isSelectionEmpty(selectCell({ col: 0, row: 0 }))).toBe(false);
    expect(isSelectionEmpty({ ...emptySelection(), rows: CompactSelection.fromArray([1]) })).toBe(false);
    expect(isSelectionEmpty({ ...emptySelection(), columns: CompactSelection.fromArray([2]) })).toBe(false);
  });
});

describe("extendTo", () => {
  it("extends the range from the anchor to the new coord, keeping anchor", () => {
    const start = selectCell({ col: 2, row: 2 });
    const extended = extendTo(start, { col: 5, row: 4 });
    expect(extended.current?.cell).toEqual({ col: 2, row: 2 });
    expect(extended.current?.range).toEqual({ x: 2, y: 2, width: 4, height: 3 });
  });

  it("extending back over the anchor still keeps anchor fixed", () => {
    const start = selectCell({ col: 5, row: 5 });
    const extended = extendTo(start, { col: 1, row: 1 });
    expect(extended.current?.cell).toEqual({ col: 5, row: 5 });
    expect(extended.current?.range).toEqual({ x: 1, y: 1, width: 5, height: 5 });
  });

  it("preserves the range stack", () => {
    const start = pushRange(selectCell({ col: 0, row: 0 }), { col: 2, row: 2 });
    const extended = extendTo(start, { col: 4, row: 4 });
    expect(extended.current?.rangeStack).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
  });

  it("falls back to selectCell when there is no current selection", () => {
    const extended = extendTo(emptySelection(), { col: 2, row: 2 });
    expect(extended.current?.cell).toEqual({ col: 2, row: 2 });
  });
});

describe("extendSelection", () => {
  const opts = { rowCount: 20, colCount: 20 };

  it("grows the far edge downward when anchor is at the top", () => {
    let sel = selectCell({ col: 2, row: 5 });
    sel = extendSelection(sel, "down", opts);
    expect(sel.current?.range).toEqual({ x: 2, y: 5, width: 1, height: 2 }); // rows 5-6
    sel = extendSelection(sel, "down", opts);
    expect(sel.current?.range).toEqual({ x: 2, y: 5, width: 1, height: 3 }); // rows 5-7
  });

  it("shrinks the near edge back toward the anchor when growth reverses (Excel contraction)", () => {
    let sel = selectCell({ col: 2, row: 5 });
    sel = extendSelection(sel, "down", opts); // rows 5-6
    sel = extendSelection(sel, "down", opts); // rows 5-7
    sel = extendSelection(sel, "up", opts); // shrink back to rows 5-6
    expect(sel.current?.range).toEqual({ x: 2, y: 5, width: 1, height: 2 });
    sel = extendSelection(sel, "up", opts); // shrink back to 1x1 at anchor
    expect(sel.current?.range).toEqual({ x: 2, y: 5, width: 1, height: 1 });
  });

  it("continues growing past the anchor in the opposite direction once shrunk to 1x1", () => {
    let sel = selectCell({ col: 2, row: 5 });
    sel = extendSelection(sel, "down", opts);
    sel = extendSelection(sel, "up", opts); // back to 1x1
    sel = extendSelection(sel, "up", opts); // now grows upward past anchor
    expect(sel.current?.range).toEqual({ x: 2, y: 4, width: 1, height: 2 }); // rows 4-5
    expect(sel.current?.cell).toEqual({ col: 2, row: 5 });
  });

  it("grows the far edge rightward when anchor is at the left, and shrinks on reversal", () => {
    let sel = selectCell({ col: 5, row: 2 });
    sel = extendSelection(sel, "right", opts);
    sel = extendSelection(sel, "right", opts);
    expect(sel.current?.range).toEqual({ x: 5, y: 2, width: 3, height: 1 }); // cols 5-7
    sel = extendSelection(sel, "left", opts);
    expect(sel.current?.range).toEqual({ x: 5, y: 2, width: 2, height: 1 }); // cols 5-6
  });

  it("grows leftward from anchor, and shrinks back on right reversal", () => {
    let sel = selectCell({ col: 5, row: 2 });
    sel = extendSelection(sel, "left", opts);
    sel = extendSelection(sel, "left", opts);
    expect(sel.current?.range).toEqual({ x: 3, y: 2, width: 3, height: 1 }); // cols 3-5
    sel = extendSelection(sel, "right", opts);
    expect(sel.current?.range).toEqual({ x: 4, y: 2, width: 2, height: 1 }); // cols 4-5
  });

  it("toEdge grows the far edge to the right/left grid boundary in one call", () => {
    let sel = selectCell({ col: 5, row: 2 });
    sel = extendSelection(sel, "right", { ...opts, toEdge: true });
    expect(sel.current?.range).toEqual({ x: 5, y: 2, width: opts.colCount - 5, height: 1 });
    sel = extendSelection(sel, "left", { ...opts, toEdge: true });
    expect(sel.current?.range).toEqual({ x: 0, y: 2, width: 6, height: 1 }); // cols 0-5
  });

  it("clamps growth at the grid edges", () => {
    let sel = selectCell({ col: 0, row: 0 });
    sel = extendSelection(sel, "up", opts);
    sel = extendSelection(sel, "left", opts);
    expect(sel.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("toEdge grows the far edge all the way to the grid boundary in one call", () => {
    let sel = selectCell({ col: 2, row: 5 });
    sel = extendSelection(sel, "down", { ...opts, toEdge: true });
    expect(sel.current?.range).toEqual({ x: 2, y: 5, width: 1, height: opts.rowCount - 5 });
    // toEdge unconditionally sets near edge = anchor, far edge = boundary (glide/Excel: the
    // moving end jumps to the opposite boundary, crossing over the anchor)
    sel = extendSelection(sel, "up", { ...opts, toEdge: true });
    expect(sel.current?.range).toEqual({ x: 2, y: 0, width: 1, height: 6 }); // rows 0-5
  });

  it("toEdge crosses over the anchor to the opposite boundary even from a small range", () => {
    let sel = selectCell({ col: 2, row: 5 });
    sel = extendSelection(sel, "down", opts); // rows 5-6
    sel = extendSelection(sel, "up", { ...opts, toEdge: true }); // grow to top: rows 0-5
    expect(sel.current?.range).toEqual({ x: 2, y: 0, width: 1, height: 6 });
  });

  it("toEdge grows to the far boundary even when the range already extends opposite the pressed direction", () => {
    // range rows 3-5, anchored at row 5 (bottom): primary+Shift+Down must grow to the grid
    // edge (rows 5..maxRow), not collapse to a 1x1 at the anchor
    let sel = selectCell({ col: 2, row: 5 });
    sel = extendSelection(sel, "up", opts); // rows 4-5
    sel = extendSelection(sel, "up", opts); // rows 3-5
    sel = extendSelection(sel, "down", { ...opts, toEdge: true });
    expect(sel.current?.range).toEqual({ x: 2, y: 5, width: 1, height: opts.rowCount - 5 }); // rows 5-19
    expect(sel.current?.cell).toEqual({ col: 2, row: 5 });
  });

  it("toEdge upward grows to the top boundary even when the range already extends opposite the pressed direction", () => {
    // range rows 5-7, anchored at row 5 (top): primary+Shift+Up must grow to the grid
    // edge (rows 0..5), not collapse to a 1x1 at the anchor
    let sel = selectCell({ col: 2, row: 5 });
    sel = extendSelection(sel, "down", opts); // rows 5-6
    sel = extendSelection(sel, "down", opts); // rows 5-7
    sel = extendSelection(sel, "up", { ...opts, toEdge: true });
    expect(sel.current?.range).toEqual({ x: 2, y: 0, width: 1, height: 6 }); // rows 0-5
    expect(sel.current?.cell).toEqual({ col: 2, row: 5 });
  });

  it("is a no-op when there is no current selection", () => {
    const sel = extendSelection(emptySelection(), "down", opts);
    expect(sel.current).toBeNull();
  });

  it("preserves the range stack while growing", () => {
    let sel = pushRange(selectCell({ col: 0, row: 0 }), { col: 5, row: 5 });
    sel = extendSelection(sel, "right", opts);
    expect(sel.current?.rangeStack).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
  });
});

describe("pushRange", () => {
  it("pushes the current range onto the stack and starts a new 1x1 range", () => {
    const start = selectCell({ col: 1, row: 1 });
    const pushed = pushRange(start, { col: 4, row: 4 });
    expect(pushed.current?.range).toEqual({ x: 4, y: 4, width: 1, height: 1 });
    expect(pushed.current?.cell).toEqual({ col: 4, row: 4 });
    expect(pushed.current?.rangeStack).toEqual([{ x: 1, y: 1, width: 1, height: 1 }]);
  });

  it("accumulates multiple pushes in order", () => {
    let sel = selectCell({ col: 0, row: 0 });
    sel = pushRange(sel, { col: 1, row: 1 });
    sel = pushRange(sel, { col: 2, row: 2 });
    expect(sel.current?.rangeStack).toEqual([
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 1, y: 1, width: 1, height: 1 },
    ]);
    expect(sel.current?.range).toEqual({ x: 2, y: 2, width: 1, height: 1 });
  });

  it("ctrl-clicking the already-active 1x1 cell still pushes it onto the stack (glide's unconditional push)", () => {
    const sel = pushRange(selectCell({ col: 0, row: 0 }), { col: 0, row: 0 });
    expect(sel.current?.rangeStack).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);
  });

  it("starts a fresh 1x1 selection when there is no current selection to push", () => {
    const sel = pushRange(emptySelection(), { col: 2, row: 2 });
    expect(sel.current?.range).toEqual({ x: 2, y: 2, width: 1, height: 1 });
    expect(sel.current?.rangeStack).toEqual([]);
  });
});

describe("selectionContainsCell", () => {
  it("checks the primary range", () => {
    const sel = selectCell({ col: 2, row: 2 });
    expect(selectionContainsCell(sel, { col: 2, row: 2 }, 10, 10)).toBe(true);
    expect(selectionContainsCell(sel, { col: 3, row: 3 }, 10, 10)).toBe(false);
  });

  it("checks the range stack", () => {
    const sel = pushRange(selectCell({ col: 0, row: 0 }), { col: 5, row: 5 });
    expect(selectionContainsCell(sel, { col: 0, row: 0 }, 10, 10)).toBe(true);
    expect(selectionContainsCell(sel, { col: 5, row: 5 }, 10, 10)).toBe(true);
  });

  it("is false for a coord that misses the primary range and every stacked range", () => {
    const sel = pushRange(selectCell({ col: 0, row: 0 }), { col: 5, row: 5 });
    expect(selectionContainsCell(sel, { col: 9, row: 9 }, 10, 10)).toBe(false);
  });

  it("checks the rows channel (full width)", () => {
    const sel: GridSelection = { current: null, rows: CompactSelection.fromSingleSelection(3), columns: CompactSelection.empty() };
    expect(selectionContainsCell(sel, { col: 99, row: 3 }, 10, 100)).toBe(true);
    expect(selectionContainsCell(sel, { col: 0, row: 4 }, 10, 100)).toBe(false);
  });

  it("checks the columns channel (full height)", () => {
    const sel: GridSelection = { current: null, rows: CompactSelection.empty(), columns: CompactSelection.fromSingleSelection(2) };
    expect(selectionContainsCell(sel, { col: 2, row: 99 }, 100, 10)).toBe(true);
    expect(selectionContainsCell(sel, { col: 3, row: 0 }, 100, 10)).toBe(false);
  });
});

describe("selectionRects", () => {
  it("orders primary range, then range stack, then columns, then rows", () => {
    const sel: GridSelection = {
      current: {
        cell: { col: 0, row: 0 },
        range: { x: 0, y: 0, width: 1, height: 1 },
        rangeStack: [{ x: 2, y: 2, width: 1, height: 1 }],
      },
      rows: CompactSelection.fromSingleSelection(9),
      columns: CompactSelection.fromSingleSelection(8),
    };
    const rects = selectionRects(sel, 10, 10);
    expect(rects).toEqual([
      { x: 0, y: 0, width: 1, height: 1 }, // primary range
      { x: 2, y: 2, width: 1, height: 1 }, // range stack
      { x: 8, y: 0, width: 1, height: 10 }, // full-height column
      { x: 0, y: 9, width: 10, height: 1 }, // full-width row
    ]);
  });

  it("returns an empty list for an empty selection", () => {
    expect(selectionRects(emptySelection(), 10, 10)).toEqual([]);
  });

  it("resolves multiple rows and columns each as their own rect", () => {
    const sel: GridSelection = {
      current: null,
      rows: CompactSelection.fromArray([1, 3]),
      columns: CompactSelection.fromArray([0, 2]),
    };
    const rects = selectionRects(sel, 5, 5);
    expect(rects).toEqual([
      { x: 0, y: 0, width: 1, height: 5 },
      { x: 2, y: 0, width: 1, height: 5 },
      { x: 0, y: 1, width: 5, height: 1 },
      { x: 0, y: 3, width: 5, height: 1 },
    ]);
  });
});

describe("selectRow / selectColumn", () => {
  it("plain click toggle-selects a single row, clearing the rest and the range", () => {
    let sel = emptySelection();
    sel = selectRow(sel, 3, {});
    expect(sel.rows.toArray()).toEqual([3]);
    expect(sel.current).toBeNull();
    sel = selectRow(sel, 3, {}); // click again deselects
    expect(sel.rows.length).toBe(0);
  });

  it("plain click on a different row replaces the selection", () => {
    let sel = selectRow(emptySelection(), 3, {});
    sel = selectRow(sel, 7, {});
    expect(sel.rows.toArray()).toEqual([7]);
  });

  it("ctrl-click additively toggles a row", () => {
    let sel = selectRow(emptySelection(), 3, {});
    sel = selectRow(sel, 5, { additive: true });
    expect(sel.rows.toArray()).toEqual([3, 5]);
    sel = selectRow(sel, 3, { additive: true }); // toggling an existing member removes it
    expect(sel.rows.toArray()).toEqual([5]);
  });

  it("shift-click ranges from the last-selected row", () => {
    let sel = selectRow(emptySelection(), 2, {});
    sel = selectRow(sel, 5, { extendFromLast: true });
    expect(sel.rows.toArray()).toEqual([2, 3, 4, 5]);
  });

  it("shift-click ranges from an explicit `from` (insertion-order last-highlighted), not the channel's max member", () => {
    // ctrl-click row 8, ctrl-click row 5, shift-click row 9: the range spans from 5 (last
    // highlighted), not from 8 (the channel's max index)
    let sel = selectRow(emptySelection(), 8, {});
    sel = selectRow(sel, 5, { additive: true });
    sel = selectRow(sel, 9, { extendFromLast: true, from: 5 });
    expect(sel.rows.toArray()).toEqual([5, 6, 7, 8, 9]);
  });

  it("falls back to the channel's max index when `from` is omitted", () => {
    let sel = selectRow(emptySelection(), 8, {});
    sel = selectRow(sel, 5, { additive: true });
    sel = selectRow(sel, 9, { extendFromLast: true });
    expect(sel.rows.toArray()).toEqual([5, 8, 9]);
  });

  it("replaceFromLast makes the row channel exactly the anchor..index span (the drag's moving edge)", () => {
    let sel = selectRow(emptySelection(), 0, {});
    sel = selectRow(sel, 4, { replaceFromLast: true, from: 0 });
    expect(sel.rows.toArray()).toEqual([0, 1, 2, 3, 4]);
    // dragging back UP shrinks the span again — the union-extend semantics never could
    sel = selectRow(sel, 1, { replaceFromLast: true, from: 0 });
    expect(sel.rows.toArray()).toEqual([0, 1]);
  });

  it("replaceFromLast preserves the column channel, like extendFromLast", () => {
    let sel = selectColumn(emptySelection(), 1, {});
    sel = selectRow(sel, 3, { replaceFromLast: true, from: 1 });
    expect(sel.columns.toArray()).toEqual([1]);
    expect(sel.rows.toArray()).toEqual([1, 2, 3]);
    expect(sel.current).toBeNull();
  });

  it("selecting a row clears the column channel and current range", () => {
    let sel = selectColumn(emptySelection(), 1, {});
    sel = selectRow(sel, 2, {});
    expect(sel.columns.length).toBe(0);
    expect(sel.current).toBeNull();
  });

  it("selectColumn mirrors selectRow semantics on the column channel", () => {
    let sel = selectColumn(emptySelection(), 4, {});
    expect(sel.columns.toArray()).toEqual([4]);
    sel = selectColumn(sel, 6, { extendFromLast: true });
    expect(sel.columns.toArray()).toEqual([4, 5, 6]);
  });
});

describe("offsetSelectionForRows", () => {
  it("shifts rows channel members after the insertion point", () => {
    const sel: GridSelection = { current: null, rows: CompactSelection.fromArray([1, 5, 8]), columns: CompactSelection.empty() };
    const shifted = offsetSelectionForRows(sel, 3, 1);
    expect(shifted.rows.toArray()).toEqual([1, 6, 9]);
  });

  it("does not shift rows channel members before the insertion point", () => {
    const sel: GridSelection = { current: null, rows: CompactSelection.fromArray([1, 5]), columns: CompactSelection.empty() };
    const shifted = offsetSelectionForRows(sel, 3, 1);
    expect(shifted.rows.toArray()).toEqual([1, 6]);
  });

  it("shifts a range's y and cell.row when it starts after the insertion point", () => {
    const sel = selectCell({ col: 0, row: 10 });
    const shifted = offsetSelectionForRows(sel, 5, 2);
    expect(shifted.current?.cell).toEqual({ col: 0, row: 12 });
    expect(shifted.current?.range).toEqual({ x: 0, y: 12, width: 1, height: 1 });
  });

  it("grows a range's height when a row is inserted inside it, without moving its top", () => {
    let sel = selectCell({ col: 0, row: 2 });
    sel = extendSelection(sel, "down", { rowCount: 20, colCount: 20 });
    sel = extendSelection(sel, "down", { rowCount: 20, colCount: 20 }); // rows 2-4
    const shifted = offsetSelectionForRows(sel, 3, 1);
    expect(shifted.current?.range).toEqual({ x: 0, y: 2, width: 1, height: 4 });
  });

  it("shrinks a range's height when a row is deleted from inside it", () => {
    let sel = selectCell({ col: 0, row: 2 });
    sel = extendSelection(sel, "down", { rowCount: 20, colCount: 20 });
    sel = extendSelection(sel, "down", { rowCount: 20, colCount: 20 }); // rows 2-4
    const shifted = offsetSelectionForRows(sel, 3, -1);
    expect(shifted.current?.range).toEqual({ x: 0, y: 2, width: 1, height: 2 });
  });

  it("shrinks a range's height when the deleted row is the rect's first row", () => {
    // rect rows 3-5 (y:3,h:3), delete row 3 -> rows 3-4 (y:3,h:2); must not keep old row 6
    const sel: GridSelection = {
      current: { cell: { col: 0, row: 5 }, range: { x: 0, y: 3, width: 1, height: 3 }, rangeStack: [] },
      rows: CompactSelection.empty(),
      columns: CompactSelection.empty(),
    };
    const shifted = offsetSelectionForRows(sel, 3, -1);
    expect(shifted.current?.range).toEqual({ x: 0, y: 3, width: 1, height: 2 });
  });

  it("leaves a range entirely before the insertion point untouched", () => {
    const sel: GridSelection = {
      current: { cell: { col: 0, row: 1 }, range: { x: 0, y: 0, width: 1, height: 2 }, rangeStack: [] },
      rows: CompactSelection.empty(),
      columns: CompactSelection.empty(),
    };
    const shifted = offsetSelectionForRows(sel, 5, 3);
    expect(shifted.current?.range).toEqual({ x: 0, y: 0, width: 1, height: 2 });
  });

  it("shrinks a range's height by the full overlap for a multi-row delete starting at its first row", () => {
    // rect rows 4-6 (y:4,h:3), delete rows 3-4 (atIndex=3, delta=-2) -> rows 3-4 (y:3,h:2)
    const sel: GridSelection = {
      current: { cell: { col: 0, row: 6 }, range: { x: 0, y: 4, width: 1, height: 3 }, rangeStack: [] },
      rows: CompactSelection.empty(),
      columns: CompactSelection.empty(),
    };
    const shifted = offsetSelectionForRows(sel, 3, -2);
    expect(shifted.current?.range).toEqual({ x: 0, y: 3, width: 1, height: 2 });
  });
});

/** All cells non-empty — every case below that used to be single-stage "select everything" now exercises the dense-data path where stage 1 already equals the whole grid. */
const denseIsEmpty: IsEmptyAt = () => false;

describe("computeDataRegion", () => {
  it("returns just the active cell when it is itself empty", () => {
    const isEmptyAt: IsEmptyAt = (c) => c.col === 2 && c.row === 2;
    expect(computeDataRegion({ col: 2, row: 2 }, 10, 10, isEmptyAt)).toEqual({ x: 2, y: 2, width: 1, height: 1 });
  });

  it("floods outward to the empty-cell boundary around the active cell", () => {
    // 5x5 grid; non-empty block is rows 1-3, cols 1-3; everything else empty.
    const isEmptyAt: IsEmptyAt = (c) => c.row < 1 || c.row > 3 || c.col < 1 || c.col > 3;
    expect(computeDataRegion({ col: 2, row: 2 }, 5, 5, isEmptyAt)).toEqual({ x: 1, y: 1, width: 3, height: 3 });
  });

  it("stops at the grid edge when the data block touches it", () => {
    // non-empty block is rows 0-1, cols 0-1 of a 5x5 grid (touches the top-left edge).
    const isEmptyAt: IsEmptyAt = (c) => c.row > 1 || c.col > 1;
    expect(computeDataRegion({ col: 0, row: 0 }, 5, 5, isEmptyAt)).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it("equals the whole grid for fully dense data", () => {
    expect(computeDataRegion({ col: 3, row: 3 }, 10, 20, denseIsEmpty)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });
});

describe("selectAllProgression", () => {
  it("dense data: stage 1 already selects the whole grid, keeping the anchor", () => {
    const sel = selectCell({ col: 4, row: 4 });
    const { selection: all, stage } = selectAllProgression(sel, 10, 20, { col: 4, row: 4 }, denseIsEmpty, null);
    expect(all.current?.range).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expect(all.current?.cell).toEqual({ col: 4, row: 4 });
    expect(all.current?.rangeStack).toEqual([]);
    expect(all.rows.length).toBe(0);
    expect(all.columns.length).toBe(0);
    expect(stage).toBe("all");
  });

  it("dense data: a repeated stage-1 call (no prior progression) does not toggle anything off", () => {
    const sel = selectCell({ col: 4, row: 4 });
    const { selection: all } = selectAllProgression(sel, 10, 20, { col: 4, row: 4 }, denseIsEmpty, null);
    const { selection: again, stage } = selectAllProgression(all, 10, 20, { col: 4, row: 4 }, denseIsEmpty, null);
    expect(again).toBe(all);
    expect(stage).toBe("all");
  });

  it("dense data: defaults the anchor to [0,0] when there is no current selection", () => {
    const { selection: all } = selectAllProgression(emptySelection(), 5, 5, { col: 0, row: 0 }, denseIsEmpty, null);
    expect(all.current?.cell).toEqual({ col: 0, row: 0 });
    expect(all.current?.range).toEqual({ x: 0, y: 0, width: 5, height: 5 });
  });

  it("dense data: re-selects the whole grid if a smaller range existed even with anchor at origin", () => {
    const sel = selectCell({ col: 0, row: 0 });
    const { selection: all } = selectAllProgression(sel, 3, 3, { col: 0, row: 0 }, denseIsEmpty, null);
    expect(all.current?.range).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it("sparse data: stage 1 selects the data region, not the whole grid", () => {
    const isEmptyAt: IsEmptyAt = (c) => c.row > 2 || c.col > 2; // data block is rows/cols 0-2 of a 10x10 grid
    const sel = selectCell({ col: 1, row: 1 });
    const { selection, stage } = selectAllProgression(sel, 10, 10, { col: 1, row: 1 }, isEmptyAt, null);
    expect(selection.current?.range).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(stage).toBe("region");
  });

  it("sparse data: stage 2 (prior stage 'region') selects the whole grid", () => {
    const isEmptyAt: IsEmptyAt = (c) => c.row > 2 || c.col > 2;
    const sel = selectCell({ col: 1, row: 1 });
    const { selection: regionSel } = selectAllProgression(sel, 10, 10, { col: 1, row: 1 }, isEmptyAt, null);
    const { selection: allSel, stage } = selectAllProgression(regionSel, 10, 10, { col: 1, row: 1 }, isEmptyAt, "region");
    expect(allSel.current?.range).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(allSel.current?.cell).toEqual({ col: 1, row: 1 });
    expect(stage).toBe("all");
  });

  it("sparse data: stage 'all' repeated (no reset) starts back over at the region", () => {
    const isEmptyAt: IsEmptyAt = (c) => c.row > 2 || c.col > 2;
    const sel = selectCell({ col: 1, row: 1 });
    const { selection, stage } = selectAllProgression(sel, 10, 10, { col: 1, row: 1 }, isEmptyAt, "all");
    expect(selection.current?.range).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(stage).toBe("region");
  });
});
