import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { createDataGridStore } from "./create-store";
import { DataGridProvider, useDataGridStoreApi, type DataGridStoreState } from ".";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string; note: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];

const initialRows: readonly Row[] = [
  { id: "a", name: "Alpha", note: "" },
  { id: "b", name: "Bravo", note: "" },
];

function makeStore(overrides: Partial<InternalSyncProps> = {}) {
  const onDataChange = vi.fn<(next: readonly unknown[], change: DataChange<unknown>) => void>();
  const store = createDataGridStore({
    data: initialRows,
    columns,
    getRowId: (row: Row) => row.id,
    onDataChange,
    ...overrides,
  } as InternalSyncProps);
  return { store, onDataChange };
}

const cellValues = (change: DataChange<unknown>) =>
  change.ops.flatMap((op) => (op.type === "update" ? (op.cells ?? []).map((cell) => cell.value) : []));

describe("a throwing validateRow on a delete", () => {
  it("emits nothing for the failed delete and only the later edit afterwards", () => {
    const { store, onDataChange } = makeStore({
      validateRow: (row) => {
        if ((row as Row).name === "") throw new Error("validateRow crashed");
        return null;
      },
    });
    store.getState().actions.selectCellAt({ row: 0, col: 0 });

    expect(() => store.getState().actions.deleteSelection()).toThrow("validateRow crashed");
    store.getState().actions.commitCellValueAt({ row: 1, col: 1 }, "edited");

    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(cellValues(onDataChange.mock.calls[0]![1])).toEqual(["edited"]);
  });
});

describe("an onDataChange that throws", () => {
  it("still delivers the emit a store subscriber queued, then rethrows the first error", () => {
    const { store, onDataChange } = makeStore();
    let answered = false;
    store.subscribe((state, prev) => {
      if (answered || state.data === prev.data) return;
      answered = true;
      state.actions.updateCells([{ rowId: "b", columnId: "note", value: "answered" }]);
    });
    onDataChange.mockImplementationOnce(() => {
      throw new Error("consumer crashed");
    });

    expect(() => store.getState().actions.commitCellValueAt({ row: 0, col: 0 }, "Changed")).toThrow("consumer crashed");

    expect(onDataChange).toHaveBeenCalledTimes(2);
    expect(cellValues(onDataChange.mock.calls[1]![1])).toEqual(["answered"]);
  });

  it("delivers later writes' emits immediately after a failed one", () => {
    const { store, onDataChange } = makeStore();
    onDataChange.mockImplementationOnce(() => {
      throw new Error("consumer crashed");
    });

    expect(() => store.getState().actions.commitCellValueAt({ row: 0, col: 0 }, "first")).toThrow("consumer crashed");
    store.getState().actions.commitCellValueAt({ row: 1, col: 0 }, "second");

    expect(onDataChange).toHaveBeenCalledTimes(2);
    expect(cellValues(onDataChange.mock.calls[1]![1])).toEqual(["second"]);
  });
});

describe("a write from onSelectionChange", () => {
  it("keeps both the selection-driven commit and the handler's write", () => {
    let api: StoreApi<DataGridStoreState> | null = null;
    const emits: DataChange<unknown>[] = [];
    let answered = false;
    function Probe() {
      api = useDataGridStoreApi();
      return null;
    }
    render(
      <DataGridProvider
        defaultData={initialRows}
        columns={columns}
        getRowId={(row: Row) => row.id}
        onDataChange={(_next, change) => emits.push(change)}
        onSelectionChange={() => {
          if (answered) return;
          answered = true;
          api!.getState().actions.updateCells([{ rowId: "b", columnId: "note", value: "answered" }], { source: "app" });
        }}
      >
        <Probe />
      </DataGridProvider>,
    );

    act(() => api!.getState().actions.applyCellUpdates([{ viewRowIndex: 0, columnId: "name", value: "Changed" }], "paste"));

    const data = api!.getState().data as readonly Row[];
    expect(data.find((row) => row.id === "a")!.name).toBe("Changed");
    expect(data.find((row) => row.id === "b")!.note).toBe("answered");
    expect(emits.map((change) => change.source)).toEqual(["paste", "app"]);
  });
});
