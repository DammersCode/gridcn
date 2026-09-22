import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridCellErrors,
  useDataGridStoreApi,
  type DataGridProviderProps,
} from "../store";

type Row = { id: string; name: string; note: string };

/** `name` blocks (default), `note` warns (commits + flags) — one rule shape, both effects. */
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", validate: (v) => (typeof v === "string" && v.length > 7 ? "Too long" : null) },
  { id: "note", header: "Note", accessorKey: "note", validate: (v) => (typeof v === "string" && v.length > 5 ? "Too long" : null), onInvalid: "warn" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", note: "ok" },
    { id: "2", name: "Alice", note: "ok" },
  ];
}

function makeWrapper(
  onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void,
  overrides: Partial<DataGridProviderProps<Row>> = {},
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id} onDataChange={onDataChange} {...overrides}>
        {children}
      </DataGridProvider>
    );
  };
}

function useHarness() {
  const actions = useDataGridActions();
  const cellErrors = useDataGridCellErrors();
  const store = useDataGridStoreApi();
  return { actions, cellErrors, store };
}

describe("onInvalid: 'warn' — commit + flag instead of block", () => {
  it("a warn rejection commits the raw value, flags the cell in cellErrors, and closes the editor", () => {
    const onDataChange = vi.fn();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper(onDataChange) });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 1 });
      result.current.actions.commitCellEdit("way too long");
    });

    // the invalid value committed (unlike a blocking rejection)
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![0][0]).toEqual(expect.objectContaining({ note: "way too long" }));
    // flagged with the rejection message, editor closed, no transient rejection
    expect(result.current.cellErrors.get("1:note")).toBe("Too long");
    expect(result.current.store.getState().editing).toBeNull();
    expect(result.current.store.getState().editingError).toBeNull();
  });

  it("a blocking column (onInvalid omitted) is unchanged: rejected, data untouched, editor stays open", () => {
    const onDataChange = vi.fn();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper(onDataChange) });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 0 });
      result.current.actions.commitCellEdit("x".repeat(10));
    });

    expect(onDataChange).not.toHaveBeenCalled();
    expect(result.current.store.getState().data[0]).toEqual(expect.objectContaining({ name: "Charlie" }));
    expect(result.current.store.getState().editing).not.toBeNull();
    expect(result.current.cellErrors.size).toBe(0);
  });

  it("a warn rejection via commitCellValue (direct write) commits and flags without an edit session", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.commitCellValue({ row: 1, col: 1 }, "also too long");
    });

    expect(result.current.store.getState().data[1]).toEqual(expect.objectContaining({ note: "also too long" }));
    expect(result.current.cellErrors.get("2:note")).toBe("Too long");
  });

  it("a next valid commit of the flagged cell clears the flag (auto-clear)", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 1 });
      result.current.actions.commitCellEdit("way too long");
    });
    expect(result.current.cellErrors.get("1:note")).toBe("Too long");

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 1 });
      result.current.actions.commitCellEdit("fine");
    });
    expect(result.current.cellErrors.size).toBe(0);
    expect(result.current.store.getState().data[0]).toEqual(expect.objectContaining({ note: "fine" }));
  });

  it("re-committing the SAME invalid value (noop) still lands the flag", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 1 });
      result.current.actions.commitCellEdit("way too long");
    });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 1 });
      result.current.actions.commitCellEdit("way too long"); // same value: no data change, deliberate keep
    });

    expect(result.current.cellErrors.get("1:note")).toBe("Too long");
  });

  it("a warn rejection does not touch a server error on a DIFFERENT cell of the same row", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.setCellErrors([{ rowId: "1", columnId: "name", message: "Server rejected" }]);
    });
    act(() => {
      result.current.actions.startEditing({ row: 0, col: 1 });
      result.current.actions.commitCellEdit("way too long");
    });

    expect(result.current.cellErrors.get("1:note")).toBe("Too long");
    expect(result.current.cellErrors.get("1:name")).toBe("Server rejected");
  });
});
