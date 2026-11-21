import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
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

  it("runs a function defaultPivot once after mount, and the first request carries its pivot", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    const seed = vi.fn(() => ({ columnIds: ["city"] }));
    mount(server, { defaultPivot: seed });
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    await act(settle);
    expect(server.calls.map((call) => call.spec.pivot)).toEqual(server.calls.map(() => ({ columnIds: ["city"] })));
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it("ignores defaultPivot under a controlled spec", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    mount(server, { spec: { sorts: [], filters: [], searchText: "", ...GROUPED }, onSpecChange: () => {}, defaultPivot: () => ({ columnIds: ["city"] }) });
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    await act(settle);
    expect(server.calls.every((call) => call.spec.pivot === undefined)).toBe(true);
  });

  it.each([
    ["", undefined],
    [" under StrictMode", StrictMode],
  ] as const)("follows a controlled pivot over a different spec.pivot, with one request per change%s", async (_, Wrapper) => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }));
    const { result } = renderHook(
      () => {
        const [pivot, setPivot] = useState<PivotSpec>({ columnIds: ["city"] });
        return { pivot, ...useDataGridServerRows<Row>({ ...(mode === "scroll" ? { mode, overscan: 0, loadDelayMs: 0 } : null), fetchRows: server.fetchRows as never, defaultSpec: { ...GROUPED, pivot: { columnIds: ["id"] } }, pivot, onPivotChange: setPivot } as never) };
      },
      Wrapper ? { wrapper: Wrapper } : undefined,
    );
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(0));
    await act(settle);
    expect(new Set(server.calls.map((call) => JSON.stringify(call.spec.pivot)))).toEqual(new Set([JSON.stringify({ columnIds: ["city"] })]));
    let before = server.calls.length;
    act(() => gridOf(result).onPivotChange!({ columnIds: [] }));
    await act(settle);
    expect(result.current.pivot).toEqual({ columnIds: [] });
    expect(server.calls.slice(before).map((call) => call.spec.pivot)).toEqual([undefined]);
    expect(gridOf(result).pivot).toEqual({ columnIds: [] });
    before = server.calls.length;
    act(() => gridOf(result).onPivotChange!({ columnIds: ["city"] }));
    await act(settle);
    expect(server.calls.slice(before).map((call) => call.spec.pivot)).toEqual([{ columnIds: ["city"] }]);
  });
});
