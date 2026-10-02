import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string; note: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "id", header: "ID", accessorKey: "id", type: "text" },
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "note", header: "Note", accessorKey: "note", type: "text" },
];

const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Name ${i}`, note: `Note ${i}` }));

describe("a foreign data swap with a single-cell range (100k rows)", () => {
  it("compares row ids over the range's rows only", () => {
    const getRowId = vi.fn((row: Row) => row.id);
    const store = createDataGridStore({ data: makeRows(100_000), columns, getRowId } as InternalSyncProps);
    store.getState().actions.selectCellAt({ row: 5, col: 1 });
    const swapped = makeRows(100_000);
    getRowId.mockClear();

    store.getState().actions._syncProps({ data: swapped, columns, getRowId } as InternalSyncProps);

    expect(getRowId.mock.calls.length).toBeLessThan(100);
    expect(store.getState().selection.current).not.toBeNull();
  });
});
