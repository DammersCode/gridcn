import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider } from "../data-grid";
import { useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from "../store";

type Row = { id: string; name: string };

const data: Row[] = [
  { id: "1", name: "Charlie" },
  { id: "2", name: "Alice" },
  { id: "3", name: "Bob" },
];
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const getRowId = (row: Row) => row.id;

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

describe("sortMode", () => {
  it('"server" cycles asc/desc/none in the store without reordering data', () => {
    const onSortChange = vi.fn();
    const { state } = mount({ sortMode: "server", onSortChange });
    const toggle = () => act(() => state().actions.toggleSort("name"));

    toggle();
    expect(state().sortState).toEqual([{ columnId: "name", direction: "asc" }]);
    expect(state().viewIndex).toEqual([0, 1, 2]);
    toggle();
    expect(state().sortState).toEqual([{ columnId: "name", direction: "desc" }]);
    toggle();
    expect(state().sortState).toEqual([]);
    expect(onSortChange).toHaveBeenCalledTimes(3);
  });

  it('"server" with a controlled sortState shows the spec but keeps the fetched order', () => {
    const { state, rerender } = mount({ sortMode: "server", sortState: [] });
    rerender({ sortMode: "server", sortState: [{ columnId: "name", direction: "asc" }] });
    expect(state().sortState).toEqual([{ columnId: "name", direction: "asc" }]);
    expect(state().viewIndex).toEqual([0, 1, 2]);
  });

  it('"client" (default) sorts the rows', () => {
    const { state } = mount({});
    act(() => state().actions.toggleSort("name"));
    expect(state().viewIndex).toEqual([1, 2, 0]);
  });
});
