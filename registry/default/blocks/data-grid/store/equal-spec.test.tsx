import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, FilterSpec, SortSpec } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const data: Row[] = [{ id: "a", name: "Charlie" }, { id: "b", name: "Alice" }];
const sorts = (): SortSpec[] => [{ columnId: "name", direction: "asc" }];
const filters = (): FilterSpec[] => [{ columnId: "name", operator: "contains", value: "a" }] as FilterSpec[];

function mount(props: Record<string, unknown>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const tree = (extra: Record<string, unknown>) => (
    <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} data={data} {...extra}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(tree(props));
  return { state: () => api!.getState(), update: (extra: Record<string, unknown>) => view.rerender(tree(extra)) };
}

describe("an equal sort or filter spec", () => {
  it("controlled sortState: an equal new array keeps viewIndex identity", () => {
    const grid = mount({ sortState: sorts() });
    const before = grid.state();
    grid.update({ sortState: sorts() });
    expect(grid.state().viewIndex).toBe(before.viewIndex);
    expect(grid.state().sortState).toBe(before.sortState);
  });

  it("controlled filterState: an equal new array keeps viewIndex identity", () => {
    const grid = mount({ filterState: filters() });
    const before = grid.state();
    grid.update({ filterState: filters() });
    expect(grid.state().viewIndex).toBe(before.viewIndex);
    expect(grid.state().filterState).toBe(before.filterState);
  });

  it("controlled sortState under sortMode server: an equal new array fires no onSortChange and keeps the state", () => {
    const onSortChange = vi.fn();
    const grid = mount({ sortState: sorts(), sortMode: "server", onSortChange });
    const before = grid.state().sortState;
    grid.update({ sortState: sorts(), sortMode: "server", onSortChange });
    expect(grid.state().sortState).toBe(before);
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("setSorts with the current spec skips the callback and keeps viewIndex identity", () => {
    const onSortChange = vi.fn();
    const grid = mount({ defaultSortState: sorts(), onSortChange });
    const before = grid.state().viewIndex;
    act(() => grid.state().actions.setSorts(sorts()));
    expect(onSortChange).not.toHaveBeenCalled();
    expect(grid.state().viewIndex).toBe(before);
  });

  it("setSorts under sortMode server skips the callback for the current spec", () => {
    const onSortChange = vi.fn();
    const grid = mount({ defaultSortState: sorts(), sortMode: "server", onSortChange });
    act(() => grid.state().actions.setSorts(sorts()));
    expect(onSortChange).not.toHaveBeenCalled();
    act(() => grid.state().actions.setSorts([]));
    expect(onSortChange).toHaveBeenCalledTimes(1);
  });

  it("setFilters with the current tree skips the callback and keeps viewIndex identity", () => {
    const onFilterChange = vi.fn();
    const grid = mount({ defaultFilterState: filters(), onFilterChange });
    const before = grid.state().viewIndex;
    act(() => grid.state().actions.setFilters(grid.state().filterState));
    act(() => grid.state().actions.setFilters(filters()));
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(grid.state().viewIndex).toBe(before);
  });
});
