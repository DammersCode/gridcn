import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";
import { getInternalActions } from "./internal-actions";
import { dispatchGridAction } from "../interaction/use-grid-interaction";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "other", header: "Other", accessorKey: "name" },
];

const rows = (): Row[] => ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id.toUpperCase() }));

function mount(props: Partial<DataGridSyncProps<Row>>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows()} {...props}>
      <Probe />
    </DataGridProvider>,
  );
  const state = () => api!.getState();
  return {
    state,
    store: () => api!,
    check: (...viewRows: number[]) => act(() => viewRows.forEach((r) => state().actions.setRowSelected(r, true))),
  };
}

function dispatch(store: StoreApi<DataGridStoreState>, action: "deleteRows" | "duplicateRow" | "cancel"): void {
  act(() =>
    dispatchGridAction({
      action,
      actions: store.getState().actions,
      storeApi: store,
      scrollRef: { current: null },
      scrollCellIntoView: () => {},
      rowHeight: 36,
      preventDefault: () => {},
    }),
  );
}

describe("clearCellSelection", () => {
  it("clears the range and the columns channel and keeps the checked rows", () => {
    const { state, check } = mount({});
    act(() => state().actions.selectCellAt({ col: 0, row: 4 }));
    check(0, 1, 2);
    act(() => state().actions.clearCellSelection());
    expect(state().selection.current).toBeNull();
    expect(state().selection.columns.length).toBe(0);
    expect(state().selection.rows.toArray()).toEqual([0, 1, 2]);
  });
});

describe("keepCheckedRows", () => {
  it("off: a cell click replaces the checked rows", () => {
    const { state, check } = mount({});
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    expect(state().selection.rows.length).toBe(0);
  });

  it("on: selecting a cell, extending, and pushing a range keep the checked rows", () => {
    const { state, check } = mount({ keepCheckedRows: true });
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
    expect(state().selection.current?.cell).toEqual({ col: 0, row: 3 });
    act(() => state().actions.extendToAt({ col: 1, row: 4 }));
    act(() => state().actions.pushRangeAt({ col: 0, row: 2 }));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
  });

  it("on: arrow navigation keeps the checked rows", () => {
    const { state, store, check } = mount({ keepCheckedRows: true });
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    act(() => getInternalActions(store())._moveActiveCell({ dx: 0, dy: 1 }));
    expect(state().selection.rows.toArray()).toEqual([0, 1]);
  });

  it("on: deleteRows removes only the checked rows, not the range", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store, check } = mount({ keepCheckedRows: true, onDataChange });
    check(0, 1);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    dispatch(store(), "deleteRows");
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["a", "b"]);
  });

  it("on: duplicateRow duplicates only the checked rows", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store, check } = mount({ keepCheckedRows: true, onDataChange, duplicateRow: (row) => ({ ...row, id: `${row.id}2` }) });
    check(0);
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    dispatch(store(), "duplicateRow");
    const [next] = onDataChange.mock.calls[0]!;
    expect(next.map((r) => r.id)).toEqual(["a", "a2", "b", "c", "d", "e"]);
  });

  it("on: with no checked row, deleteRows acts on the range", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store } = mount({ keepCheckedRows: true, onDataChange });
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    dispatch(store(), "deleteRows");
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId)).toEqual(["d"]);
  });

  it("off: deleteRows acts on the union of range and checked rows", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, store, check } = mount({ onDataChange });
    act(() => state().actions.selectCellAt({ col: 0, row: 3 }));
    check(0);
    dispatch(store(), "deleteRows");
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["a", "d"]);
  });

  it("on: Escape clears the checked rows", () => {
    const { state, store, check } = mount({ keepCheckedRows: true });
    check(0, 1);
    dispatch(store(), "cancel");
    expect(state().selection.rows.length).toBe(0);
  });

  it("on: unchecking and clearSelection still change the checks", () => {
    const { state, check } = mount({ keepCheckedRows: true });
    check(0, 1);
    act(() => state().actions.setRowSelected(0, false));
    expect(state().selection.rows.toArray()).toEqual([1]);
    act(() => state().actions.clearSelection());
    expect(state().selection.rows.length).toBe(0);
  });
});
