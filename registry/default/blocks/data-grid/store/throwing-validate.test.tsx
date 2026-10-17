import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridActions, useDataGridStoreApi } from "../store";

type Row = { id: string; name: string; note: string };

function throwOn(bad: string) {
  return (value: unknown) => {
    if (value === bad) throw new Error("validator crashed");
    return null;
  };
}

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", validate: throwOn("boom") },
  { id: "note", header: "Note", accessorKey: "note", validate: throwOn("boom"), onInvalid: "warn" },
];

function makeWrapper(onDataChange: (next: readonly Row[], change: DataChange<Row>) => void) {
  const data: Row[] = [
    { id: "1", name: "Charlie", note: "ok" },
    { id: "2", name: "Alice", note: "ok" },
  ];
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        {children}
      </DataGridProvider>
    );
  };
}

function renderGrid() {
  const onDataChange = vi.fn();
  const { result } = renderHook(() => ({ actions: useDataGridActions(), store: useDataGridStoreApi() }), {
    wrapper: makeWrapper(onDataChange),
  });
  return { onDataChange, actions: result.current.actions, state: () => result.current.store.getState() };
}

describe("a function-form validate that throws", () => {
  it("rejects the edit with the thrown message and keeps the editor open", () => {
    const grid = renderGrid();
    act(() => grid.actions.startEditingAt({ row: 0, col: 0 }));

    act(() => grid.actions.commitCellEdit("boom"));

    expect(grid.onDataChange).not.toHaveBeenCalled();
    expect(grid.state().editing).not.toBeNull();
    expect(grid.state().editingError).toBe("validator crashed");
  });

  it("blocks the edit on an onInvalid: 'warn' column too", () => {
    const grid = renderGrid();
    act(() => grid.actions.startEditingAt({ row: 0, col: 1 }));

    act(() => grid.actions.commitCellEdit("boom"));

    expect(grid.onDataChange).not.toHaveBeenCalled();
    expect(grid.state().editing).not.toBeNull();
    expect(grid.state().editingError).toBe("validator crashed");
    expect(grid.state().cellErrors.size).toBe(0);
  });

  it("skips the throwing patch as invalid in updateCells and applies the rest", () => {
    const grid = renderGrid();

    let verdict!: ReturnType<typeof grid.actions.updateCells>;
    act(() => {
      verdict = grid.actions.updateCells([
        { rowId: "1", columnId: "name", value: "boom" },
        { rowId: "2", columnId: "name", value: "Bob" },
      ]);
    });

    expect(verdict).toEqual({ applied: 1, skipped: [{ patchIndex: 0, reason: "invalid" }], pending: false });
    expect((grid.state().data as Row[]).map((r) => r.name)).toEqual(["Charlie", "Bob"]);
  });
});
