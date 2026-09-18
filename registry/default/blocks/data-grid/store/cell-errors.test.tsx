import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridCellErrors,
  useDataGridRowCellState,
  useDataGridRowHasError,
  type DataGridProviderProps,
} from "../store";

type Row = { id: string; name: string; age: number; active: boolean };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age", type: "number" },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", age: 30, active: false },
    { id: "2", name: "Alice", age: 25, active: false },
    { id: "3", name: "Bob", age: 40, active: false },
  ];
}

function makeWrapper(
  onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void,
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

function useHarness(viewRow = 0) {
  return {
    actions: useDataGridActions(),
    cellErrors: useDataGridCellErrors(),
    rowCellState: useDataGridRowCellState(viewRow),
  };
}

describe("setCellErrors / clearCellErrors: set/merge/clear semantics", () => {
  it("setCellErrors merges entries in, keyed rowId:columnId", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "Name taken" },
        { rowId: "2", columnId: "age", message: "Too young" },
      ]);
    });

    expect(result.current.cellErrors.get("1:name")).toBe("Name taken");
    expect(result.current.cellErrors.get("2:age")).toBe("Too young");
    expect(result.current.cellErrors.size).toBe(2);
  });

  it("setCellErrors merges per-key: a later call only touches the keys it names, leaving others intact", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "first" }]);
    });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "2", columnId: "age", message: "second" }]);
    });

    expect(result.current.cellErrors.get("1:name")).toBe("first");
    expect(result.current.cellErrors.get("2:age")).toBe("second");
    expect(result.current.cellErrors.size).toBe(2);
  });

  it("setCellErrors overwrites an existing entry for the same key", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "first" }]);
    });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "updated" }]);
    });

    expect(result.current.cellErrors.get("1:name")).toBe("updated");
    expect(result.current.cellErrors.size).toBe(1);
  });

  it("setCellErrors([]) is a no-op (no allocation, same map identity)", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    const before = result.current.cellErrors;

    act(() => {
      result.current.actions.setCellErrors([]);
    });

    expect(result.current.cellErrors).toBe(before);
  });

  it("clearCellErrors(targets) removes only the named entries", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "a" },
        { rowId: "2", columnId: "age", message: "b" },
      ]);
    });
    act(() => {
      result.current.actions.clearCellErrors([{ rowId: "1", columnId: "name" }]);
    });

    expect(result.current.cellErrors.has("1:name")).toBe(false);
    expect(result.current.cellErrors.get("2:age")).toBe("b");
    expect(result.current.cellErrors.size).toBe(1);
  });

  it("clearCellErrors() with no arg clears every entry", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "a" },
        { rowId: "2", columnId: "age", message: "b" },
      ]);
    });
    act(() => {
      result.current.actions.clearCellErrors();
    });

    expect(result.current.cellErrors.size).toBe(0);
  });

  it("clearCellErrors on a target that isn't present is a no-op (same map identity)", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "a" }]);
    });
    const before = result.current.cellErrors;

    act(() => {
      result.current.actions.clearCellErrors([{ rowId: "9", columnId: "name" }]);
    });

    expect(result.current.cellErrors).toBe(before);
  });
});

describe("empty-map identity", () => {
  it("cellErrors starts as the shared empty-map identity, and clearCellErrors() on an already-empty map is a no-op", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    const initial = result.current.cellErrors;
    expect(initial.size).toBe(0);

    act(() => {
      result.current.actions.clearCellErrors();
    });
    expect(result.current.cellErrors).toBe(initial);

    act(() => {
      result.current.actions.clearCellErrors([{ rowId: "1", columnId: "name" }]);
    });
    expect(result.current.cellErrors).toBe(initial);
  });

  it("clearing every entry restores an empty map (size 0), independent of the setCellErrors call site", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "a" }]);
    });
    act(() => {
      result.current.actions.clearCellErrors([{ rowId: "1", columnId: "name" }]);
    });
    expect(result.current.cellErrors.size).toBe(0);
  });
});

