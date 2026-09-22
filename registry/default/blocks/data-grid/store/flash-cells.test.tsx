import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef } from "../types";
import {
  DataGridProvider,
  useDataGridActions,
  useDataGridRowCellState,
  useDataGridStoreApi,
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

function makeWrapper(overrides: Partial<DataGridProviderProps<Row>> = {}) {
  const data = rows();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id} {...overrides}>{children}</DataGridProvider>;
  };
}

function useHarness() {
  return {
    actions: useDataGridActions(),
    api: useDataGridStoreApi(),
    rowCellState: useDataGridRowCellState(0),
  };
}

describe("flashCells (transient write-pulse)", () => {
  it("adds keys and derives the row's flashingCols from them", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.flashCells(["0:name", "0:age"]);
    });

    const s = result.current.api.getState();
    expect(s.flashingCells.has("0:name")).toBe(true);
    expect(s.flashingCells.has("0:age")).toBe(true);
    expect(result.current.rowCellState.flashingCols?.has(0)).toBe(true);
    expect(result.current.rowCellState.flashingCols?.has(1)).toBe(true);
  });

  it("lifts the keys after the default 1400 ms", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.flashCells(["0:name", "1:age"]);
    });
    expect(result.current.api.getState().flashingCells.size).toBe(2);

    act(() => {
      vi.advanceTimersByTime(1399);
    });
    expect(result.current.api.getState().flashingCells.size).toBe(2);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.api.getState().flashingCells.size).toBe(0);
    vi.useRealTimers();
  });

  it("a re-flash of a live key restarts its full duration", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.flashCells(["0:name"]);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    act(() => {
      result.current.actions.flashCells(["0:name"]);
    });
    // 1 ms past the ORIGINAL deadline: the key would be gone if the first timer survived the re-flash.
    act(() => {
      vi.advanceTimersByTime(201);
    });
    expect(result.current.api.getState().flashingCells.has("0:name")).toBe(true);
    // and the re-flashed key lifts at its OWN deadline (1200 + 1400).
    act(() => {
      vi.advanceTimersByTime(1199);
    });
    expect(result.current.api.getState().flashingCells.has("0:name")).toBe(false);
    vi.useRealTimers();
  });

  it("respects a custom duration", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.flashCells(["0:name"], 500);
    });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.api.getState().flashingCells.has("0:name")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.api.getState().flashingCells.has("0:name")).toBe(false);
    vi.useRealTimers();
  });

  it("an empty key list is a no-op that keeps the shared empty-set identity", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    const before = result.current.api.getState().flashingCells;

    act(() => {
      result.current.actions.flashCells([]);
    });

    expect(result.current.api.getState().flashingCells).toBe(before);
  });

  it("unrelated updates leave the empty-set identity and row state untouched", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    const before = result.current.api.getState().flashingCells;
    const rowBefore = result.current.rowCellState;

    act(() => {
      result.current.actions.selectCell({ col: 0, row: 1 });
    });

    expect(result.current.api.getState().flashingCells).toBe(before);
    expect(rowBefore.flashingCols).toBeNull();
    expect(result.current.rowCellState.flashingCols).toBeNull();
  });

  it("_pruneFlashingCells drops keys whose view row left the kept window, keeps the rest", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.flashCells(["0:name", "2:age", "2:name", "7:age"]);
    });
    act(() => {
      result.current.actions._pruneFlashingCells([0, 1, 2]);
    });

    const s = result.current.api.getState();
    expect(s.flashingCells.has("0:name")).toBe(true);
    expect(s.flashingCells.has("2:age")).toBe(true);
    expect(s.flashingCells.has("2:name")).toBe(true);
    expect(s.flashingCells.has("7:age")).toBe(false);
    expect(s.flashingCells.size).toBe(3);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    unmount();
    vi.useRealTimers();
  });

  it("_pruneFlashingCells is a no-op (same identity) when no flash is active", () => {
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });
    const before = result.current.api.getState().flashingCells;

    act(() => {
      result.current.actions._pruneFlashingCells([0, 1]);
    });

    expect(result.current.api.getState().flashingCells).toBe(before);
  });

  it("a pruned key never re-lands when its timer fires", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useHarness(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.flashCells(["5:name"]);
    });
    act(() => {
      result.current.actions._pruneFlashingCells([0, 1]);
    });
    expect(result.current.api.getState().flashingCells.size).toBe(0);

    // the pending timer still fires later — it must not resurrect the key or churn the set.
    const setBefore = result.current.api.getState().flashingCells;
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(result.current.api.getState().flashingCells).toBe(setBefore);
    vi.useRealTimers();
  });

  it("flashing one row leaves a sibling row's derived state referentially untouched", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(
      () => ({
        actions: useDataGridActions(),
        row0: useDataGridRowCellState(0),
        row1: useDataGridRowCellState(1),
      }),
      { wrapper: makeWrapper() },
    );
    const row1Before = result.current.row1;

    act(() => {
      result.current.actions.flashCells(["0:name"]);
    });

    // row 1's derived object keeps its identity — the flash never reaches it.
    expect(result.current.row1).toBe(row1Before);
    expect(result.current.row0.flashingCols?.has(0)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    unmount();
    vi.useRealTimers();
  });
});
