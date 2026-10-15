import { afterEach, describe, expect, it, vi } from "vitest";
import { createRowIndexCache } from "../store/row-index";
import { resolveSelectionState } from "../store/selection-state";
import { emptySelection } from "../selection/selection-ops";
import type { SelectionState } from "../types";

type Row = { id: string };

function source(n: number, getRowId: (row: unknown) => string) {
  const data: Row[] = Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
  return {
    selection: emptySelection(),
    viewIndex: data.map((_, i) => i),
    data,
    getRowId,
    visibleColumns: [{ id: "a" }, { id: "b" }] as never,
  };
}

const stateWith = (patch: Partial<SelectionState>): SelectionState => ({ anchor: null, range: null, rangeStack: [], rowIds: [], columnIds: [], ...patch });

afterEach(() => vi.restoreAllMocks());

describe("resolveSelectionState", () => {
  it("resolves many rowIds against a cold cache in O(n) getRowId calls", () => {
    const n = 20_000;
    let calls = 0;
    const s = source(n, (row) => {
      calls++;
      return (row as Row).id;
    });
    const rowIds = Array.from({ length: 500 }, (_, i) => `r${i * 40}`);
    const { grid } = resolveSelectionState(s, createRowIndexCache(), stateWith({ rowIds }), { value: false });
    expect(calls).toBeLessThan(3 * n);
    expect(grid.rows.toArray()).toEqual(rowIds.map((_, i) => i * 40));
  });

  it("a null anchor with a range resets to range.start without warning, and a later stale id still warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = source(10, (row) => (row as Row).id);
    const warned = { value: false };
    const range = { start: { rowId: "r1", columnId: "a" }, end: { rowId: "r3", columnId: "b" } };
    const result = resolveSelectionState(s, createRowIndexCache(), stateWith({ anchor: null, range }), warned);
    expect(warn).not.toHaveBeenCalled();
    expect(result.selection.anchor).toEqual(range.start);
    resolveSelectionState(s, createRowIndexCache(), stateWith({ rowIds: ["gone"], range: { start: { rowId: "gone", columnId: "a" }, end: range.end } }), warned);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
