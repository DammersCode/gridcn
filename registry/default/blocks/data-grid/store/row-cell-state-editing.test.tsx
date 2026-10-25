import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import { DataGridProvider, useDataGridActions, useDataGridRowCellState } from "../store";

type Row = { id: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: (value) => (typeof value === "number" && value > 5 ? "Too big" : null) },
];

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DataGridProvider
      data={[{ id: "1", qty: 1 }, { id: "2", qty: 2 }, { id: "3", qty: 3 }]}
      columns={columns}
      getRowId={(r) => r.id}
    >
      {children}
    </DataGridProvider>
  );
}

function useHarness() {
  return {
    actions: useDataGridActions(),
    row0: useDataGridRowCellState(0),
    row1: useDataGridRowCellState(1),
  };
}

describe("useDataGridRowCellState editing error", () => {
  it("the editing row carries the error and the rejection count", () => {
    const { result } = renderHook(useHarness, { wrapper: Wrapper });
    act(() => {
      result.current.actions.startEditingAt({ row: 0, col: 0 });
      result.current.actions.commitCellEdit(99);
    });
    expect(result.current.row0.editingError).toBe("Too big");
    expect(result.current.row0.editingRejectionCount).toBe(1);
    act(() => {
      result.current.actions.commitCellEdit(98);
    });
    expect(result.current.row0.editingRejectionCount).toBe(2);
  });

  it("other rows report null and 0 and keep the same object across unrelated updates", () => {
    const { result } = renderHook(useHarness, { wrapper: Wrapper });
    const before = result.current.row1;
    expect(before.editingError).toBeNull();
    expect(before.editingRejectionCount).toBe(0);
    act(() => {
      result.current.actions.startEditingAt({ row: 0, col: 0 });
      result.current.actions.commitCellEdit(99);
    });
    act(() => {
      result.current.actions.commitCellEdit(98);
    });
    act(() => {
      result.current.actions.setSearch("1");
    });
    expect(result.current.row1).toBe(before);
  });

  it("an editing-error change in one row leaves the other row's object untouched, in both directions", () => {
    const { result } = renderHook(useHarness, { wrapper: Wrapper });
    act(() => {
      result.current.actions.startEditingAt({ row: 0, col: 0 });
      result.current.actions.commitCellEdit(99);
    });
    const row0 = result.current.row0;
    const row1 = result.current.row1;
    act(() => {
      result.current.actions.cancelEditing();
      result.current.actions.startEditingAt({ row: 1, col: 0 });
      result.current.actions.commitCellEdit(99);
    });
    expect(result.current.row1.editingError).toBe("Too big");
    expect(result.current.row0).not.toBe(row0);
    expect(result.current.row0.editingError).toBeNull();
    expect(result.current.row1).not.toBe(row1);
    const settledRow0 = result.current.row0;
    act(() => {
      result.current.actions.commitCellEdit(97);
    });
    expect(result.current.row0).toBe(settledRow0);
  });
});
