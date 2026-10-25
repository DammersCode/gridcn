import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { CompactSelection } from "../selection/compact-selection";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Item = { id: string; v: number };

const columns: readonly ColumnDef<Item, unknown>[] = [{ id: "v", header: "V", accessorKey: "v", type: "number" }];

function makeStore(count: number, extra: Partial<InternalSyncProps> = {}) {
  const data = Array.from({ length: count }, (_, i) => ({ id: String(i), v: i }));
  const init = { data, columns, getRowId: (row: Item) => row.id, ...extra } as unknown as InternalSyncProps;
  return createDataGridStore(init);
}

type Store = ReturnType<typeof makeStore>;

const checked = (store: Store): number[] => store.getState().selection.rows.toArray();
const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

describe("row range checking", () => {
  it("replaces the previous Shift range: grow, then shrink", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.selectRow(1);
    actions.checkRowRange(5);
    expect(checked(store)).toEqual(range(1, 5));
    actions.checkRowRange(3);
    expect(checked(store)).toEqual(range(1, 3));
    expect(store.getState().rowRangeGesture?.anchor).toBe(1);
  });

  it("flips to the other side of the anchor", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.selectRow(5);
    actions.checkRowRange(1);
    expect(checked(store)).toEqual(range(1, 5));
    actions.checkRowRange(8);
    expect(checked(store)).toEqual(range(5, 8));
  });

  it("keeps rows checked outside the range after a Ctrl click", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.selectRow(1);
    actions.selectRow(8, { additive: true });
    actions.checkRowRange(5);
    expect(checked(store)).toEqual([1, 5, 6, 7, 8]);
    actions.checkRowRange(9);
    expect(checked(store)).toEqual([1, 8, 9]);
  });

  it("unchecks the range when the anchor row was unchecked", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.setRowSelected(2, true);
    actions.setRowSelected(9, true);
    actions.setRowSelected(4, false);
    actions.checkRowRange(7);
    expect(checked(store)).toEqual([2, 9]);
    actions.checkRowRange(1);
    expect(checked(store)).toEqual([9]);
  });

  it("commits the previous range on Ctrl/Cmd+Shift", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.selectRow(1);
    actions.checkRowRange(5);
    actions.checkRowRange(8, { commit: true });
    expect(checked(store)).toEqual(range(1, 8));
    actions.checkRowRange(2);
    expect(checked(store)).toEqual(range(1, 5));
  });

  it("starts from the active row without a gesture, else from the target", () => {
    const withActive = makeStore(12);
    withActive.getState().actions.selectCellAt({ row: 3, col: 0 });
    withActive.getState().actions.checkRowRange(6);
    expect(checked(withActive)).toEqual(range(3, 6));

    const withoutActive = makeStore(12);
    withoutActive.getState().actions.checkRowRange(6);
    expect(checked(withoutActive)).toEqual([6]);
  });

  it("follows the anchor row id after the view changes", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.selectRow(1);
    actions.checkRowRange(5);
    store.setState({ viewIndex: range(1, 11) });
    actions.checkRowRange(3);
    expect(store.getState().rowRangeGesture?.anchor).toBe(0);
  });

  it("starts a new gesture after the header checkbox wrote the row channel", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.selectRow(1);
    actions.checkRowRange(3);
    actions.setAllRowsSelected(false);
    actions.checkRowRange(5);
    expect(checked(store)).toEqual(range(1, 5));
    actions.checkRowRange(2);
    expect(checked(store)).toEqual(range(1, 2));
  });

  it("never touches hidden checked rows", () => {
    const store = makeStore(12, { keepCheckedRows: true, keepHiddenCheckedRows: true });
    const { actions } = store.getState();
    actions.setAllRowsSelected(true);
    actions.setFilters([{ filterId: "f", columnId: "v", operator: "equals", value: "11" }] as never);
    const hidden = store.getState().hiddenCheckedRowIds;
    expect(hidden.size).toBe(11);
    actions.setRowSelected(0, false);
    actions.checkRowRange(0);
    expect(store.getState().hiddenCheckedRowIds).toBe(hidden);
  });

  it("checks view indices across lazy holes", () => {
    const store = makeStore(12);
    const data = store.getState().data.slice();
    delete data[2];
    store.setState({ data });
    const { actions } = store.getState();
    actions.selectRow(1);
    actions.checkRowRange(3);
    expect(checked(store)).toEqual([1, 2, 3]);
    actions.selectRow(2);
    expect(store.getState().rowRangeGesture?.anchorRowId).toBeUndefined();
  });

  it("writes nothing when the target leaves the range unchanged", () => {
    const store = makeStore(12);
    const { actions } = store.getState();
    actions.selectRow(1);
    actions.checkRowRange(5);
    const listener = vi.fn();
    const unsubscribe = store.subscribe((state, prev) => {
      if (state.selection !== prev.selection) listener();
    });
    actions.checkRowRange(5);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("stays compact and fast at 100k rows", () => {
    const store = makeStore(100_000);
    const { actions } = store.getState();
    const toArray = vi.spyOn(CompactSelection.prototype, "toArray");
    const start = performance.now();
    actions.selectRow(0);
    actions.checkRowRange(99_999);
    actions.checkRowRange(50);
    const elapsed = performance.now() - start;
    expect(toArray).not.toHaveBeenCalled();
    toArray.mockRestore();
    expect(store.getState().selection.rows.length).toBe(51);
    expect(elapsed).toBeLessThan(50);
  });

  it("never materializes a channel that is not a CompactSelection", () => {
    const store = makeStore(12);
    const real = CompactSelection.fromSingleSelection([1, 3]);
    const toArray = vi.fn(() => real.toArray());
    const like = { length: real.length, hasIndex: (i: number) => real.hasIndex(i), equals: () => false, hasAll: () => false, toArray };
    const selection = { ...store.getState().selection, rows: like };
    const state = store.getState();
    store.setState({
      selection,
      rowRangeGesture: { anchor: 1, anchorRowId: "1", base: CompactSelection.empty(), checked: true, rows: like, current: null, viewIndex: state.viewIndex },
    });
    state.actions.checkRowRange(5, { commit: true });
    expect(toArray).not.toHaveBeenCalled();
    expect(store.getState().selection.rows.length).toBe(5);
  });

  it("ignores the target when row selection is off", () => {
    const store = makeStore(12, { enableRowSelection: false });
    store.getState().actions.checkRowRange(3);
    expect(checked(store)).toEqual([]);
  });
});
