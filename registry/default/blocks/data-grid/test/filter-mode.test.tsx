import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, FilterNode } from "../types";
import { DataGridProvider } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from "../store";
import { viewFilters } from "../store/compute";

type Row = { id: string; name: string };

const data: Row[] = [
  { id: "1", name: "Charlie" },
  { id: "2", name: "Alice" },
  { id: "3", name: "Bob" },
];
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const getRowId = (row: Row) => row.id;
const alice: FilterNode[] = [{ filterId: "f1", columnId: "name", operator: "equals", value: "Alice" }];

function mount(props: Partial<DataGridSyncProps<Row>>) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Partial<DataGridSyncProps<Row>>) => (
    <DataGridProvider data={data} columns={columns} getRowId={getRowId} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return { state: () => api!.getState(), rerender: (next: Partial<DataGridSyncProps<Row>>) => view.rerender(grid(next)) };
}

afterEach(cleanup);

describe("viewFilters", () => {
  it("returns no filters in server mode and passes the tree through in client mode", () => {
    expect(viewFilters("server", alice)).toEqual([]);
    expect(viewFilters("client", alice)).toBe(alice);
  });
});

describe("filterMode", () => {
  it('"server" tracks the spec and fires onFilterChange without filtering the view', () => {
    const onFilterChange = vi.fn();
    const { state } = mount({ filterMode: "server", onFilterChange });
    act(() => state().actions.setFilters(alice));
    expect(state().filterState).toEqual(alice);
    expect(state().viewIndex).toEqual([0, 1, 2]);
    expect(onFilterChange).toHaveBeenCalledTimes(1);
  });

  it('"server" mounted with a defaultFilterState keeps the identity view', () => {
    const { state } = mount({ filterMode: "server", defaultFilterState: alice });
    expect(state().filterState).toEqual(alice);
    expect(state().viewIndex).toEqual([0, 1, 2]);
  });

  it('"server" with a controlled filterState shows the spec but keeps the fetched rows', () => {
    const { state, rerender } = mount({ filterMode: "server", filterState: [] });
    rerender({ filterMode: "server", filterState: alice });
    expect(state().filterState).toEqual(alice);
    expect(state().viewIndex).toEqual([0, 1, 2]);
  });

  it("switching to server mode drops the filter from the view, switching back restores it", () => {
    const { state, rerender } = mount({ filterState: alice });
    expect(state().viewIndex).toEqual([1]);
    rerender({ filterState: alice, filterMode: "server" });
    expect(state().viewIndex).toEqual([0, 1, 2]);
    rerender({ filterState: alice });
    expect(state().viewIndex).toEqual([1]);
  });

  it('"server" keeps the identity view across sort changes and data writes', () => {
    const { state } = mount({ filterMode: "server", defaultFilterState: alice });
    act(() => state().actions.toggleSort("name", false));
    expect(state().viewIndex).toEqual([1, 2, 0]);
    act(() => state().actions.updateCells([{ rowId: "1", columnId: "name", value: "Zed" }]));
    expect(state().viewIndex).toHaveLength(3);
  });

  it('"server" with sortMode "server" leaves the view untouched by both specs', () => {
    const { state } = mount({ filterMode: "server", sortMode: "server", defaultFilterState: alice });
    act(() => state().actions.toggleSort("name", false));
    expect(state().viewIndex).toEqual([0, 1, 2]);
  });

  it('"client" (default) filters the rows', () => {
    const { state } = mount({});
    act(() => state().actions.setFilters(alice));
    expect(state().viewIndex).toEqual([1]);
  });
});
