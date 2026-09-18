import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridActions, type DataGridProviderProps } from "../store";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", age: 30 },
    { id: "2", name: "Alice", age: 25 },
    { id: "3", name: "Bob", age: 40 },
  ];
}

function makeWrapper(
  onDataChange: (next: readonly Row[], change: DataChange<Row>) => void,
  overrides: Partial<DataGridProviderProps<Row>> = {},
  data: Row[] = rows(),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} onDataChange={onDataChange} {...overrides}>
        {children}
      </DataGridProvider>
    );
  };
}

const createRow = (): Row => ({ id: "new", name: "New", age: 0 });
const duplicateRow = (row: Row): Row => ({ ...row, id: `${row.id}-copy` });

describe("insertRow", () => {
  it("is a no-op with a dev warning when createRow is absent", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRow(0, "above"));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("createRow"));
    warn.mockRestore();
  });

  it("inserts above the target view row as one row-op DataChange with a correct insert index", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { createRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRow(1, "above"));

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["1", "new", "2", "3"]);
    expect(change.source).toBe("row-op");
    expect(change.ops).toEqual([{ type: "insert", rowId: "new", row: createRow(), index: 1 }]);
  });

  it("inserts below the target view row", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { createRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRow(1, "below"));

    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["1", "2", "new", "3"]);
    expect(change.ops).toEqual([{ type: "insert", rowId: "new", row: createRow(), index: 2 }]);
  });

  it("inserts at the id-keyed data index, not the view index, when the view is sorted", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { createRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    // sort by name ascending: view order becomes Alice(2), Bob(3), Charlie(1).
    act(() => result.current.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.insertRow(0, "above"));

    const [next] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    // "new" lands before data-index 1 ("2"/Alice) in the underlying data array, not at data index 0.
    expect(next.map((r) => r.id)).toEqual(["1", "new", "2", "3"]);
  });
});

describe("deleteRows", () => {
  it("deletes the given view rows as one row-op DataChange with id-keyed delete ops", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.deleteRows([0, 2]));

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["2"]);
    expect(change.source).toBe("row-op");
    expect(change.ops).toEqual([
      { type: "delete", rowId: "1", row: rows()[0], index: 0 },
      { type: "delete", rowId: "3", row: rows()[2], index: 2 },
    ]);
  });

  it("deletes the correct id-keyed rows under an active sort (view index != data index)", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    // sort by name ascending: view order becomes Alice(2), Bob(3), Charlie(1); view row 0 is data row 1 (Alice).
    act(() => result.current.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.deleteRows([0]));

    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["1", "3"]);
    expect(change.ops).toEqual([{ type: "delete", rowId: "2", row: rows()[1], index: 1 }]);
  });

  it("dedupes repeated view row indexes", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.deleteRows([0, 0]));

    const [, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.ops).toHaveLength(1);
  });

  it("is a no-op with an empty list", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.deleteRows([]));

    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe("duplicateRows", () => {
  it("is a no-op with a dev warning when duplicateRow is absent", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.duplicateRows([0]));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicateRow"));
    warn.mockRestore();
  });

  it("inserts duplicateRow's copy (a distinct id, never the source's) directly after the source row, id-keyed via getRowId, in one row-op DataChange", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { duplicateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.duplicateRows([0]));

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next).toEqual([
      { id: "1", name: "Charlie", age: 30 },
      { id: "1-copy", name: "Charlie", age: 30 },
      { id: "2", name: "Alice", age: 25 },
      { id: "3", name: "Bob", age: 40 },
    ]);
    expect(change.source).toBe("row-op");
    expect(change.ops).toEqual([{ type: "insert", rowId: "1-copy", row: duplicateRow(rows()[0]!), index: 1 }]);
  });

  it("duplicates multiple rows, each copy landing after its own source with a distinct id, ops in ascending source order", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { duplicateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.duplicateRows([0, 2]));

    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["1", "1-copy", "2", "3", "3-copy"]);
    expect(new Set(next.map((r) => r.id)).size).toBe(next.length);
    expect(change.ops.map((op) => op.rowId)).toEqual(["1-copy", "3-copy"]);
  });

  it("duplicates the correct id-keyed row under an active sort", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { duplicateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    // sort by name ascending: view row 0 is data row 1 (Alice, id "2").
    act(() => result.current.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.duplicateRows([0]));

    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["1", "2", "2-copy", "3"]);
    expect(change.ops).toEqual([{ type: "insert", rowId: "2-copy", row: duplicateRow(rows()[1]!), index: 2 }]);
  });

  it("is a no-op with an empty list", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { duplicateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.duplicateRows([]));

    expect(onDataChange).not.toHaveBeenCalled();
  });
});
