import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDataGridState } from "./use-data-grid-state";

type Row = { id: string; name: string };

const defaultRows: Row[] = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
];

describe("useDataGridState", () => {
  it("returns a spreadable object wiring data + history for DataGrid", () => {
    const { result } = renderHook(() => useDataGridState(defaultRows, { getRowId: (r) => r.id }));
    expect(result.current.data).toEqual(defaultRows);
    expect(typeof result.current.onDataChange).toBe("function");
    expect(typeof result.current.onUndo).toBe("function");
    expect(typeof result.current.onRedo).toBe("function");
    expect(result.current.history.canUndo).toBe(false);
  });

  it("onDataChange updates data and onUndo/onRedo round-trip through it", () => {
    const { result, rerender } = renderHook(() => useDataGridState(defaultRows, { getRowId: (r) => r.id }));

    const prev = defaultRows[0]!;
    const next = { ...prev, name: "Alicia" };
    act(() =>
      result.current.onDataChange([next, defaultRows[1]!], {
        source: "edit",
        ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Alicia", prev: "Alice" }] }],
      }),
    );
    rerender();
    expect(result.current.data[0]!.name).toBe("Alicia");
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.onUndo());
    rerender();
    expect(result.current.data[0]!.name).toBe("Alice");

    act(() => result.current.onRedo());
    rerender();
    expect(result.current.data[0]!.name).toBe("Alicia");
  });

  it("exposes history.clear to empty both stacks", () => {
    const { result, rerender } = renderHook(() => useDataGridState(defaultRows, { getRowId: (r) => r.id }));
    const prev = defaultRows[0]!;
    const next = { ...prev, name: "Alicia" };
    act(() =>
      result.current.onDataChange([next, defaultRows[1]!], {
        source: "edit",
        ops: [{ type: "update", rowId: "a", row: next, prev, cells: [{ columnId: "name", value: "Alicia", prev: "Alice" }] }],
      }),
    );
    rerender();
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.history.clear());
    rerender();
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(false);
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

  // B9 regression: an unstable getRowId defeats useDataGridRowIdToViewRow's memoization (O(n) Map
  // rebuild on every render) — see #92. getRowId must keep the same identity across re-renders as
  // long as the consumer's own getRowId does (here held stable across renders, as any memoizing
  // consumer would — e.g. a top-level function or a useCallback-wrapped one).
  it("returns a stable getRowId identity across re-renders", () => {
    const stableGetRowId = (r: Row) => r.id;
    const { result, rerender } = renderHook(() => useDataGridState(defaultRows, { getRowId: stableGetRowId }));
    const first = result.current.getRowId;
    rerender();
    rerender();
    expect(result.current.getRowId).toBe(first);
  });
});
