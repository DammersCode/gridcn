import { describe, expect, it, vi } from "vitest";
import type { ColumnDef, DataChange } from "../types";
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

describe("a range after the visible columns change", () => {
  it("does not clear a different column when a column left of it is hidden", () => {
    const onDataChange = vi.fn<(next: readonly unknown[], change: DataChange<unknown>) => void>();
    const store = createDataGridStore({ data: makeRows(3), columns, getRowId: (row: Row) => row.id, onDataChange } as InternalSyncProps);
    store.getState().actions.selectCellAt({ row: 0, col: 1 });

    store.getState().actions.setColumnHidden("id", true);
    store.getState().actions.deleteSelection();

    const notes = (store.getState().data as readonly Row[]).map((row) => row.note);
    expect(notes).toEqual(["Note 0", "Note 1", "Note 2"]);
  });
});

describe("the active cell after a view rebuild", () => {
  const makeStore = (overrides: Partial<InternalSyncProps> = {}) =>
    createDataGridStore({
      data: makeRows(3),
      columns,
      getRowId: (row: Row) => row.id,
      enableColumnReorder: true,
      enableColumnPinning: true,
      ...overrides,
    } as InternalSyncProps);

  it("clears its own column when a column left of it is hidden before a delete", () => {
    const store = makeStore();
    store.getState().actions.selectCellAt({ row: 0, col: 1 });

    store.getState().actions.setColumnHidden("id", true);
    store.getState().actions.deleteSelection();

    const data = store.getState().data as readonly Row[];
    expect(store.getState().activeCell).toEqual({ row: 0, col: 0 });
    expect(data.map((row) => row.name)).toEqual(["", "Name 1", "Name 2"]);
    expect(data.map((row) => row.note)).toEqual(["Note 0", "Note 1", "Note 2"]);
  });

  it("follows its column across a reorder and a pin", () => {
    const store = makeStore();
    store.getState().actions.selectCellAt({ row: 1, col: 0 });

    store.getState().actions.setColumnOrder("id", "note", "after");
    expect(store.getState().activeCell).toEqual({ row: 1, col: 2 });

    store.getState().actions.setColumnPin("id", "left");
    expect(store.getState().activeCell).toEqual({ row: 1, col: 0 });
    expect(store.getState().selection.current?.cell).toEqual({ row: 1, col: 0 });
  });

  it("follows its record across a sort and a consumer data swap", () => {
    const store = makeStore();
    store.getState().actions.selectCellAt({ row: 0, col: 2 });

    store.getState().actions.setSorts([{ columnId: "id", direction: "desc" }]);
    expect(store.getState().activeCell).toEqual({ row: 2, col: 2 });

    store.getState().actions.setSorts([]);
    store.getState().actions._syncProps({
      data: [{ id: "new", name: "New", note: "New" }, ...makeRows(3)],
      columns,
      getRowId: (row: Row) => row.id,
    } as InternalSyncProps);
    expect(store.getState().activeCell).toEqual({ row: 1, col: 2 });
    expect(store.getState().selection.current?.range).toEqual({ x: 2, y: 1, width: 1, height: 1 });
  });

  it("clamps to its view position when its row leaves the view", () => {
    const store = makeStore();
    store.getState().actions.selectCellAt({ row: 2, col: 1 });

    store.getState().actions.setFilters([{ filterId: "f", columnId: "name", operator: "equals", value: "Name 0" }]);

    expect(store.getState().activeCell).toEqual({ row: 0, col: 1 });
  });
});
