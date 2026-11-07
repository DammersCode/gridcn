import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; n: number };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "n", header: "N", accessorKey: "n", type: "number" }];
const getRowId = (row: Row) => row.id;
const rows: readonly Row[] = [
  { id: "a", n: 1 },
  { id: "b", n: 2 },
];

function mount(onDataChange: (next: readonly Row[]) => void) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (data: readonly Row[]) => (
    <DataGridProvider columns={columns} getRowId={getRowId} data={data} onDataChange={onDataChange}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(rows));
  const value = (rowId: string) => (api!.getState().data as readonly Row[]).find((row) => row.id === rowId)?.n;
  return { state: () => api!.getState(), value, rerender: (data: readonly Row[]) => view.rerender(tree(data)) };
}

describe("controlled data", () => {
  it("shows an edit at once and calls onDataChange with the next array", () => {
    const onDataChange = vi.fn();
    const grid = mount(onDataChange);
    act(() => grid.state().actions.commitCellValue({ rowId: "a", columnId: "n" }, 10));
    expect(grid.value("a")).toBe(10);
    expect(onDataChange).toHaveBeenCalledOnce();
    expect((onDataChange.mock.calls[0]![0] as readonly Row[])[0]!.n).toBe(10);
  });

  it("keeps an unstored edit while the app passes the same data array", () => {
    const grid = mount(() => {});
    act(() => grid.state().actions.commitCellValue({ rowId: "a", columnId: "n" }, 10));
    grid.rerender(rows);
    expect(grid.value("a")).toBe(10);
  });

  it("drops an unstored edit when a new data array arrives", () => {
    const grid = mount(() => {});
    act(() => grid.state().actions.commitCellValue({ rowId: "a", columnId: "n" }, 10));
    grid.rerender([...rows]);
    expect(grid.value("a")).toBe(1);
  });
});
