import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

afterEach(() => vi.restoreAllMocks());

it("warns once for a numeric id passed to deleteRows, even when the number is out of range", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  render(
    <DataGridProvider columns={columns} defaultData={[{ id: "a", name: "A" }]} getRowId={(row: Row) => row.id}>
      <Probe />
    </DataGridProvider>,
  );
  (api!.getState().actions.deleteRows as (ids: unknown[]) => void)([99]);
  (api!.getState().actions.deleteRows as (ids: unknown[]) => void)([98]);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toContain("deleteRowsAt");
});
