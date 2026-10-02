import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { getSelectedViewRows } from "../selection/selected-view-rows";
import { DataGridProvider, useDataGridStoreApi, type DataGridProviderProps, type DataGridStoreState } from ".";
import { getSelectedRowIds } from "./compute";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
];

function rows(): Row[] {
  return [
    { id: "a", name: "Echo", age: 30 },
    { id: "b", name: "Alpha", age: 25 },
    { id: "c", name: "Delta", age: 40 },
    { id: "d", name: "Bravo", age: 35 },
    { id: "e", name: "Charlie", age: 20 },
  ];
}

type Props = Partial<DataGridProviderProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const getRowId = (row: Row) => row.id;
  const renderGrid = (next: Props) => (
    <DataGridProvider columns={columns} getRowId={getRowId} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(renderGrid(props));
  return {
    store: () => api!,
    rerender: (next: Props) => view.rerender(renderGrid(next)),
  };
}

function checkedIds(store: StoreApi<DataGridStoreState>): string[] {
  const s = store.getState();
  return s.selection.rows.toArray().map((viewRow) => s.getRowId(s.data[s.viewIndex[viewRow]!], s.viewIndex[viewRow]!));
}

function check(store: StoreApi<DataGridStoreState>, ids: readonly string[]): void {
  const s = store.getState();
  for (const id of ids) {
    const viewRow = s.viewIndex.findIndex((dataRow) => s.getRowId(s.data[dataRow], dataRow) === id);
    act(() => s.actions.setRowSelected(viewRow, true));
  }
}

describe("row channel follows record identity", () => {
  it("deleteRows after a sort deletes only the checked records", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { store } = mount({ defaultData: rows(), onDataChange });
    check(store(), ["a", "c"]);

    act(() => store().getState().actions.setSorts([{ columnId: "name", direction: "asc" }]));

    expect(checkedIds(store())).toEqual(["c", "a"]);
    act(() => store().getState().actions.deleteRows(getSelectedViewRows(store().getState().selection)));
    const [, change] = onDataChange.mock.calls[0]!;
    expect(change.ops.map((op) => op.rowId).sort()).toEqual(["a", "c"]);
  });

  it("duplicateRows after toggleSort duplicates only the checked records", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { store } = mount({ defaultData: rows(), onDataChange, duplicateRow: (row) => ({ ...row, id: `${row.id}2` }) });
    check(store(), ["b", "e"]);

    act(() => store().getState().actions.toggleSort("age", false));

    expect(checkedIds(store())).toEqual(["e", "b"]);
    act(() => store().getState().actions.duplicateRows(getSelectedViewRows(store().getState().selection)));
    const [next] = onDataChange.mock.calls[0]!;
    expect(next.map((row) => row.id).filter((id) => id.endsWith("2")).sort()).toEqual(["b2", "e2"]);
  });

  it("getRowIds reports the checked records after a sort", () => {
    const { store } = mount({ defaultData: rows() });
    check(store(), ["a", "d"]);

    act(() => store().getState().actions.setSorts([{ columnId: "age", direction: "desc" }]));

    expect(getSelectedRowIds(store().getState()).sort()).toEqual(["a", "d"]);
  });

  it("a filter that hides a checked row drops it from the selection", () => {
    const { store } = mount({ defaultData: rows() });
    check(store(), ["a", "e"]);

    act(() => store().getState().actions.setFilters([{ columnId: "age", operator: "gt", value: "25" }]));
    expect(checkedIds(store())).toEqual(["a"]);

    act(() => store().getState().actions.setFilters([]));
    expect(checkedIds(store())).toEqual(["a"]);
  });

  it("setJoinOperator keeps the checked records", () => {
    const { store } = mount({ defaultData: rows() });
    act(() =>
      store().getState().actions.setFilters([
        { columnId: "age", operator: "gt", value: "30" },
        { columnId: "name", operator: "contains", value: "Alpha" },
      ]),
    );
    expect(store().getState().viewIndex).toEqual([]);
    act(() => store().getState().actions.setJoinOperator("or"));
    check(store(), ["b", "d"]);
    expect(checkedIds(store())).toEqual(["b", "d"]);

    act(() => store().getState().actions.setJoinOperator("and"));
    expect(checkedIds(store())).toEqual([]);
  });

  it("a controlled sort and a consumer data swap keep the checked records", () => {
    const data = rows();
    const { store, rerender } = mount({ data });
    check(store(), ["b", "d"]);

    rerender({ data, sortState: [{ columnId: "name", direction: "desc" }] });
    expect(checkedIds(store())).toEqual(["d", "b"]);

    const refetched = [rows()[3]!, rows()[0]!, rows()[1]!];
    rerender({ data: refetched, sortState: [{ columnId: "name", direction: "desc" }] });
    expect(checkedIds(store())).toEqual(["d", "b"]);

    rerender({ data: refetched.filter((row) => row.id !== "d"), sortState: [{ columnId: "name", direction: "desc" }] });
    expect(checkedIds(store())).toEqual(["b"]);
  });

  it("an immediate updateCells reorder keeps the checked records", () => {
    const { store } = mount({ defaultData: rows() });
    act(() => store().getState().actions.setSorts([{ columnId: "age", direction: "asc" }]));
    check(store(), ["e"]);

    act(() => store().getState().actions.updateCells([{ rowId: "e", columnId: "age", value: 99 }], { reorder: "immediate" }));

    expect(store().getState().viewIndex.at(-1)).toBe(4);
    expect(checkedIds(store())).toEqual(["e"]);
  });

  it("a reconciled deferred updateCells keeps the checked records", () => {
    const { store } = mount({ defaultData: rows() });
    act(() => store().getState().actions.setSorts([{ columnId: "age", direction: "asc" }]));
    check(store(), ["e"]);

    act(() => store().getState().actions.updateCells([{ rowId: "e", columnId: "age", value: 99 }]));
    act(() => store().getState().actions.reconcileView());

    expect(checkedIds(store())).toEqual(["e"]);
  });
});

describe("row channel remap cost", () => {
  const ROW_COUNT = 100_000;

  function bigRows(): Row[] {
    return Array.from({ length: ROW_COUNT }, (_, i) => ({ id: `r${i}`, name: `n${i % 977}`, age: i % 101 }));
  }

  it("an empty row channel reads no row ids on a sort or a consumer data swap at 100k rows", () => {
    const getRowId = vi.fn((row: Row) => row.id);
    let api: StoreApi<DataGridStoreState> | null = null;
    function Probe() {
      api = useDataGridStoreApi();
      return null;
    }
    const data = bigRows();
    const view = render(
      <DataGridProvider data={data} columns={columns} getRowId={getRowId}>
        <Probe />
      </DataGridProvider>,
    );
    const selection = api!.getState().selection;
    getRowId.mockClear();

    act(() => api!.getState().actions.setSorts([{ columnId: "name", direction: "asc" }]));
    view.rerender(
      <DataGridProvider data={data.slice().reverse()} columns={columns} getRowId={getRowId}>
        <Probe />
      </DataGridProvider>,
    );

    expect(getRowId).not.toHaveBeenCalled();
    expect(api!.getState().selection).toBe(selection);
  });
});