describe("setCellErrors/clearCellErrors are NOT data changes", () => {
  it("never fires onDataChange", () => {
    const onDataChange = vi.fn();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper(onDataChange) });

    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "boom" }]);
    });
    act(() => {
      result.current.actions.clearCellErrors();
    });

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("never touches `data`", () => {
    const { result } = renderHook(
      () => ({ actions: useDataGridActions(), cellErrors: useDataGridCellErrors() }),
      { wrapper: makeWrapper() },
    );

    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "boom" }]);
    });

    // No onDataChange fired means no DataChange/history entry was ever produced for this action —
    // the only way a consumer (or data-grid-history's recorder) would see one.
    expect(result.current.cellErrors.get("1:name")).toBe("boom");
  });
});

describe("auto-clear on successful commit", () => {
  it("commitCellEdit clears the edited cell's error", () => {
    const onDataChange = vi.fn();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper(onDataChange) });

    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "Name taken" }]);
    });
    expect(result.current.cellErrors.has("1:name")).toBe(true);

    act(() => {
      result.current.actions.startEditing({ col: 0, row: 0 });
      result.current.actions.commitCellEdit("Charlotte");
    });

    expect(result.current.cellErrors.has("1:name")).toBe(false);
  });

  it("commitCellEdit leaves OTHER cells' errors untouched", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "a" },
        { rowId: "2", columnId: "name", message: "b" },
      ]);
    });

    act(() => {
      result.current.actions.startEditing({ col: 0, row: 0 });
      result.current.actions.commitCellEdit("Charlotte");
    });

    expect(result.current.cellErrors.has("1:name")).toBe(false);
    expect(result.current.cellErrors.get("2:name")).toBe("b");
  });

  it("a no-op commit (value unchanged) does NOT clear the error — nothing was actually written", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "Name taken" }]);
    });

    act(() => {
      result.current.actions.startEditing({ col: 0, row: 0 });
      result.current.actions.commitCellEdit("Charlie"); // same as the existing value
    });

    expect(result.current.cellErrors.get("1:name")).toBe("Name taken");
  });

  it("a rejected commit (validate fails) does NOT clear the error", () => {
    const validatedColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "age", header: "Age", accessorKey: "age", type: "number", validate: (v) => (typeof v === "number" && v < 0 ? "must be >= 0" : null) },
      { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
    ];
    const { result } = renderHook(() => useHarness(), {
      wrapper: makeWrapper(undefined, { columns: validatedColumns }),
    });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "age", message: "Server said no" }]);
    });

    act(() => {
      result.current.actions.startEditing({ col: 1, row: 0 });
      result.current.actions.commitCellEdit(-5);
    });

    expect(result.current.cellErrors.get("1:age")).toBe("Server said no");
  });

  it("commitCellValue (checkbox direct-write path) clears the written cell's error", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "active", message: "Server said no" }]);
    });

    act(() => {
      result.current.actions.commitCellValue({ col: 2, row: 0 }, true);
    });

    expect(result.current.cellErrors.has("1:active")).toBe(false);
  });

  it("deleteSelection clears errors for every cell it writes to (cleared to clearValue)", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "a" },
        { rowId: "1", columnId: "age", message: "b" },
      ]);
    });

    act(() => {
      result.current.actions.selectCell({ col: 0, row: 0 });
      result.current.actions.extendTo({ col: 1, row: 0 });
    });
    act(() => {
      result.current.actions.deleteSelection();
    });

    expect(result.current.cellErrors.size).toBe(0);
  });

  it("applyCellUpdates (paste/fill path) clears errors for every written cell", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "2", columnId: "name", message: "stale" }]);
    });

    act(() => {
      result.current.actions.applyCellUpdates([{ viewRow: 1, columnId: "name", value: "Allison" }], "paste");
    });

    expect(result.current.cellErrors.has("2:name")).toBe(false);
  });

  it("applyCellUpdates leaves an error on a cell the batch did not touch", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "3", columnId: "name", message: "stale" }]);
    });

    act(() => {
      result.current.actions.applyCellUpdates([{ viewRow: 1, columnId: "name", value: "Allison" }], "paste");
    });

    expect(result.current.cellErrors.get("3:name")).toBe("stale");
  });

  it("updateCells (streaming path) clears errors for every patched cell", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "age", message: "stale" }]);
    });

    act(() => {
      result.current.actions.updateCells([{ rowId: "1", columnId: "age", value: 99 }]);
    });

    expect(result.current.cellErrors.has("1:age")).toBe(false);
  });

  it("updateCells with reorder: 'immediate' still clears the touched cell's error", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "age", message: "stale" }]);
    });

    act(() => {
      result.current.actions.updateCells([{ rowId: "1", columnId: "age", value: 99 }], { reorder: "immediate" });
    });

    expect(result.current.cellErrors.has("1:age")).toBe(false);
  });

  it("updateRows (whole-row patch) clears errors for every changed column", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "a" },
        { rowId: "1", columnId: "age", message: "b" },
      ]);
    });

    act(() => {
      result.current.actions.updateRows([{ rowId: "1", changes: { name: "New Name", age: 50 } }]);
    });

    expect(result.current.cellErrors.size).toBe(0);
  });

  it("updateCells does not allocate a new map when cellErrors is already empty (identity preserved)", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    const before = result.current.cellErrors;

    act(() => {
      result.current.actions.updateCells([{ rowId: "1", columnId: "age", value: 99 }]);
    });

    expect(result.current.cellErrors).toBe(before);
  });
});

