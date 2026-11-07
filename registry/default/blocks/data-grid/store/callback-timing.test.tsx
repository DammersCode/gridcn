import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, FilterNode } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";

type Row = { id: string; n: number };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "n", header: "N", accessorKey: "n" }];
const rows = (count = 10): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${i}`, n: i }));

function mount(props: Partial<DataGridSyncProps<Row>> = {}) {
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
  return () => api!.getState();
}

const boom = () => {
  throw new Error("boom");
};

afterEach(cleanup);

describe("consumer callbacks of the view actions", () => {
  it("onSortChange sees the written sort in uncontrolled mode", () => {
    let seen: unknown = null;
    const state = mount({ onSortChange: () => (seen = state().sortState) });
    act(() => state().actions.toggleSort("n", false));
    expect(seen).toEqual([{ columnId: "n", direction: "asc" }]);
    act(() => state().actions.setSorts([{ columnId: "n", direction: "desc" }]));
    expect(seen).toEqual([{ columnId: "n", direction: "desc" }]);
  });

  it("a throwing onSortChange keeps the sort and rethrows after the write", () => {
    const state = mount({ onSortChange: boom });
    expect(() => act(() => state().actions.setSorts([{ columnId: "n", direction: "desc" }]))).toThrow("boom");
    expect(state().sortState).toEqual([{ columnId: "n", direction: "desc" }]);
    expect(state().viewIndex[0]).toBe(9);
  });

  it("controlled sort calls onSortChange once with the next value and writes nothing", () => {
    const onSortChange = vi.fn();
    const state = mount({ sortState: [], onSortChange });
    act(() => state().actions.toggleSort("n", false));
    expect(onSortChange.mock.calls).toEqual([[[{ columnId: "n", direction: "asc" }]]]);
    expect(state().sortState).toEqual([]);
  });

  it("a throwing onFilterChange keeps the filter and still fires onPageChange", () => {
    const onPageChange = vi.fn();
    const state = mount({ defaultPageSize: 3, defaultPage: 2, onFilterChange: boom, onPageChange });
    const filter: FilterNode = { columnId: "n", operator: "equals", value: "4" };
    expect(() => act(() => state().actions.setFilters([filter]))).toThrow("boom");
    expect(state().filterState).toMatchObject([filter]);
    expect(state().page).toBe(1);
    expect(onPageChange.mock.calls).toEqual([[1]]);
  });

  it("onFilterChange and onPageChange see the written state", () => {
    const seen: unknown[] = [];
    const state = mount({
      defaultPageSize: 3,
      defaultPage: 2,
      onFilterChange: () => seen.push(state().filterState.length),
      onPageChange: () => seen.push(state().page),
    });
    act(() => state().actions.setFilters([{ columnId: "n", operator: "equals", value: "4" }]));
    expect(seen).toEqual([1, 1]);
  });

  it("a throwing onPageSizeChange keeps the page size and still fires onPageChange", () => {
    const onPageChange = vi.fn();
    const state = mount({ defaultPageSize: 2, defaultPage: 3, onPageSizeChange: boom, onPageChange });
    expect(() => act(() => state().actions.setPageSize(4))).toThrow("boom");
    expect(state().pageSize).toBe(4);
    expect(state().page).toBe(2);
    expect(onPageChange.mock.calls).toEqual([[2]]);
  });

  it("controlled page calls onPageChange once with the next page and writes nothing", () => {
    const onPageChange = vi.fn();
    const state = mount({ pageSize: 3, page: 1, onPageChange });
    act(() => state().actions.setPage(2));
    expect(onPageChange.mock.calls).toEqual([[2]]);
    expect(state().page).toBe(1);
  });

  it("a throwing onSearchTextChange keeps the search text", () => {
    const state = mount({ onSearchTextChange: boom });
    expect(() => act(() => state().actions.setSearch("5"))).toThrow("boom");
    expect(state().searchText).toBe("5");
  });

  it("a throwing onColumnLayoutChange keeps the layout", () => {
    const state = mount({ onColumnLayoutChange: boom });
    expect(() => act(() => state().actions.commitColumnWidth("n", 240))).toThrow("boom");
    expect(state().columnWidths["n"]).toBe(240);
  });
});

describe("consumer callbacks of store listeners", () => {
  it("a throwing onSelectionChange logs, and onActiveCellChange still fires", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onActiveCellChange = vi.fn();
    const state = mount({ onSelectionChange: boom, onActiveCellChange });
    act(() => state().actions.selectCellAt({ col: 0, row: 1 }));
    expect(state().activeCell).toEqual({ col: 0, row: 1 });
    expect(onActiveCellChange).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("[data-grid] onSelectionChange threw:", expect.any(Error));
    error.mockRestore();
  });

  it("a throwing onDataChange keeps the commit's onEditEnd", () => {
    const onEditEnd = vi.fn();
    const state = mount({ onDataChange: boom, onEditEnd });
    act(() => state().actions.startEditingAt({ col: 0, row: 0 }));
    expect(() => act(() => state().actions.commitCellEdit("7"))).toThrow("boom");
    expect(onEditEnd).toHaveBeenCalledWith(expect.objectContaining({ rowId: "r0", result: "commit" }));
  });
});
