import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridSelectedRows, useDataGridStoreApi, type DataGridStoreState } from ".";
import { apiHandleOf } from "./api";
import { viewIndex } from "@/registry/default/blocks/data-grid/types";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = ["a", "b", "c"].map((id) => ({ id, name: id }));

describe("api.getSelectedRows", () => {
  it("returns the checked rows the hook returns, the remembered hidden ones included", () => {
    let store: StoreApi<DataGridStoreState> | null = null;
    let fromHook: unknown = null;
    function Probe() {
      store = useDataGridStoreApi();
      fromHook = useDataGridSelectedRows();
      return null;
    }
    render(
      <DataGridProvider columns={columns} getRowId={(row: Row) => row.id} defaultData={rows} checkedRowsLifetime="across-filters">
        <Probe />
      </DataGridProvider>,
    );
    act(() => [0, 1].forEach((r) => store!.getState().actions.setRowCheckedAt(viewIndex(r), true)));
    act(() => store!.getState().actions.setFilters([{ columnId: "name", operator: "equals", value: "a" }]));
    const api = apiHandleOf(store!);
    expect(api.getSelection().rowIds).toEqual(["a"]);
    expect(api.getSelectedRows()).toEqual({ mode: "ids", ids: ["a", "b"], excludedIds: [], count: 2 });
    expect(api.getSelectedRows()).toEqual(fromHook);
  });
});
