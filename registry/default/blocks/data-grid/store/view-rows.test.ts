import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { apiHandleOf } from "./api";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";
import { dataIndexAt, dataIndexOf, forEachDataIndex, rowAtViewRow, rowIdAtViewRow, viewEntryAt } from "./view-rows";

type Row = { id: string; name: string };

const rows: Row[] = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
];
const getRowId = (row: Row) => row.id;
const groupedView = [0, -1, 1, 2];
const state = { viewIndex: groupedView, data: [...rows, undefined] as unknown[], getRowId: getRowId as (row: unknown, index: number) => string };

describe("view-rows readers", () => {
  it("reads a data row, a hole, and an out-of-range row", () => {
    expect(viewEntryAt(state, 0)).toEqual({ kind: "data", dataIndex: 0 });
    expect(viewEntryAt({ ...state, viewIndex: [3] }, 0)).toEqual({ kind: "hole", dataIndex: 3 });
    expect(viewEntryAt(state, 9)).toEqual({ kind: "hole" });
  });

  it("reads an entry below 0 as a group row that holds no data", () => {
    expect(viewEntryAt(state, 1)).toEqual({ kind: "group", groupIndex: 0 });
    expect(viewEntryAt({ ...state, viewIndex: [-3] }, 0)).toEqual({ kind: "group", groupIndex: 2 });
    expect(dataIndexAt(state, 1)).toBeUndefined();
    expect(dataIndexOf(groupedView, 1)).toBeUndefined();
    expect(rowAtViewRow(state, 1)).toBeUndefined();
    expect(rowIdAtViewRow(state, 1)).toBeUndefined();
  });

  it("leaves a reader that indexes data by the raw entry with no row, the shape of a hole", () => {
    const [, groupEntry] = groupedView;
    expect(state.data[groupEntry!]).toBeUndefined();
  });

  it("resolves the rows around a group row", () => {
    expect(dataIndexAt(state, 2)).toBe(1);
    expect(rowAtViewRow(state, 3)).toBe(rows[2]);
    expect(rowIdAtViewRow(state, 2)).toBe("b");
  });

  it("iterates data entries only, with their view rows", () => {
    const seen: [number, number][] = [];
    forEachDataIndex(groupedView, (dataIndex, viewRow) => seen.push([dataIndex, viewRow]));
    expect(seen).toEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
  });
});

describe("a group row on the write paths", () => {
  const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

  function groupedStore() {
    const onDataChange = vi.fn();
    const store = createDataGridStore({ data: rows.map((row) => ({ ...row })), columns, getRowId, onDataChange } as InternalSyncProps);
    store.setState({ viewIndex: groupedView });
    return { store, onDataChange };
  }

  it("skips a cell commit on the group row", () => {
    const { store, onDataChange } = groupedStore();
    store.getState().actions.commitCellValueAt({ col: 0, row: 1 }, "X");
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("commits the row after the group row at its own data index", () => {
    const { store, onDataChange } = groupedStore();
    store.getState().actions.commitCellValueAt({ col: 0, row: 2 }, "X");
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect((onDataChange.mock.calls[0]![0] as Row[]).map((row) => row.name)).toEqual(["A", "X", "C"]);
  });

  it("deletes no row for a group row", () => {
    const { store, onDataChange } = groupedStore();
    store.getState().actions.deleteRowsAt([1]);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("clears no row for a selection that holds only the group row", () => {
    const { store, onDataChange } = groupedStore();
    const { actions } = store.getState();
    actions.selectCellAt({ col: 0, row: 1 });
    actions.deleteSelection();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("lists no row id for the group row and reads no row at it", () => {
    const { store } = groupedStore();
    const api = apiHandleOf<Row>(store);
    expect(api.getViewRowIds()).toEqual(["a", "b", "c"]);
    expect(api.getRow(1)).toBeUndefined();
  });
});
