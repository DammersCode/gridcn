import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridHistory } from "./use-data-grid-history";

type Row = { id: string; name: string; age: number };

const getRowId = (row: Row) => row.id;

const initialRows: Row[] = [
  { id: "a", name: "Alice", age: 30 },
  { id: "b", name: "Bob", age: 25 },
  { id: "c", name: "Cara", age: 40 },
];

/** Wraps `useDataGridHistory` with its own `useState`-backed data, like a real consumer. */
function setupHarness(capacity?: number) {
  let data: readonly Row[] = initialRows;
  const setData = (next: readonly Row[]) => {
    data = next;
  };
  const rerenderable = renderHook(
    (props: { data: readonly Row[] }) =>
      useDataGridHistory({ data: props.data, setData: setData, getRowId, capacity }),
    { initialProps: { data } },
  );
  return {
    getData: () => data,
    hook: rerenderable,
    // re-renders the hook with the latest `data` snapshot, as a real consumer's re-render would.
    sync: () => rerenderable.rerender({ data }),
  };
}

function editChange(rowId: string, next: Row, prev: Row): DataChange<Row> {
  return {
    source: "edit",
    ops: [{ type: "update", rowId, row: next, prev, cells: [{ columnId: "name", value: next.name, prev: prev.name }] }],
  };
}

