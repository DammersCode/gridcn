import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import {
  DataGridProvider,
  useDataGridActiveCell,
  useDataGridActions,
  useDataGridEditing,
  useDataGridSelection,
  useDataGridViewIndex,
  type DataGridProviderProps,
} from "../store";

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

describe("insertRows", () => {
  const indexedCreateRow = (index: number): Row => ({ id: `new-${index}`, name: "New", age: 0 });

  it("is a no-op with a dev warning when createRow is absent", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRows(0, 3));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("createRow"));
    warn.mockRestore();
  });

  it("is a silent no-op for a non-positive count", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange, { createRow: indexedCreateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRows(0, 0));
    act(() => result.current.insertRows(0, -2));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects a non-integer count with a dev warning (a fractional row would corrupt selection math)", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange, { createRow: indexedCreateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRows(0, 1.5));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("integer"));
    warn.mockRestore();
  });

  it("inserts count rows below the target as ONE row-op DataChange with one op per row", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { createRow: indexedCreateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRows(1, 3));

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["1", "2", "new-2", "new-3", "new-4", "3"]);
    expect(change.source).toBe("row-op");
    expect(change.ops).toEqual([
      { type: "insert", rowId: "new-2", row: { id: "new-2", name: "New", age: 0 }, index: 2 },
      { type: "insert", rowId: "new-3", row: { id: "new-3", name: "New", age: 0 }, index: 3 },
      { type: "insert", rowId: "new-4", row: { id: "new-4", name: "New", age: 0 }, index: 4 },
    ]);
  });

  it("inserts above the target view row when position is 'above'", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { createRow: indexedCreateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRows(1, 2, "above"));

    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["1", "new-1", "new-2", "2", "3"]);
    expect(change.ops).toEqual([
      { type: "insert", rowId: "new-1", row: { id: "new-1", name: "New", age: 0 }, index: 1 },
      { type: "insert", rowId: "new-2", row: { id: "new-2", name: "New", age: 0 }, index: 2 },
    ]);
  });

  it("creates each row at its landing data index (createRow sees dataRowIndex + i)", () => {
    const created: number[] = [];
    const wrapper = makeWrapper(
      vi.fn(),
      { createRow: (index: number) => { created.push(index); return { id: `new-${index}`, name: "New", age: 0 }; } },
    );
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRows(1, 3));

    expect(created).toEqual([2, 3, 4]);
  });

  it("round-trips through the history apply/invert path (undo removes exactly the batch)", async () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { createRow: indexedCreateRow });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.insertRows(1, 3));
    const [, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];

    // simulate the history add-on's undo: apply the inverted change back to the pre-batch data.
    const { applyChange, invertChange } = await import("../interaction/history");
    const undone = applyChange(rows(), invertChange(change), (r: Row) => r.id);
    expect(undone.map((r) => r.id)).toEqual(["1", "2", "3"]);
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

