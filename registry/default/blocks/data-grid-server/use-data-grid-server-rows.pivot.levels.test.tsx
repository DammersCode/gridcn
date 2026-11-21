import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupIdOf, type ExpandedState, type GroupKey, type ServerAggregate, type ServerGroupLayout } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import { fakeServer, type Answer, type Row } from "./group-fake-server.test-helper";
import { MAX_PIVOT_CELLS } from "./group-lists";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

const COUNT: ServerAggregate = { columnId: "qty", reducer: "count" };
const TWO = { groupBy: ["region", "city"], aggregates: [COUNT], pivot: { columnIds: ["qty"] } };
const THREE = { ...TWO, groupBy: ["region", "city", "id"] };
const ROWS = (): Row[] => [
  { id: "a1", region: "EU", city: "Paris", qty: 0 },
  { id: "a2", region: "EU", city: "Paris", qty: 1 },
  { id: "a3", region: "EU", city: "Rome", qty: 1 },
  { id: "a4", region: "US", city: "NYC", qty: 2 },
  { id: "a5", region: "US", city: "NYC", qty: 2 },
  { id: "a6", region: "US", city: "LA", qty: 0 },
];
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const BY = ["region", "city", "id"];
const idOf = (...keys: GroupKey[]) => groupIdOf(keys.map((key, level) => ({ columnId: BY[level]!, key })));

type Hook = { current: { gridProps: { groupLayout?: ServerGroupLayout; onExpandedChange?: (next: ExpandedState) => void; onRenderedRowsChange?: (range: RowRange) => void } } };
const layoutOf = (result: Hook) => result.current.gridProps.groupLayout!;
const keysOf = (result: Hook) => layoutOf(result).rows.map((slot) => slot.path.map((segment) => segment.key).join("/"));
const cellsOf = (result: Hook, key: string) => Array.from(layoutOf(result).rows.find((slot) => slot.path.map((segment) => segment.key).join("/") === key)!.pivotCells!);
const noRowsRequest = (calls: readonly ServerRowsRequest<never>[]) => expect(calls.every((call) => call.childKind === "groups" && call.spec.pivot !== undefined)).toBe(true);

function mount(server: { fetchRows: unknown }, extra: Record<string, unknown> = {}, wrapper?: typeof strict) {
  return renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, overscan: 0, loadDelayMs: 0, defaultSpec: TWO, ...extra }), { wrapper });
}

function open(result: Hook, ids: string[], end = 20) {
  act(() => result.current.gridProps.onExpandedChange!({ mode: "collapsed", ids }));
  act(() => result.current.gridProps.onRenderedRowsChange!({ start: 0, end }));
}

afterEach(() => vi.restoreAllMocks());