describe("useDataGridHistory", () => {
  it("round-trips a single edit through undo/redo", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Alicia" };
    const nextData = [next, initialRows[1]!, initialRows[2]!];

    act(() => h.hook.result.current.onDataChange(nextData, editChange("a", next, prev)));
    h.sync();
    expect(h.getData()[0]!.name).toBe("Alicia");
    expect(h.hook.result.current.canUndo).toBe(true);

    act(() => h.hook.result.current.undo());
    h.sync();
    expect(h.getData()[0]!.name).toBe("Alice");
    expect(h.hook.result.current.canUndo).toBe(false);
    expect(h.hook.result.current.canRedo).toBe(true);

    act(() => h.hook.result.current.redo());
    h.sync();
    expect(h.getData()[0]!.name).toBe("Alicia");
    expect(h.hook.result.current.canRedo).toBe(false);
  });

  it("undoes a multi-row paste-style batch in one step", () => {
    const h = setupHarness();
    const prevA = initialRows[0]!;
    const prevB = initialRows[1]!;
    const nextA = { ...prevA, name: "X1" };
    const nextB = { ...prevB, name: "X2" };
    const nextData = [nextA, nextB, initialRows[2]!];
    const batch: DataChange<Row> = {
      source: "paste",
      ops: [
        { type: "update", rowId: "a", row: nextA, prev: prevA, cells: [{ columnId: "name", value: "X1", prev: "Alice" }] },
        { type: "update", rowId: "b", row: nextB, prev: prevB, cells: [{ columnId: "name", value: "X2", prev: "Bob" }] },
      ],
    };

    act(() => h.hook.result.current.onDataChange(nextData, batch));
    h.sync();
    expect(h.getData().map((r) => r.name)).toEqual(["X1", "X2", "Cara"]);

    act(() => h.hook.result.current.undo());
    h.sync();
    expect(h.getData().map((r) => r.name)).toEqual(["Alice", "Bob", "Cara"]);
  });

  it("survives an intervening sort (id-keyed undo, not index-keyed)", () => {
    let data: readonly Row[] = initialRows;
    const setData = (next: readonly Row[]) => {
      data = next;
    };
    const { result, rerender } = renderHook(
      (props: { data: readonly Row[] }) => useDataGridHistory({ data: props.data, setData: setData, getRowId }),
      { initialProps: { data } },
    );

    const prev = initialRows[0]!; // "a" / Alice, currently at index 0
    const next = { ...prev, name: "Alicia" };
    act(() => result.current.onDataChange([next, initialRows[1]!, initialRows[2]!], editChange("a", next, prev)));
    rerender({ data });

    // a sort reorders the array in place (row "a" moves to the end) without an onDataChange batch.
    data = [data[2]!, data[1]!, data[0]!];
    rerender({ data });
    expect(data.map((r) => r.id)).toEqual(["c", "b", "a"]);

    act(() => result.current.undo());
    rerender({ data });

    const row = data.find((r) => r.id === "a")!;
    expect(row.name).toBe("Alice");
  });

  it("caps the undo stack at the given capacity", () => {
    const h = setupHarness(2);
    const rows = [...initialRows];
    for (let i = 0; i < 3; i++) {
      const prev = rows[0]!;
      const next = { ...prev, age: prev.age + 1 };
      rows[0] = next;
      act(() => h.hook.result.current.onDataChange([...rows], editChange("a", next, prev)));
      h.sync();
    }
    expect(h.getData()[0]!.age).toBe(33);

    // capacity 2: only the last 2 of 3 edits are undoable
    act(() => h.hook.result.current.undo());
    h.sync();
    expect(h.getData()[0]!.age).toBe(32);
    act(() => h.hook.result.current.undo());
    h.sync();
    expect(h.getData()[0]!.age).toBe(31);
    expect(h.hook.result.current.canUndo).toBe(false);
  });

  it("discards the redo branch once a new change is pushed", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next1 = { ...prev, name: "First" };
    act(() => h.hook.result.current.onDataChange([next1, initialRows[1]!, initialRows[2]!], editChange("a", next1, prev)));
    h.sync();
    act(() => h.hook.result.current.undo());
    h.sync();
    expect(h.hook.result.current.canRedo).toBe(true);

    const next2 = { ...prev, name: "Second" };
    act(() => h.hook.result.current.onDataChange([next2, initialRows[1]!, initialRows[2]!], editChange("a", next2, prev)));
    h.sync();

    expect(h.hook.result.current.canRedo).toBe(false);
    act(() => h.hook.result.current.redo()); // no-op: redo branch was discarded
    h.sync();
    expect(h.getData()[0]!.name).toBe("Second");
  });

  it("ignores changes tagged source 'history' so undo/redo never loop back into the stack", () => {
    const setData = vi.fn();
    const { result } = renderHook(() =>
      useDataGridHistory({ data: initialRows, setData, getRowId }),
    );
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Loop" };
    const historyChange: DataChange<Row> = {
      source: "history",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Loop", prev: "Alice" }] }],
    };

    act(() => result.current.onDataChange([next, initialRows[1]!, initialRows[2]!], historyChange));

    expect(setData).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(false);
  });

  it("does not record source 'stream' by default, so a live feed cannot evict the undo stack", () => {
    const setData = vi.fn();
    const { result } = renderHook(() => useDataGridHistory({ data: initialRows, setData, getRowId }));
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Tick" };
    const streamChange: DataChange<Row> = {
      source: "stream",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Tick", prev: "Alice" }] }],
    };

    act(() => result.current.onDataChange([next, initialRows[1]!, initialRows[2]!], streamChange));

    expect(setData).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(false);
  });

  it("records source 'stream' when recordSources opts in", () => {
    const setData = vi.fn();
    const { result } = renderHook(() =>
      useDataGridHistory({
        data: initialRows,
        setData,
        getRowId,
        recordSources: ["edit", "stream"],
      }),
    );
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Tick" };
    const streamChange: DataChange<Row> = {
      source: "stream",
      ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Tick", prev: "Alice" }] }],
    };

    act(() => result.current.onDataChange([next, initialRows[1]!, initialRows[2]!], streamChange));

    expect(result.current.canUndo).toBe(true);
  });

  it("recordSources can also drop a source that is recorded by default", () => {
    const setData = vi.fn();
    const { result } = renderHook(() =>
      useDataGridHistory({ data: initialRows, setData, getRowId, recordSources: ["row-op"] }),
    );
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };

    act(() => result.current.onDataChange([next, initialRows[1]!, initialRows[2]!], editChange("a", next, prev)));

    expect(setData).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(false);
  });

  // B11 regression: getRowId must accept core's 2-arg (row, index) shape, not just (row), so a
  // consumer using an index-derived fallback id compiles and works through this hook too.
  it("round-trips undo with an index-derived getRowId", () => {
    const indexedGetRowId = (row: Row, index: number) => row.id ?? `row-${index}`;
    let data: readonly Row[] = initialRows;
    const setData = (next: readonly Row[]) => {
      data = next;
    };
    const { result, rerender } = renderHook(
      (props: { data: readonly Row[] }) => useDataGridHistory({ data: props.data, setData: setData, getRowId: indexedGetRowId }),
      { initialProps: { data } },
    );

    const prev = initialRows[0]!;
    const next = { ...prev, name: "Alicia" };
    act(() => result.current.onDataChange([next, initialRows[1]!, initialRows[2]!], editChange("a", next, prev)));
    rerender({ data });
    expect(data[0]!.name).toBe("Alicia");

    act(() => result.current.undo());
    rerender({ data });
    expect(data[0]!.name).toBe("Alice");
  });

  it("clear() empties both stacks", () => {
    const h = setupHarness();
    const prev = initialRows[0]!;
    const next = { ...prev, name: "Changed" };
    act(() => h.hook.result.current.onDataChange([next, initialRows[1]!, initialRows[2]!], editChange("a", next, prev)));
    h.sync();
    expect(h.hook.result.current.canUndo).toBe(true);

    act(() => h.hook.result.current.clear());
    expect(h.hook.result.current.canUndo).toBe(false);
    expect(h.hook.result.current.canRedo).toBe(false);
  });
});
