import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from "../store";
import type { ColumnDef } from "../types";
import { useRowHover } from "./use-row-hover";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const rows: Row[] = [
  { id: "b", name: "b" },
  { id: "a", name: "a" },
];

describe("useRowHover", () => {
  it("does not re-render its host when viewIndex changes", () => {
    let renders = 0;
    let api: StoreApi<DataGridStoreState> | null = null;
    function Host() {
      renders++;
      api = useDataGridStoreApi();
      const ref = useRef<HTMLElement | null>(null);
      useRowHover(ref, 36);
      return null;
    }
    render(
      <DataGridProvider defaultData={rows} columns={columns} getRowId={(row) => row.id}>
        <Host />
      </DataGridProvider>,
    );
    const before = renders;
    act(() => api!.getState().actions.setSorts([{ columnId: "name", direction: "asc" }]));
    expect(api!.getState().viewIndex).toEqual([1, 0]);
    expect(renders).toBe(before);
  });
});
