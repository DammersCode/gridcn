import { describe, expect, it, vi } from "vitest";
import type { ColumnDef, DataChange } from "../types";
import { createDataGridStore } from "./create-store";
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