describe("reorderRows", () => {
  it("moves a row down (final-position semantics) as one id-keyed move op", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    // view [1 Charlie, 2 Alice, 3 Bob]: Charlie (view 0) lands at final view index 2.
    act(() => result.current.reorderRows(0, 2));

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["2", "3", "1"]);
    expect(change.source).toBe("row-op");
    expect(change.ops).toEqual([{ type: "move", rowId: "1", row: rows()[0], from: 0, to: 2 }]);
  });

  it("moves a row up", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.reorderRows(2, 0));

    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["3", "1", "2"]);
    expect(change.ops).toEqual([{ type: "move", rowId: "3", row: rows()[2], from: 2, to: 0 }]);
  });

  it("one slot down is a real move, not a no-op", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.reorderRows(0, 1));

    const [next] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("keeps viewIndex the identity permutation (no resort)", () => {
    const wrapper = makeWrapper(vi.fn());
    const { result } = renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper,
    });

    act(() => result.current.actions.reorderRows(0, 2));

    expect(result.current.viewIndex).toEqual([0, 1, 2]);
  });

  it("is a no-op when from === to", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.reorderRows(1, 1));

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("is a silent no-op for out-of-range indices", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.reorderRows(0, 3));
    act(() => result.current.reorderRows(-1, 1));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is a no-op when enableRowReorder is false", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange, { enableRowReorder: false });
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.reorderRows(0, 2));

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("is a no-op while readOnly", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current._registerReadOnly(true));
    act(() => result.current.reorderRows(0, 2));

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("is a no-op while an edit session is open (the editor pins a view coordinate)", () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.startEditing({ col: 0, row: 0 }));
    act(() => result.current.reorderRows(0, 2));

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("is a no-op with a dev warning while a sort is active", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.reorderRows(0, 2));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sort or filter"));
    warn.mockRestore();
  });

  it("is a no-op with a dev warning while a filter is active", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.setFilters([{ columnId: "name", operator: "contains", value: "li" }]));
    act(() => result.current.reorderRows(0, 2));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sort or filter"));
    warn.mockRestore();
  });

  it("is a no-op with a dev warning while rows are still unloaded (lazy holes)", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // same sparse convention useDataGridLazyRows ships: undefined holes in a dense-length array
    const sparse = [rows()[0], undefined, rows()[2]] as Row[];
    const wrapper = function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={sparse} columns={columns} getRowId={(r) => (r ? r.id : "hole")} onDataChange={onDataChange}>
          {children}
        </DataGridProvider>
      );
    };
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.reorderRows(0, 2));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unloaded"));
    warn.mockRestore();
  });

  it("remaps the row-selection channel by row identity", () => {
    const wrapper = makeWrapper(vi.fn());
    const { result } = renderHook(() => ({ actions: useDataGridActions(), selection: useDataGridSelection() }), {
      wrapper,
    });

    // select Charlie (view 0) and Alice (view 1) in the row channel
    act(() => result.current.actions.setRowSelected(0, true));
    act(() => result.current.actions.setRowSelected(1, true));

    // move Charlie to final view 2: [Alice, Bob, Charlie] — Charlie→2, Alice→0
    act(() => result.current.actions.reorderRows(0, 2));

    expect([...result.current.selection.rows.toArray()].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  it("remaps the active cell by row identity", () => {
    const wrapper = makeWrapper(vi.fn());
    const { result } = renderHook(() => ({ actions: useDataGridActions(), activeCell: useDataGridActiveCell() }), {
      wrapper,
    });

    act(() => result.current.actions.selectCell({ col: 0, row: 0 })); // Charlie at view 0
    act(() => result.current.actions.reorderRows(0, 2)); // Charlie lands at view 2

    expect(result.current.activeCell).toEqual({ col: 0, row: 2 });
  });

  it("remaps a cell range that does not contain the moved row", () => {
    const wrapper = makeWrapper(vi.fn());
    const { result } = renderHook(() => ({ actions: useDataGridActions(), selection: useDataGridSelection() }), {
      wrapper,
    });

    // range over rows 1..2 (Alice, Bob), cols 0..1
    act(() => result.current.actions.selectCell({ col: 0, row: 1 }));
    act(() => result.current.actions.extendTo({ col: 1, row: 2 }));

    // move Charlie (row 0) to final view 2: rows 1,2 shift to 0,1
    act(() => result.current.actions.reorderRows(0, 2));

    expect(result.current.selection.current?.cell).toEqual({ col: 0, row: 0 });
    expect(result.current.selection.current?.range).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it("round-trips through the history apply/invert path (undo restores the original order)", async () => {
    const onDataChange = vi.fn();
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => useDataGridActions(), { wrapper });

    act(() => result.current.reorderRows(0, 2));
    const [, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];

    const { applyChange, invertChange } = await import("../interaction/history");
    const undone = applyChange(rows(), invertChange(change), (r: Row) => r.id);
    expect(undone.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("row ops rebuild the view index", () => {
  const indexedCreateRow = (index: number): Row => ({ id: `new-${index}`, name: "New", age: 0 });

  it("insertRows updates viewIndex immediately when unsorted (row count changes in place)", () => {
    const wrapper = makeWrapper(vi.fn(), { createRow: indexedCreateRow });
    const { result } = renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper,
    });

    act(() => result.current.actions.insertRows(1, 3));

    expect(result.current.viewIndex).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("deleteRows updates viewIndex immediately when unsorted", () => {
    const wrapper = makeWrapper(vi.fn());
    const { result } = renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper,
    });

    act(() => result.current.actions.deleteRows([0, 2]));

    expect(result.current.viewIndex).toEqual([0]);
  });

  it("duplicateRows updates viewIndex immediately when unsorted", () => {
    const wrapper = makeWrapper(vi.fn(), { duplicateRow });
    const { result } = renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper,
    });

    act(() => result.current.actions.duplicateRows([0, 2]));

    expect(result.current.viewIndex).toEqual([0, 1, 2, 3, 4]);
  });

  it("insertRows under an active sort keeps the active cell on the same row object (follows by identity)", () => {
    const wrapper = makeWrapper(vi.fn(), { createRow: indexedCreateRow });
    const { result } = renderHook(
      () => ({ actions: useDataGridActions(), activeCell: useDataGridActiveCell(), viewIndex: useDataGridViewIndex() }),
      { wrapper },
    );

    // name ascending: view is Alice(1), Bob(2), Charlie(0); active cell on Bob at view row 1.
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.actions.selectCell({ col: 0, row: 1 }));
    expect(result.current.viewIndex).toEqual([1, 2, 0]);

    // insert above view row 0 (Alice): the new row lands at data index 1, ahead of Bob in the data array.
    act(() => result.current.actions.insertRows(0, 1, "above"));

    // Bob's data object hasn't moved; the active cell must still point at Bob's view row, wherever it lands.
    const newDataOrder = ["1", "new-1", "2", "3"]; // Charlie, New, Alice, Bob
    // Alice(2), Bob(3), Charlie(0), New(1) -> Bob is view row 1
    expect(result.current.viewIndex).toEqual([2, 3, 0, 1]);
    expect(newDataOrder[result.current.viewIndex[result.current.activeCell!.row]!]).toBe("3");
  });

  it("a row inserted under an active sort lands in its sorted position in the rebuilt view", () => {
    const wrapper = makeWrapper(vi.fn(), { createRow: indexedCreateRow });
    const { result } = renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper,
    });

    // name ascending: view is Alice(1), Bob(2), Charlie(0); inserting above view row 0 lands the
    // new row ("New") at data index 1.
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.actions.insertRows(0, 1, "above"));

    // Alice(2), Bob(3), Charlie(0), New(1)
    expect(result.current.viewIndex).toEqual([2, 3, 0, 1]);
  });

  it("a deleted row is gone from the rebuilt view under an active sort", () => {
    const wrapper = makeWrapper(vi.fn());
    const { result } = renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper,
    });

    // name ascending: view row 0 is Alice (data index 1); deleting it leaves Bob(1), Charlie(0).
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.actions.deleteRows([0]));

    expect(result.current.viewIndex).toEqual([1, 0]);
  });

  it("a duplicated row's copy lands in the rebuilt sorted view under an active sort", () => {
    const wrapper = makeWrapper(vi.fn(), { duplicateRow });
    const { result } = renderHook(() => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }), {
      wrapper,
    });

    // name ascending: duplicating view row 0 (Alice, data 1) inserts the copy at data index 2.
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    act(() => result.current.actions.duplicateRows([0]));

    // Alice(1), Alice-copy(2), Bob(3), Charlie(0)
    expect(result.current.viewIndex).toEqual([1, 2, 3, 0]);
  });

  it("controlled echo: feeding the emitted array back unchanged keeps the rebuilt view", () => {
    const onDataChange = vi.fn();
    const dataRef = { current: rows() };
    // mirrors a controlled consumer that stores the onDataChange payload and re-renders with it
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider
          data={dataRef.current}
          columns={columns}
          getRowId={(r) => r.id}
          createRow={indexedCreateRow}
          duplicateRow={(row) => ({ ...row, id: `${row.id}-copy` })}
          onDataChange={(next) => {
            dataRef.current = next as Row[];
            onDataChange(next);
          }}
        >
          {children}
        </DataGridProvider>
      );
    }
    const { result, rerender } = renderHook(
      () => ({ actions: useDataGridActions(), viewIndex: useDataGridViewIndex() }),
      { wrapper: Wrapper },
    );

    act(() => result.current.actions.insertRows(1, 2));
    // the action rebuilds the view before any consumer round-trip...
    expect(result.current.viewIndex).toEqual([0, 1, 2, 3, 4]);
    // ...and the echo re-sync (same array identity back through the prop) keeps it
    rerender();
    expect(result.current.viewIndex).toEqual([0, 1, 2, 3, 4]);
    act(() => result.current.actions.deleteRows([4]));
    expect(result.current.viewIndex).toEqual([0, 1, 2, 3]);
    rerender();
    expect(result.current.viewIndex).toEqual([0, 1, 2, 3]);
  });
});

