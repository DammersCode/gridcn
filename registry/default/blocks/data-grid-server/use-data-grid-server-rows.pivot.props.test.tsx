import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PivotSpec, ServerAggregate } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

const COUNT: ServerAggregate = { columnId: "qty", reducer: "count" };
const GROUPED = { groupBy: ["region"], aggregates: [COUNT] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
type Grid = { pivot?: PivotSpec; onPivotChange?: (next: PivotSpec) => void; groupLayout?: { pivot?: unknown } };
const gridOf = (result: { current: { gridProps: unknown } }) => result.current.gridProps as Grid;

afterEach(() => vi.restoreAllMocks());

describe.each(["pages", "scroll"] as const)("the pivot props of a grouped server source (%s mode)", (mode) => {
  const mount = (server: { fetchRows: unknown }, extra: Record<string, unknown> = {}) =>
    renderHook(() => useDataGridServerRows<Row>({ ...(mode === "scroll" ? { mode, overscan: 0, loadDelayMs: 0 } : null), fetchRows: server.fetchRows as never, defaultSpec: GROUPED, ...extra } as never));

  it("hands the grid the pivot of the spec, and the off value without one", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    const { result } = mount(server, { defaultSpec: { ...GROUPED, pivot: { columnIds: ["city"] } } });
    await waitFor(() => expect(gridOf(result).groupLayout?.pivot).toBeDefined());
    expect(gridOf(result).pivot).toEqual({ columnIds: ["city"] });
    const off = mount(fakeServer(rowsOf({ A: 1 })));
    expect(gridOf(off.result).pivot).toEqual({ columnIds: [] });
  });

  it("sends spec.pivot after the grid turns the pivot on, and drops it after the grid turns it off", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    const onSpecChange = vi.fn();
    const { result } = mount(server, { onSpecChange });
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    const first = gridOf(result).pivot;
    act(() => gridOf(result).onPivotChange!({ columnIds: ["city"] }));
    await waitFor(() => expect(server.calls.at(-1)!.spec.pivot).toEqual({ columnIds: ["city"] }));
    expect(gridOf(result).pivot).toEqual({ columnIds: ["city"] });
    act(() => gridOf(result).onPivotChange!({ columnIds: [] }));
    await waitFor(() => expect(server.calls.at(-1)!.spec.pivot).toBeUndefined());
    expect(gridOf(result).pivot).toBe(first);
    expect(onSpecChange.mock.calls.at(-1)![0]).not.toHaveProperty("pivot");
  });

  it("keeps the pivot prop's identity across renders with the same pivot column", async () => {
    const server = fakeServer(rowsOf({ A: 2 }));
    const { result, rerender } = mount(server, { defaultSpec: { ...GROUPED, pivot: { columnIds: ["city"] } } });
    const before = gridOf(result).pivot;
    rerender();
    await act(settle);
    expect(gridOf(result).pivot).toBe(before);
  });

  it("seeds the pivot from defaultPivot and reports a change through onPivotChange, with the off value", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    const onPivotChange = vi.fn();
    const { result } = mount(server, { defaultPivot: { columnIds: ["city"] }, onPivotChange });
    await waitFor(() => expect(server.calls[0]?.spec.pivot).toEqual({ columnIds: ["city"] }));
    act(() => gridOf(result).onPivotChange!({ columnIds: [] }));
    expect(onPivotChange).toHaveBeenLastCalledWith({ columnIds: [] });
    await waitFor(() => expect(server.calls.at(-1)!.spec.pivot).toBeUndefined());
  });

  it("keeps the defaultPivot seed when defaultSpec is a function", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    mount(server, { defaultSpec: () => GROUPED, defaultPivot: { columnIds: ["city"] }, defaultExpanded: { mode: "collapsed", ids: [] } });
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    expect(server.calls[0]!.spec.pivot).toEqual({ columnIds: ["city"] });
  });

  it("follows a controlled pivot over spec.pivot, and round-trips a grid change through onPivotChange", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    const { result } = renderHook(() => {
      const [pivot, setPivot] = useState<PivotSpec>({ columnIds: ["city"] });
      return { pivot, ...useDataGridServerRows<Row>({ ...(mode === "scroll" ? { mode, overscan: 0, loadDelayMs: 0 } : null), fetchRows: server.fetchRows as never, defaultSpec: GROUPED, pivot, onPivotChange: setPivot } as never) };
    });
    await waitFor(() => expect(server.calls[0]?.spec.pivot).toEqual({ columnIds: ["city"] }));
    act(() => gridOf(result).onPivotChange!({ columnIds: [] }));
    expect(result.current.pivot).toEqual({ columnIds: [] });
    await waitFor(() => expect(server.calls.at(-1)!.spec.pivot).toBeUndefined());
    expect(gridOf(result).pivot).toEqual({ columnIds: [] });
    act(() => gridOf(result).onPivotChange!({ columnIds: ["city"] }));
    await waitFor(() => expect(server.calls.at(-1)!.spec.pivot).toEqual({ columnIds: ["city"] }));
  });
});
