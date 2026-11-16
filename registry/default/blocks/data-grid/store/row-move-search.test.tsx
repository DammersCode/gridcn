import { act, render } from "@testing-library/react";
import { expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: i === 0 ? "needle" : `hay${i}` }));

it("moves the search match with the row it matched", () => {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id} defaultSearchText="needle">
      <Probe />
    </DataGridProvider>,
  );
  expect(api!.getState().searchMatches.map((match) => match.row)).toEqual([0]);

  act(() => api!.getState().actions.reorderRows(0, 3));

  expect(api!.getState().searchMatches.map((match) => match.row)).toEqual([3]);
});