describe("row ops with an open edit session", () => {
  const editSession = { coord: { col: 0, row: 0 }, initialText: undefined };

  it("insertRows is a no-op with a dev warning (editor state untouched)", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange, { createRow });
    const { result } = renderHook(() => ({ actions: useDataGridActions(), editing: useDataGridEditing() }), {
      wrapper,
    });

    act(() => result.current.actions.startEditing({ col: 0, row: 0 }));
    act(() => result.current.actions.insertRows(0, 1));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("edit session"));
    expect(result.current.editing).toEqual(editSession);
    warn.mockRestore();
  });

  it("deleteRows is a no-op with a dev warning (editor state untouched)", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange);
    const { result } = renderHook(() => ({ actions: useDataGridActions(), editing: useDataGridEditing() }), {
      wrapper,
    });

    act(() => result.current.actions.startEditing({ col: 0, row: 0 }));
    act(() => result.current.actions.deleteRows([0]));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("edit session"));
    expect(result.current.editing).toEqual(editSession);
    warn.mockRestore();
  });

  it("duplicateRows is a no-op with a dev warning (editor state untouched)", () => {
    const onDataChange = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = makeWrapper(onDataChange, { duplicateRow });
    const { result } = renderHook(() => ({ actions: useDataGridActions(), editing: useDataGridEditing() }), {
      wrapper,
    });

    act(() => result.current.actions.startEditing({ col: 0, row: 0 }));
    act(() => result.current.actions.duplicateRows([0]));

    expect(onDataChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("edit session"));
    expect(result.current.editing).toEqual(editSession);
    warn.mockRestore();
  });
});
