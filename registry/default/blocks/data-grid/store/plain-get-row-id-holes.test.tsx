import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const plainGetRowId = (row: Row) => row.id;

function sparse(): Row[] {
  const data = new Array<Row | undefined>(5);
  data[0] = { id: "a", name: "A" };
  return data as Row[];
}

describe("a plain getRowId over unloaded rows", () => {
  it("never receives a hole", () => {
    let api: StoreApi<DataGridStoreState> | null = null;
    function Probe() {
      api = useDataGridStoreApi();
      return null;
    }
    const tree = (data: Row[]) => (
      <DataGridProvider data={data} columns={columns} getRowId={plainGetRowId} totalRowCount={5}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(tree(sparse()));
    expect(() => act(() => api!.getState().actions.updateCells([{ rowId: "a", columnId: "name", value: "B" }], { source: "stream" } as never))).not.toThrow();
    expect(() => act(() => view.rerender(tree(sparse())))).not.toThrow();
    expect(api!.getState().getRowId(undefined, 3)).toMatch(/3$/);
  });
});
