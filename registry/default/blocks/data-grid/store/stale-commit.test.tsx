import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, useDataGridActions, useDataGridStoreApi } from "../store";

type Row = { id: string; name: string; note: string };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "note", header: "Note", accessorKey: "note" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "Charlie", note: "n1" },
    { id: "2", name: "Alice", note: "n2" },
  ];
}

function makeWrapper(onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id} onDataChange={onDataChange}>
        {children}
      </DataGridProvider>
    );
  };
}

function useHarness() {
  const actions = useDataGridActions();
  const store = useDataGridStoreApi();
  return { actions, store };
}

/**
 * A commit that resolves LATE (an async Standard Schema) runs `commitCellEdit` after the user has
 * clicked another cell: `editing` still points at the old coord while `activeCell`/`selection`
 * follow the click. The store-level shape of that race is: startEditing, selectCell (the click),
 * then commitCellEdit — the store cannot know the delay, only the stale state.
 */
describe("commitCellEdit with a stale edit session (user moved away mid-validation)", () => {
  it("still commits the value to the edited cell, but keeps the user's newer selection", () => {
    const onDataChange = vi.fn();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper(onDataChange) });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 0 });
      result.current.actions.selectCell({ row: 1, col: 0 }); // the click-away while validation is pending
      result.current.actions.commitCellEdit("New Charlie", { dx: 0, dy: 0 }); // the late resolution
    });

    // the value landed in the cell the user actually edited
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![0][0]).toEqual(expect.objectContaining({ name: "New Charlie" }));
    // the cursor stays where the user clicked — no jump back to the edited cell
    const state = result.current.store.getState();
    expect(state.activeCell).toEqual({ row: 1, col: 0 });
    expect(state.selection.current?.cell).toEqual({ col: 0, row: 1 });
    expect(state.editing).toBeNull();
  });

  it("a non-stale commit (user never moved) still moves the active cell by the movement", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 0 });
      result.current.actions.commitCellEdit("New Charlie", { dx: 0, dy: 1 });
    });

    const state = result.current.store.getState();
    expect(state.activeCell).toEqual({ row: 1, col: 0 });
    expect(state.selection.current?.cell).toEqual({ col: 0, row: 1 });
  });

  it("a stale NOOP commit (same value) closes the session without dragging the cursor back", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.startEditing({ row: 0, col: 0 });
      result.current.actions.selectCell({ row: 1, col: 1 });
      result.current.actions.commitCellEdit("Charlie", { dx: 0, dy: 1 }); // same value: noop
    });

    const state = result.current.store.getState();
    expect(state.editing).toBeNull();
    expect(state.activeCell).toEqual({ row: 1, col: 1 });
  });
});
