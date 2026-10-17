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

  const idsAt = (n: number, ids: string[]) => Array.from({ length: n }, (_, i) => ids[i % ids.length]!);

  it("a duplicate row id resolves to its first row through the index path and the single-id path alike", () => {
    const dup = (n: number) => {
      const s = source(n, (row) => (row as Row).id);
      s.data[5] = { id: "r2" };
      return s;
    };
    const many = resolveSelectionState(dup(20), createRowIndexCache(), stateWith({ rowIds: idsAt(9, ["r2"]) }), { value: false });
    const few = resolveSelectionState(dup(20), createRowIndexCache(), stateWith({ rowIds: ["r2"] }), { value: false });
    expect(few.grid.rows.toArray()).toEqual([2]);
    expect(many.grid.rows.toArray()).toEqual([2]);
  });

  it("switches to one index build when the lookup count exceeds the warm threshold", () => {
    const n = 1000;
    const callsFor = (idCount: number) => {
      let calls = 0;
      const s = source(n, (row) => {
        calls++;
        return (row as Row).id;
      });
      resolveSelectionState(s, createRowIndexCache(), stateWith({ rowIds: idsAt(idCount, [`r${n - 1}`]) }), { value: false });
      return calls;
    };
    expect(callsFor(6)).toBeGreaterThan(3 * n);
    expect(callsFor(7)).toBe(n);
  });

  it("resolves range corners and anchor through the index path", () => {
    const s = source(50, (row) => (row as Row).id);
    const rowIds = idsAt(7, ["r1"]);
    const range = { start: { rowId: "r10", columnId: "a" }, end: { rowId: "r12", columnId: "b" } };
    const { grid } = resolveSelectionState(s, createRowIndexCache(), stateWith({ rowIds, range, anchor: range.start }), { value: false });
    expect(grid.current?.range).toEqual({ x: 0, y: 10, width: 2, height: 3 });
    expect(grid.current?.cell).toEqual({ row: 10, col: 0 });
  });
});
