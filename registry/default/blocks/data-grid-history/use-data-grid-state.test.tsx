import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { DataGrid, type ColumnDef, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi, type DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { useDataGridState, type UseDataGridStateOptions } from "./use-data-grid-state";

type Row = { id: string; name: string };

const defaultRows: Row[] = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
];

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

function editChange(rowId: string, next: Row, prev: Row): DataChange<Row> {
  return {
    source: "edit",
    ops: [{ type: "update", rowId, row: next, prev, cells: [{ columnId: "name", value: next.name, prev: prev.name }] }],
  };
}

/**
 * Mounts the hook's spreadable result onto a real `DataGrid`, so the history plugin's observer
 * (records the grid's writes) and `Mount` (stashes the api handle for the imperative triggers)
 * both run for real. `commit` drives a change through the grid's public `commitChange` action.
 */
function setup(defaultRowsArg: readonly Row[] = defaultRows, opts: UseDataGridStateOptions<Row> = { getRowId: (r) => r.id }) {
  let currentOpts = opts;
  let grid: ReturnType<typeof useDataGridState<Row>> | null = null;
  let store: StoreApi<DataGridStoreState> | null = null;

  function Capture() {
    store = useDataGridStoreApi();
    return null;
  }

  function Harness() {
    const g = useDataGridState(defaultRowsArg, currentOpts);
    grid = g;
    return (
      <DataGrid {...g} columns={columns}>
        <Capture />
      </DataGrid>
    );
  }

  const view = render(<Harness />);
  return {
    grid: () => grid!,
    data: () => grid!.data,
    /** Drives a change through the grid's public `commitChange` action (one write, one emit, observer records). */
    commit: (change: DataChange<Row>) => act(() => store!.getState().actions.commitChange(change)),
    setOpts: (next: UseDataGridStateOptions<Row>) => {
      currentOpts = next;
      act(() => view.rerender(<Harness />));
    },
  };
}

afterEach(cleanup);

describe("useDataGridState", () => {
  it("returns a spreadable object wiring data + history for DataGrid", () => {
    const { result } = renderHook(() => useDataGridState(defaultRows, { getRowId: (r) => r.id }));
    expect(result.current.data).toEqual(defaultRows);
    expect(typeof result.current.getRowId).toBe("function");
    expect(typeof result.current.onDataChange).toBe("function");
    expect(result.current.plugins).toHaveLength(1);
    expect(result.current.plugins[0]!.name).toBe("history");
    expect(result.current.history.canUndo).toBe(false);
  });

  it("works without options: getRowId stays unset so the grid default applies, and rollback is exposed", () => {
    const { result } = renderHook(() => useDataGridState(defaultRows));
    expect(result.current.getRowId).toBeUndefined();
    expect(typeof result.current.history.rollback).toBe("function");
  });

  it("onDataChange updates data and history.undo/redo round-trip through the grid", () => {
    const h = setup();
    const prev = defaultRows[0]!;
    const next = { ...prev, name: "Alicia" };

    h.commit(editChange("a", next, prev));
    // the controlled echo: the grid's write flowed back into the hook's data through onDataChange
    expect(h.data()[0]!.name).toBe("Alicia");
    expect(h.grid().history.canUndo).toBe(true);

    act(() => h.grid().history.undo());
    expect(h.data()[0]!.name).toBe("Alice");
    expect(h.grid().history.canRedo).toBe(true);

    act(() => h.grid().history.redo());
    expect(h.data()[0]!.name).toBe("Alicia");
  });

  it("exposes history.clear to empty both stacks", () => {
    const h = setup();
    const prev = defaultRows[0]!;
    const next = { ...prev, name: "Alicia" };
    h.commit(editChange("a", next, prev));
    expect(h.grid().history.canUndo).toBe(true);

    act(() => h.grid().history.clear());
    expect(h.grid().history.canUndo).toBe(false);
    expect(h.grid().history.canRedo).toBe(false);
  });

  // Guards against reintroducing a render-phase reset keyed on defaultRows' identity: a caller that
  // doesn't memoize its rows array (e.g. `useDataGridState(makeRows(5), ...)`, a very natural
  // "quick start" usage of this exact hook) passes a fresh array every render — reacting to that
  // identity change with setState would infinite-loop ("Too many re-renders"). defaultRows is only
  // ever the SEED for the first render; callers who want a fresh dataset should remount (e.g. a
  // `key` on the owning component), not rely on this hook noticing a new array on its own.
  it("ignores a new defaultRows identity on every render (does not reset data, does not loop)", () => {
    let renderCount = 0;
    const { result, rerender } = renderHook(() => {
      renderCount++;
      // a fresh array every render, on purpose — the anti-pattern this test guards against.
      return useDataGridState([...defaultRows], { getRowId: (r) => r.id });
    });
    const dataAfterMount = result.current.data;
    rerender();
    rerender();
    expect(renderCount).toBe(3);
    expect(result.current.data).toBe(dataAfterMount);
  });

  it("history.record applies a programmatic change to the hook-owned data as one undo step", () => {
    const h = setup();
    const prev = defaultRows[0]!;
    const next = { ...prev, name: "Zoe" };

    act(() =>
      h.grid().history.record({
        source: "app",
        ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Zoe", prev: "Alice" }] }],
      }),
    );
    expect(h.data()[0]!.name).toBe("Zoe");
    expect(h.grid().history.canUndo).toBe(true);
    expect(h.grid().history.historySize).toBe(1); // one entry, not two

    act(() => h.grid().history.undo());
    expect(h.data()[0]!.name).toBe("Alice");

    act(() => h.grid().history.redo());
    expect(h.data()[0]!.name).toBe("Zoe");
  });

  // An unstable getRowId defeats useDataGridRowIdToViewRow's memoization (O(n) Map rebuild on
  // every render). getRowId must keep the same identity across re-renders as long as the
  // consumer's own getRowId does (here held stable across renders by a top-level function or a
  // useCallback-wrapped one).
  it("returns a stable getRowId identity across re-renders", () => {
    const stableGetRowId = (r: Row) => r.id;
    const { result, rerender } = renderHook(() => useDataGridState(defaultRows, { getRowId: stableGetRowId }));
    const first = result.current.getRowId;
    rerender();
    rerender();
    expect(result.current.getRowId).toBe(first);
  });

  it("history.historySize tracks the undo stack", () => {
    const h = setup();
    expect(h.grid().history.historySize).toBe(0);

    const prev = defaultRows[0]!;
    const next = { ...prev, name: "Alicia" };
    h.commit(editChange("a", next, prev));
    expect(h.grid().history.historySize).toBe(1);

    act(() => h.grid().history.undo());
    expect(h.grid().history.historySize).toBe(0);

    act(() => h.grid().history.clear());
    expect(h.grid().history.historySize).toBe(0);
  });

  it("clears the stack when datasetKey changes between renders", () => {
    const getRowId = (r: Row) => r.id;
    const h = setup(defaultRows, { getRowId, datasetKey: "A" });
    const prev = defaultRows[0]!;
    const next = { ...prev, name: "Alicia" };
    h.commit(editChange("a", next, prev));
    expect(h.grid().history.canUndo).toBe(true);
    expect(h.grid().history.historySize).toBe(1);

    h.setOpts({ getRowId, datasetKey: "B" });
    expect(h.grid().history.canUndo).toBe(false);
    expect(h.grid().history.historySize).toBe(0);
  });
});