describe("pruning on row-shape changes", () => {
  it("deleteRows prunes cellErrors entries for the deleted rowIds", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "a" },
        { rowId: "2", columnId: "name", message: "b" },
      ]);
    });

    act(() => {
      result.current.actions.deleteRows([0]); // deletes rowId "1"
    });

    expect(result.current.cellErrors.has("1:name")).toBe(false);
    expect(result.current.cellErrors.get("2:name")).toBe("b");
  });

  it("deleteRows leaves cellErrors untouched (same identity) when nothing needed pruning", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "2", columnId: "name", message: "b" }]);
    });
    const before = result.current.cellErrors;

    act(() => {
      result.current.actions.deleteRows([0]); // deletes rowId "1", unrelated to the error
    });

    expect(result.current.cellErrors).toBe(before);
  });

  it("a controlled data replacement (consumer-driven) prunes vanished rowIds", () => {
    const onDataChange = vi.fn();
    const initialRows = rows();
    // renderHook's `rerender(props)` only re-invokes the hook callback, never the wrapper (RTL only
    // forwards `initialProps` to the FIRST render) — a stateful host component with an imperative
    // "replace data" escape hatch is what actually drives a controlled `data` prop change here.
    let setData: ((rows: Row[]) => void) | null = null;
    let harness: ReturnType<typeof useHarness> | null = null;
    function Host() {
      const [data, setDataState] = useState(initialRows);
      setData = setDataState;
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} onDataChange={onDataChange}>
          <Probe />
        </DataGridProvider>
      );
    }
    function Probe() {
      harness = useHarness();
      return null;
    }
    render(<Host />);

    act(() => {
      harness!.actions.setCellErrors([
        { rowId: "1", columnId: "name", message: "a" },
        { rowId: "2", columnId: "name", message: "b" },
      ]);
    });

    // Consumer replaces `data` with row "1" removed — a genuine (non-echo) replacement.
    act(() => {
      setData!(initialRows.filter((r) => r.id !== "1"));
    });

    expect(harness!.cellErrors.has("1:name")).toBe(false);
    expect(harness!.cellErrors.get("2:name")).toBe("b");
  });

  it("insertRow prunes a cellErrors entry whose rowId is no longer in data", () => {
    const { result } = renderHook(() => useHarness(), {
      wrapper: makeWrapper(undefined, { createRow: (i) => ({ id: `new-${i}`, name: "", age: 0, active: false }) }),
    });
    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "gone", columnId: "name", message: "stale" },
        { rowId: "2", columnId: "name", message: "live" },
      ]);
    });

    act(() => {
      result.current.actions.insertRow(0, "below");
    });

    expect(result.current.cellErrors.has("gone:name")).toBe(false);
    expect(result.current.cellErrors.get("2:name")).toBe("live");
  });

  it("duplicateRows prunes a cellErrors entry whose rowId is no longer in data", () => {
    const { result } = renderHook(() => useHarness(), {
      wrapper: makeWrapper(undefined, { duplicateRow: (row: Row) => ({ ...row, id: `${row.id}-copy` }) }),
    });
    act(() => {
      result.current.actions.setCellErrors([
        { rowId: "gone", columnId: "name", message: "stale" },
        { rowId: "2", columnId: "name", message: "live" },
      ]);
    });

    act(() => {
      result.current.actions.duplicateRows([0]);
    });

    expect(result.current.cellErrors.has("gone:name")).toBe(false);
    expect(result.current.cellErrors.get("2:name")).toBe("live");
  });

  it("insertRow leaves cellErrors identity untouched when nothing needed pruning", () => {
    const { result } = renderHook(() => useHarness(), {
      wrapper: makeWrapper(undefined, { createRow: (i) => ({ id: `new-${i}`, name: "", age: 0, active: false }) }),
    });
    act(() => {
      result.current.actions.setCellErrors([{ rowId: "2", columnId: "name", message: "live" }]);
    });
    const before = result.current.cellErrors;

    act(() => {
      result.current.actions.insertRow(0, "below");
    });

    expect(result.current.cellErrors).toBe(before);
  });

  // #85 task B: composite rowIds (`tenant:order`) and namespaced column ids (`meta:sku`) are both
  // ordinary. Splitting the key on its last colon parsed "t1:o9:meta:sku" as rowId "t1:o9:meta",
  // which is in no live row, so an unrelated deleteRows silently dropped a live row's error.
  describe("colon-bearing rowIds and columnIds", () => {
    type Joined = { tenantId: string; orderId: string; sku: string };
    const joinedColumns: readonly ColumnDef<Joined, unknown>[] = [{ id: "meta:sku", header: "SKU", accessorKey: "sku" }];
    const joinedRows: Joined[] = [
      { tenantId: "t1", orderId: "o9", sku: "a" },
      { tenantId: "t1", orderId: "o8", sku: "b" },
    ];

    function joinedWrapper() {
      return function Wrapper({ children }: { children: ReactNode }) {
        return (
          <DataGridProvider
            data={joinedRows}
            columns={joinedColumns}
            getRowId={(r) => `${r.tenantId}:${r.orderId}`}
            onDataChange={() => {}}
          >
            {children}
          </DataGridProvider>
        );
      };
    }

    it("keeps a live row's error when an unrelated row is deleted", () => {
      const { result } = renderHook(() => useHarness(), { wrapper: joinedWrapper() });
      act(() => {
        result.current.actions.setCellErrors([
          { rowId: "t1:o9", columnId: "meta:sku", message: "rejected" },
          { rowId: "t1:o8", columnId: "meta:sku", message: "also rejected" },
        ]);
      });

      act(() => {
        result.current.actions.deleteRows([1]); // deletes rowId "t1:o8"
      });

      expect(result.current.cellErrors.get("t1:o9:meta:sku")).toBe("rejected");
      expect(result.current.cellErrors.has("t1:o8:meta:sku")).toBe(false);
    });

    it("useDataGridRowHasError does not report a colon-prefix rowId's error as its own", () => {
      const { result } = renderHook(
        () => ({ ...useHarness(), t1HasError: useDataGridRowHasError("t1") }),
        { wrapper: joinedWrapper() },
      );
      act(() => {
        result.current.actions.setCellErrors([{ rowId: "t1:o9", columnId: "meta:sku", message: "rejected" }]);
      });

      expect(result.current.cellErrors.get("t1:o9:meta:sku")).toBe("rejected");
      expect(result.current.t1HasError).toBe(false);
    });

    it("useDataGridRowHasError still reports the colon-bearing row's own error", () => {
      const { result } = renderHook(
        () => ({ ...useHarness(), hasError: useDataGridRowHasError("t1:o9") }),
        { wrapper: joinedWrapper() },
      );
      act(() => {
        result.current.actions.setCellErrors([{ rowId: "t1:o9", columnId: "meta:sku", message: "rejected" }]);
      });

      expect(result.current.hasError).toBe(true);
    });

    it("still prunes a colon-bearing rowId that genuinely vanished", () => {
      const { result } = renderHook(() => useHarness(), { wrapper: joinedWrapper() });
      act(() => {
        result.current.actions.setCellErrors([{ rowId: "t1:o9", columnId: "meta:sku", message: "rejected" }]);
      });

      act(() => {
        result.current.actions.deleteRows([0]); // deletes rowId "t1:o9" itself
      });

      expect(result.current.cellErrors.has("t1:o9:meta:sku")).toBe(false);
    });
  });
});
