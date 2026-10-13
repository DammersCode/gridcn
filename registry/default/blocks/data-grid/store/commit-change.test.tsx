import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef, DataChange } from "../types";
import { DataGridProvider, getInternalActions, useDataGridStoreApi, type DataGridStoreState, type DataGridSyncProps } from ".";

type Row = { id: string; name: string; age: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "age", header: "Age", accessorKey: "age" },
];

const ROWS: readonly Row[] = [
  { id: "a", name: "Alpha", age: 1 },
  { id: "b", name: "Bravo", age: 2 },
  { id: "c", name: "Charlie", age: 3 },
];

const row = (id: string): Row => ROWS.find((r) => r.id === id)!;

// Module-scoped so re-renders pass the same identity: the echo-sync early return requires it.
const getRowId = (r: Row) => r.id;

type Props = Partial<DataGridSyncProps<Row>>;

function mount(props: Props) {
  let api: StoreApi<DataGridStoreState> | null = null;
  function Probe() {
    api = useDataGridStoreApi();
    return null;
  }
  const grid = (next: Props) => (
    <DataGridProvider columns={columns} getRowId={getRowId} {...next}>
      <Probe />
    </DataGridProvider>
  );
  const view = render(grid(props));
  return {
    state: () => api!.getState(),
    derived: () => getInternalActions(api!)._deriveSelection(),
    commit: (change: DataChange<Row>) => act(() => api!.getState().actions.commitChange(change)),
    rerender: (next: Props) => view.rerender(grid(next)),
  };
}