describe("a nested server pivot", () => {
  it("sends spec.pivot with 2 levels, opens a pivot row above the innermost level, and lands the child cells in the held set", async () => {
    const server = fakeServer(ROWS());
    const { result } = mount(server);
    await waitFor(() => expect(layoutOf(result)?.pivot).toBeDefined());
    expect(server.calls[0]).toMatchObject({ groupPath: [], childKind: "groups", spec: { groupBy: ["region", "city"], pivot: { columnIds: ["qty"] } } });
    const held = layoutOf(result).pivot!;
    expect(held.columns.map((column) => column.path[0])).toEqual([0, 1, 2]);
    expect(layoutOf(result).rows.map((slot) => slot.childCount)).toEqual([2, 2]);
    expect(cellsOf(result, "EU")).toEqual([1, 2, NaN]);
    open(result, [idOf("EU")]);
    await waitFor(() => expect(keysOf(result)).toEqual(["EU", "EU/Paris", "EU/Rome", "US"]));
    expect(server.calls.at(-1)).toMatchObject({ groupPath: [{ columnId: "region", key: "EU" }], childKind: "groups", start: 0, end: 2, spec: { pivot: { columnIds: ["qty"] } } });
    expect(cellsOf(result, "EU/Paris")).toEqual([1, 1, NaN]);
    expect(cellsOf(result, "EU/Rome")).toEqual([NaN, 1, NaN]);
    expect(layoutOf(result).rows.map((slot) => slot.childCount)).toEqual([2, 0, 0, 2]);
    expect(layoutOf(result).pivot).toBe(held);
    noRowsRequest(server.calls);
  });

  it("opens 3 levels, keeps the innermost rows closed, and never asks for their rows", async () => {
    const server = fakeServer(ROWS());
    const { result } = mount(server, { defaultSpec: THREE });
    await waitFor(() => expect(layoutOf(result)?.pivot).toBeDefined());
    open(result, [idOf("EU"), idOf("EU", "Paris"), idOf("EU", "Paris", "a1")]);
    await waitFor(() => expect(keysOf(result)).toEqual(["EU", "EU/Paris", "EU/Paris/a1", "EU/Paris/a2", "EU/Rome", "US"]));
    expect(layoutOf(result).rows.map((slot) => slot.childCount)).toEqual([2, 2, 0, 0, 1, 2]);
    expect(cellsOf(result, "EU/Paris/a1")).toEqual([1, NaN, NaN]);
    expect(cellsOf(result, "EU/Paris/a2")).toEqual([NaN, 1, NaN]);
    await act(settle);
    expect(server.calls).toHaveLength(3);
    noRowsRequest(server.calls);
  });

  it("closes a row without a request, and keeps expanded mode \"expanded\" collapsed", async () => {
    const server = fakeServer(ROWS());
    const { result } = mount(server);
    await waitFor(() => expect(layoutOf(result)?.pivot).toBeDefined());
    open(result, [idOf("EU")]);
    await waitFor(() => expect(keysOf(result)).toHaveLength(4));
    const calls = server.calls.length;
    open(result, []);
    expect(keysOf(result)).toEqual(["EU", "US"]);
    open(result, [idOf("EU")]);
    expect(keysOf(result)).toHaveLength(4);
    act(() => result.current.gridProps.onExpandedChange!({ mode: "expanded", ids: [] }));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await act(settle);
    expect(keysOf(result)).toEqual(["EU", "US"]);
    expect(server.calls).toHaveLength(calls);
  });

  it("refreshes every open list, and only a top-level answer sets the held set", async () => {
    const rows = ROWS();
    const server = fakeServer(rows);
    const { result } = mount(server);
    await waitFor(() => expect(layoutOf(result)?.pivot).toBeDefined());
    open(result, [idOf("EU")]);
    await waitFor(() => expect(keysOf(result)).toHaveLength(4));
    const held = layoutOf(result).pivot!;
    const original = server.fetchRows.getMockImplementation()!;
    const pending = new Map<string, () => void>();
    server.fetchRows.mockImplementation((request) => new Promise<Answer>((resolve) => pending.set(JSON.stringify(request.groupPath), () => resolve(original(request)))));
    rows.push({ id: "a7", region: "US", city: "LA", qty: 3 });
    act(() => result.current.refresh());
    await waitFor(() => expect(pending.size).toBe(2));
    act(() => pending.get(JSON.stringify([{ columnId: "region", key: "EU" }]))!());
    await act(settle);
    expect(layoutOf(result).pivot).toBe(held);
    expect(cellsOf(result, "EU/Paris")).toEqual([1, 1, NaN]);
    server.fetchRows.mockImplementation(original);
    act(() => pending.get("[]")!());
    await waitFor(() => expect(layoutOf(result).pivot!.columns).toHaveLength(4));
    await waitFor(() => expect(keysOf(result)).toHaveLength(4));
    expect(cellsOf(result, "EU/Paris")).toEqual([1, 1, NaN, NaN]);
    expect(cellsOf(result, "US")).toEqual([1, NaN, 2, 1]);
    noRowsRequest(server.calls);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a sort change", { sorts: [{ columnId: "city", direction: "desc" }] }],
    ["a filter change", { filters: [{ columnId: "city", operator: "equals", value: "Paris" }] }],
  ])("reloads the open lists with the spec after %s", async (_, change) => {
    const server = fakeServer(ROWS());
    const base = { ...TWO, sorts: [], filters: [], searchText: "" };
    const { result, rerender } = renderHook(({ spec }) => useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, overscan: 0, loadDelayMs: 0, spec, onSpecChange: () => {}, defaultExpanded: { mode: "collapsed", ids: [idOf("EU")] } }), { initialProps: { spec: base } });
    await waitFor(() => expect(layoutOf(result)?.pivot).toBeDefined());
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(keysOf(result)).toHaveLength(4));
    const calls = server.calls.length;
    rerender({ spec: { ...base, ...change } });
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(server.calls.slice(calls).some((call) => call.groupPath?.length === 1)).toBe(true));
    expect(server.calls.slice(calls).every((call) => call.spec.sorts.length + call.spec.filters.length === 1)).toBe(true);
    noRowsRequest(server.calls);
  });

  it("runs under StrictMode and aborts a child request on unmount", async () => {
    const server = fakeServer(ROWS());
    const { result, unmount } = mount(server, {}, strict);
    await waitFor(() => expect(layoutOf(result)?.pivot).toBeDefined());
    open(result, [idOf("EU")]);
    await waitFor(() => expect(cellsOf(result, "EU/Rome")).toEqual([NaN, 1, NaN]));
    let held: ServerRowsRequest<never> | undefined;
    let late: (answer: Answer) => void = () => {};
    server.fetchRows.mockImplementationOnce((request) => ((held = request), new Promise<Answer>((resolve) => (late = resolve))));
    open(result, [idOf("EU"), idOf("US")]);
    await waitFor(() => expect(held?.groupPath).toEqual([{ columnId: "region", key: "US" }]));
    unmount();
    expect(held!.signal.aborted).toBe(true);
    const calls = server.calls.length;
    late({ groups: [], groupCount: 0, pivotColumns: [] });
    await settle();
    expect(server.calls).toHaveLength(calls);
    noRowsRequest(server.calls);
  });

  it("opens a pivot row in pages mode and pages its child list", async () => {
    const server = fakeServer(ROWS());
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows: server.fetchRows as never, defaultPageSize: 1, pageSizeOptions: [1], defaultSpec: TWO }));
    await waitFor(() => expect(keysOf(result)).toEqual(["EU"]));
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(keysOf(result)).toEqual(["US"]));
    open(result, [idOf("US")]);
    await waitFor(() => expect(keysOf(result)).toEqual(["US", "US/LA", "US/NYC"]));
    const child = server.calls.filter((call) => call.groupPath?.length === 1).sort((a, b) => a.start - b.start);
    expect(child).toMatchObject([
      { groupPath: [{ columnId: "region", key: "US" }], page: 1, pageSize: 1, start: 0, end: 1 },
      { groupPath: [{ columnId: "region", key: "US" }], page: 2, pageSize: 1, start: 1, end: 2 },
    ]);
    expect(cellsOf(result, "US/LA")).toEqual([1, NaN, NaN]);
    noRowsRequest(server.calls);
  });

  it("fails a child block with a wrong cell count, reads a NaN cell as empty, and ignores keys and groups outside the request", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onError = vi.fn();
    const child = (key: string, cells: unknown[]) => ({ key, childCount: 1, totalRowCount: 1, pivotCells: cells as (number | null)[] });
    const answers: Record<string, Answer> = {
      EU: { groups: [child("Paris", [1, NaN, 9]), child("Rome", [2, 3, 9]), child("Oslo", [4, 4, 4])], groupCount: 2, pivotColumns: [0, 1, "Z"].map((key) => ({ path: [key], valueIndex: 0 })), pivotOmitted: 7 },
      US: { groups: [child("LA", [1])], groupCount: 2, pivotColumns: [0, 1].map((key) => ({ path: [key], valueIndex: 0 })) },
    };
    const server = fakeServer(ROWS(), (request) => answers[String(request.groupPath?.[0]?.key)]);
    const { result } = mount(server, { onError });
    await waitFor(() => expect(layoutOf(result)?.pivot).toBeDefined());
    const held = layoutOf(result).pivot!;
    open(result, [idOf("EU"), idOf("US")]);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    await waitFor(() => expect(keysOf(result)).toEqual(["EU", "EU/Paris", "EU/Rome", "US"]));
    expect(cellsOf(result, "EU/Paris")).toEqual([1, NaN, NaN]);
    expect(cellsOf(result, "EU/Rome")).toEqual([2, 3, NaN]);
    expect(layoutOf(result).pivot).toBe(held);
    expect(String(onError.mock.calls[0]![0])).toContain("pivotCells");
    expect(layoutOf(result).rows.at(-1)!.status).toBe("failed");
    expect(warn.mock.calls.some(([message]) => String(message).includes("finite number"))).toBe(true);
  });

  it("sends spec.pivot with 4 levels without a warning, and none with 5 levels with one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const four = fakeServer(ROWS());
    mount(four, { defaultSpec: { ...TWO, groupBy: ["region", "city", "id", "x"] } });
    await waitFor(() => expect(four.calls).toHaveLength(1));
    expect(four.calls[0]!.spec.pivot).toEqual({ columnIds: ["qty"] });
    const five = fakeServer(ROWS());
    mount(five, { defaultSpec: { ...TWO, groupBy: ["region", "city", "id", "x", "y"] } });
    await waitFor(() => expect(five.calls).toHaveLength(1));
    expect("pivot" in five.calls[0]!.spec).toBe(false);
    await act(settle);
    const pivotWarnings = warn.mock.calls.filter(([message]) => String(message).includes("spec.pivot"));
    expect(pivotWarnings).toHaveLength(1);
    expect(String(pivotWarnings[0]![0])).toContain("4");
  });

  it("evicts the oldest child blocks so the held cells stay within the cap, and keeps the blocks above the rendered rows", async () => {
    const COLUMNS = 200;
    const BLOCK = 200;
    const TOP = 2 * BLOCK;
    const pivotColumns = Array.from({ length: COLUMNS }, (_, key) => ({ path: [`k${key}`], valueIndex: 0 }));
    const cells = Array.from({ length: COLUMNS }, (_, key) => key);
    const fetchRows = vi.fn(async (request: ServerRowsRequest<never>): Promise<Answer> => {
      const top = request.groupPath?.length === 0;
      const prefix = top ? "g" : `${String(request.groupPath![0]!.key)}-c`;
      return { groups: Array.from({ length: request.end - request.start }, (_, i) => ({ key: `${prefix}${request.start + i}`, childCount: top ? BLOCK : 1, totalRowCount: 1, pivotCells: cells })), groupCount: top ? TOP : BLOCK, totalRowCount: TOP, pivotColumns };
    });
    // Open groups of the second top block, so each child list renders while its header block is out of the rendered rows.
    const lists = Math.ceil(MAX_PIVOT_CELLS / (COLUMNS * BLOCK)) + 2;
    const ids = Array.from({ length: lists }, (_, i) => idOf(`g${BLOCK + i}`));
    const { result } = mount({ fetchRows }, { blockSize: BLOCK, defaultExpanded: { mode: "collapsed", ids } });
    await waitFor(() => expect(layoutOf(result)?.rows).toHaveLength(BLOCK));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: BLOCK, end: BLOCK + 1 }));
    await waitFor(() => expect(layoutOf(result).rows).toHaveLength(2 * BLOCK));
    for (let i = 0; i < lists; i++) {
      const header = BLOCK + i * (BLOCK + 1);
      act(() => result.current.gridProps.onRenderedRowsChange({ start: header + 5, end: header + 10 }));
      await waitFor(() => expect(layoutOf(result).rows.some((slot) => slot.viewRow === header + 5 && slot.path.length === 2)).toBe(true));
    }
    const slots = layoutOf(result).rows;
    const bytes = slots.reduce((total, slot) => total + slot.pivotCells!.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(MAX_PIVOT_CELLS * 8);
    const last = lists - 1;
    expect(slots.some((slot) => slot.path[0]!.key === `g${BLOCK + last}` && slot.path.length === 1)).toBe(true);
    expect(slots.some((slot) => slot.path[0]!.key === `g${BLOCK}` && slot.path.length === 2)).toBe(false);
    expect(fetchRows.mock.calls.every(([request]) => request.childKind === "groups")).toBe(true);
  });
});