describe("commitChange (uncontrolled)", () => {
  it("applies an update batch in one write and emits onDataChange exactly once with the change as-is", () => {
    const onDataChange = vi.fn();
    const { state, commit } = mount({ defaultData: [...ROWS], onDataChange });
    const change: DataChange<Row> = {
      source: "app",
      label: "batch save",
      ops: [
        { type: "update", rowId: "a", row: { ...row("a"), age: 99 }, prev: row("a"), cells: [{ columnId: "age", value: 99, prev: 1 }] },
        { type: "update", rowId: "c", row: { ...row("c"), name: "Charlotte" }, prev: row("c"), cells: [{ columnId: "name", value: "Charlotte", prev: "Charlie" }] },
      ],
    };
    const before = state().data;
    commit(change);
    const s = state();
    expect(s.data).not.toBe(before);
    expect(s.data[0]).toEqual({ id: "a", name: "Alpha", age: 99 });
    expect(s.data[2]).toEqual({ id: "c", name: "Charlotte", age: 3 });
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledWith(s.data, change);
  });

  it("applies insert and delete ops as one write and one emission", () => {
    const onDataChange = vi.fn();
    const { state, commit } = mount({ defaultData: [...ROWS], onDataChange });
    commit({
      source: "import",
      ops: [
        { type: "delete", rowId: "b", row: row("b"), index: 1 },
        { type: "insert", rowId: "z", row: { id: "z", name: "Zulu", age: 9 }, index: 2 },
      ],
    });
    const s = state();
    expect(s.data.map((r) => (r as Row).id)).toEqual(["a", "c", "z"]);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });

  it("reorders data with a move op and bumps rowIdentityVersion once", () => {
    const { state, commit } = mount({ defaultData: [...ROWS] });
    const before = state().rowIdentityVersion;
    commit({ source: "row-op", ops: [{ type: "move", rowId: "c", row: row("c"), from: 2, to: 0 }] });
    const s = state();
    expect(s.data.map((r) => (r as Row).id)).toEqual(["c", "a", "b"]);
    expect(s.rowIdentityVersion).toBe(before + 1);
  });

  it("is a no-op on a readOnly grid: no write, no emission", () => {
    const onDataChange = vi.fn();
    const { state, commit } = mount({ defaultData: [...ROWS], readOnly: true, onDataChange });
    const before = state().data;
    commit({
      source: "app",
      ops: [{ type: "update", rowId: "a", row: { ...row("a"), age: 9 }, prev: row("a"), cells: [{ columnId: "age", value: 9, prev: 1 }] }],
    });
    expect(state().data).toBe(before);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("skips an empty batch without emitting", () => {
    const onDataChange = vi.fn();
    const { commit } = mount({ defaultData: [...ROWS], onDataChange });
    commit({ source: "app", ops: [] });
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("skips a batch whose ops touch no live row: no write, no emission", () => {
    const onDataChange = vi.fn();
    const { state, commit } = mount({ defaultData: [...ROWS], onDataChange });
    const before = state().data;
    commit({
      source: "history",
      ops: [{ type: "update", rowId: "gone", row: { id: "gone", name: "", age: 0 }, prev: { id: "gone", name: "", age: 0 }, cells: [{ columnId: "name", value: "", prev: "x" }] }],
    });
    expect(state().data).toBe(before);
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("passes a source 'history' change through: applies it and emits it unchanged", () => {
    const onDataChange = vi.fn();
    const { state, commit } = mount({ defaultData: [...ROWS], onDataChange });
    const change: DataChange<Row> = {
      source: "history",
      ops: [{ type: "update", rowId: "b", row: { ...row("b"), name: "Bravo2" }, prev: row("b"), cells: [{ columnId: "name", value: "Bravo2", prev: "Bravo" }] }],
    };
    commit(change);
    expect(state().data[1]).toEqual({ id: "b", name: "Bravo2", age: 2 });
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledWith(expect.anything(), change);
  });

  it("an update-only batch keeps the selection, the cursor, and the rowIdentityVersion", () => {
    const { state, derived, commit } = mount({ defaultData: [...ROWS] });
    act(() => {
      const a = state().actions;
      a.selectCellAt({ row: 0, col: 0 });
      a.extendToAt({ row: 1, col: 1 });
    });
    const before = state();
    const selectionBefore = derived();
    expect(selectionBefore.range).not.toBeNull();
    commit({ source: "app", ops: [{ type: "update", rowId: "a", row: { ...row("a"), age: 10 }, prev: row("a"), cells: [{ columnId: "age", value: 10, prev: 1 }] }] });
    const s = state();
    expect(s.activeCell).toEqual(before.activeCell);
    expect(derived()).toEqual(selectionBefore);
    expect(s.rowIdentityVersion).toBe(before.rowIdentityVersion);
  });

  it("a row-moving batch follows the row channel by identity and drops deleted rows", () => {
    const { state, derived, commit } = mount({ defaultData: [...ROWS] });
    act(() => {
      state().actions.setSelection({ anchor: null, range: null, rangeStack: [], rowIds: ["a", "b"], columnIds: [] });
    });
    expect(derived().rowIds).toEqual(["a", "b"]);
    commit({ source: "row-op", ops: [{ type: "delete", rowId: "b", row: row("b"), index: 1 }] });
    expect(derived().rowIds).toEqual(["a"]);
  });

  it("clears cell errors for written cells and prunes errors of removed rows", () => {
    const { state, commit } = mount({ defaultData: [...ROWS] });
    act(() => {
      state().actions.setCellErrors([
        { rowId: "a", columnId: "name", message: "bad name" },
        { rowId: "b", columnId: "age", message: "bad age" },
      ]);
    });
    expect(state().cellErrors.size).toBe(2);
    commit({
      source: "app",
      ops: [
        { type: "update", rowId: "a", row: { ...row("a"), name: "Fixed" }, prev: row("a"), cells: [{ columnId: "name", value: "Fixed", prev: "Alpha" }] },
        { type: "delete", rowId: "b", row: row("b"), index: 1 },
      ],
    });
    expect(state().cellErrors.size).toBe(0);
  });
});

describe("commitChange (controlled)", () => {
  it("applies the change, feeds the consumer the emitted array, and treats the fed-back prop as an echo", () => {
    const onDataChange = vi.fn<(next: readonly Row[], change: DataChange<Row>) => void>();
    const { state, commit, rerender } = mount({ data: [...ROWS], onDataChange });
    commit({
      source: "app",
      ops: [{ type: "update", rowId: "a", row: { ...row("a"), age: 42 }, prev: row("a"), cells: [{ columnId: "age", value: 42, prev: 1 }] }],
    });
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(state().data[0]).toEqual({ id: "a", name: "Alpha", age: 42 });
    const post = state();
    // Feeding the emitted array back as the `data` prop is the store's own echo: no second set.
    act(() => rerender({ data: onDataChange.mock.calls[0]![0], onDataChange }));
    expect(state()).toBe(post);
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });
});
