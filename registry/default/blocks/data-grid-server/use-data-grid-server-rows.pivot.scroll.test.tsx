import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupIdOf, type ExpandedState, type ServerAggregate } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { fakeServer, rowsOf, type Answer, type Row } from "./group-fake-server.test-helper";
import { MAX_PIVOT_CELLS } from "./group-lists";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

const SUM: ServerAggregate = { columnId: "qty", reducer: "sum" };
const COUNT: ServerAggregate = { columnId: "qty", reducer: "count" };
const PIVOT_SPEC = { groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } };
const REGIONS = { A: 6, B: 3, C: 2 };
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const idOf = (region: string) => groupIdOf([{ columnId: "region", key: region }]);

function mount(server: { fetchRows: unknown }, extra: Record<string, unknown> = {}, wrapper?: typeof strict) {
  return renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, overscan: 0, loadDelayMs: 0, defaultSpec: PIVOT_SPEC, ...extra }), { wrapper });
}

afterEach(() => vi.restoreAllMocks());

describe("a pivot scroll source", () => {
  it("sends spec.pivot with the aggregates as values on a groups request and maps the cells by generated id", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ start: 0, end: 50, groupPath: [], childKind: "groups", spec: { groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } } });
    const layout = result.current.gridProps.groupLayout!;
    expect(layout.pivot).toEqual({ columnId: "city", values: [SUM], columns: ["A-c0", "A-c1", "B-c0", "B-c1", "C-c0", "C-c1"].map((city) => ({ path: [city], valueIndex: 0 })), omitted: 0 });
    expect(layout.rows.map((slot) => slot.childCount)).toEqual([0, 0, 0]);
    expect(layout.rows.every((slot) => slot.pivotCells instanceof Float64Array)).toBe(true);
    expect(Array.from(layout.rows[0]!.pivotCells!)).toEqual([3, 3, NaN, NaN, NaN, NaN]);
    expect(Array.from(layout.rows[2]!.pivotCells!)).toEqual([NaN, NaN, NaN, NaN, 1, 1]);
    expect(layout.leafCount).toBe(11);
    expect(result.current.totalRowCount).toBe(11);
  });

  it("clamps the block size to 200 and sends only the groupBy and pivot sorts", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const sorts = [{ columnId: "qty", direction: "desc" }, { columnId: "city", direction: "desc" }, { columnId: "region", direction: "asc" }];
    const { result } = mount(server, { blockSize: 500, defaultSpec: { ...PIVOT_SPEC, sorts } });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    expect(server.calls[0]).toMatchObject({ start: 0, end: 200 });
    expect(server.calls[0]!.spec.sorts).toEqual(sorts.slice(1));
    expect(result.current.gridProps.sortState).toEqual(sorts);
    expect(result.current.gridProps.sortMode).toBe("server");
  });

  it("sends the filters with spec.pivot and leaves them to the server (filterMode server)", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const filters = [{ columnId: "region", operator: "equals", value: "A" }];
    const { result } = mount(server, { defaultSpec: { ...PIVOT_SPEC, filters } });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    expect(server.calls[0]!.spec).toMatchObject({ filters, pivot: { columnIds: ["city"] } });
    expect(result.current.gridProps.filterMode).toBe("server");
  });

  it("keeps one held set across landings and an equal refresh, and takes a new one when the ids change", async () => {
    const rows = rowsOf({ A: 4, B: 2 });
    const server = fakeServer(rows);
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    const held = result.current.gridProps.groupLayout!.pivot;
    const calls = server.fetchRows.mock.calls.length;
    act(() => result.current.refresh());
    await waitFor(() => expect(server.fetchRows.mock.calls.length).toBeGreaterThan(calls));
    await act(settle);
    expect(result.current.gridProps.groupLayout!.pivot).toBe(held);
    rows.push({ id: "Z", region: "A", city: "Z-c9", qty: 5 });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.gridProps.groupLayout!.pivot).not.toBe(held));
    const layout = result.current.gridProps.groupLayout!;
    expect(layout.pivot!.columns.map((column) => column.path[0])).toEqual(["A-c0", "A-c1", "B-c0", "B-c1", "Z-c9"]);
    expect(Array.from(layout.rows[0]!.pivotCells!)).toEqual([2, 2, NaN, NaN, 5]);
  });

  it("reads a held id that a later answer lacks as NaN", async () => {
    const server = fakeServer(rowsOf({ A: 2, B: 2 }), (request) =>
      request.start === 0
        ? undefined
        : { groups: [{ key: "Q", childCount: 1, totalRowCount: 1, pivotCells: [7] }], groupCount: 2, totalRowCount: 4, pivotColumns: [{ path: ["A-c0"], valueIndex: 0 }] },
    );
    const { result } = mount(server, { blockSize: 1 });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(1));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 1, end: 2 }));
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(2));
    expect(result.current.gridProps.groupLayout!.pivot!.columns).toHaveLength(4);
    expect(Array.from(result.current.gridProps.groupLayout!.rows[1]!.pivotCells!)).toEqual([7, NaN, NaN, NaN]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['expanded mode "expanded"', { expanded: { mode: "expanded", ids: [] } satisfies ExpandedState }],
    ["restored ids", { defaultExpanded: { mode: "collapsed", ids: [idOf("A"), idOf("B")] } satisfies ExpandedState }],
  ])("never sends a rows request under %s", async (_, extra) => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server, extra);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 3 }));
    await act(settle);
    expect(result.current.gridProps.data).toHaveLength(3);
    expect(server.calls.every((call) => call.childKind === "groups")).toBe(true);
  });

  it("never sends a rows request when a group opens by the API or expand all", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    act(() => result.current.gridProps.onExpandedChange!({ mode: "collapsed", ids: [idOf("A"), idOf("C")] }));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 3 }));
    await act(settle);
    act(() => result.current.gridProps.onExpandedChange!({ mode: "expanded", ids: [] }));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 3 }));
    await act(settle);
    expect(result.current.gridProps.groupLayout!.rows.map((slot) => slot.childCount)).toEqual([0, 0, 0]);
    expect(server.calls.every((call) => call.childKind === "groups")).toBe(true);
  });

  it("sends no pivot with 2 groupBy levels and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server, { defaultSpec: { ...PIVOT_SPEC, groupBy: ["region", "qty"] } });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    expect("pivot" in server.calls[0]!.spec).toBe(false);
    expect(result.current.gridProps.groupLayout!.pivot).toBeUndefined();
    act(() => result.current.refresh());
    await act(settle);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("spec.pivot"))).toHaveLength(1);
  });

  it("sends no pivot on the flat request once groupBy goes, and pivots again when it returns", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    act(() => result.current.gridProps.onGroupByChange!([]));
    await waitFor(() => expect(result.current.gridProps.data).toHaveLength(11));
    expect("pivot" in server.calls.at(-1)!.spec).toBe(false);
    expect(result.current.spec.pivot).toBeUndefined();
    act(() => result.current.gridProps.onGroupByChange!(["region"]));
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    expect(server.calls.at(-1)!.spec.pivot).toEqual({ columnIds: ["city"] });
  });

  it("takes the held set again when the aggregates change", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const base = { ...PIVOT_SPEC, sorts: [], filters: [], searchText: "" };
    const { result, rerender } = renderHook(({ spec }) => useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, loadDelayMs: 0, spec, onSpecChange: () => {} }), { initialProps: { spec: base } });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    const held = result.current.gridProps.groupLayout!.pivot;
    rerender({ spec: { ...base, aggregates: [SUM, COUNT] } });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot?.values).toEqual([SUM, COUNT]));
    expect(result.current.gridProps.groupLayout!.pivot!.columns).toHaveLength(12);
    expect(result.current.gridProps.groupLayout!.pivot).not.toBe(held);
    expect(server.calls.at(-1)).toMatchObject({ start: 0, childKind: "groups" });
  });

  it.each<[string, Record<string, unknown>, string]>([
    ["a sort on the groupBy column", { sorts: [{ columnId: "region", direction: "desc" }] }, "city"],
    ["a typed filter", { filters: [{ columnId: "region", operator: "contains", value: "A" }] }, "city"],
    ["a switch of the pivot column", { pivot: { columnIds: ["id"] } }, "id"],
  ])("shows the held set until the first answer after %s lands", async (_, change, columnId) => {
    const server = fakeServer(rowsOf(REGIONS));
    const base = { ...PIVOT_SPEC, sorts: [], filters: [], searchText: "" };
    const shown: unknown[] = [];
    const { result, rerender } = renderHook(
      ({ spec }) => {
        const rows = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, loadDelayMs: 0, spec, onSpecChange: () => {} });
        shown.push(rows.gridProps.groupLayout?.pivot);
        return rows;
      },
      { initialProps: { spec: base } },
    );
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    const held = result.current.gridProps.groupLayout!.pivot;
    const original = server.fetchRows.getMockImplementation()!;
    const pending: (() => void)[] = [];
    server.fetchRows.mockImplementation((request) => new Promise<Answer>((resolve) => pending.push(() => resolve(original(request)))));
    shown.length = 0;
    rerender({ spec: { ...base, ...change } });
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(settle);
    expect(result.current.gridProps.groupLayout!.rows).toEqual([]);
    expect(shown.every((pivot) => pivot === held)).toBe(true);
    act(() => pending[0]!());
    await waitFor(() => expect(result.current.gridProps.groupLayout!.pivot!.columnId).toBe(columnId));
    expect(shown.every((pivot) => pivot !== undefined)).toBe(true);
  });

  it("drops a late answer after a spec change", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    let late: (answer: Answer) => void = () => {};
    let held: ServerRowsRequest<never> | undefined;
    const original = server.fetchRows.getMockImplementation()!;
    server.fetchRows.mockImplementationOnce((request) => ((held = request), new Promise<Answer>((resolve) => (late = resolve))));
    act(() => result.current.gridProps.onSearchTextChange("x"));
    await waitFor(() => expect(held?.spec.searchText).toBe("x"));
    server.fetchRows.mockImplementation(original);
    act(() => result.current.gridProps.onSearchTextChange(""));
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    late({ groups: [{ key: "stale", childCount: 1, totalRowCount: 1, pivotCells: [1] }], groupCount: 1, totalRowCount: 1, pivotColumns: [{ path: ["stale"], valueIndex: 0 }] });
    await act(settle);
    expect(result.current.gridProps.groupLayout!.pivot!.columns).toHaveLength(6);
    expect(result.current.gridProps.groupLayout!.rows.map((slot) => slot.path[0]!.key)).toEqual(["A", "B", "C"]);
  });

  it("runs under StrictMode, aborts on unmount, and fetches nothing after a late answer", async () => {
    let late: (answer: Answer) => void = () => {};
    let held: ServerRowsRequest<never> | undefined;
    const server = fakeServer(rowsOf(REGIONS));
    const { result, unmount } = mount(server, {}, strict);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.pivot).toBeDefined());
    server.fetchRows.mockImplementationOnce((request) => ((held = request), new Promise<Answer>((resolve) => (late = resolve))));
    act(() => result.current.refresh());
    await waitFor(() => expect(held).toBeDefined());
    unmount();
    expect(held!.signal.aborted).toBe(true);
    const calls = server.calls.length;
    late({ groups: [], groupCount: 0, totalRowCount: 0, pivotColumns: [] });
    await settle();
    expect(server.calls).toHaveLength(calls);
  });

  it("keeps the held set of an initialAnswer across mount under StrictMode", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const initialAnswer = await server.fetchRows({ spec: { sorts: [], filters: [], searchText: "", ...PIVOT_SPEC }, start: 0, end: 50, groupPath: [], childKind: "groups", cursor: undefined, reason: "load", signal: new AbortController().signal });
    server.calls.length = 0;
    const seen = new Set<unknown>();
    renderHook(
      () => {
        const rows = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, loadDelayMs: 0, defaultSpec: PIVOT_SPEC, initialAnswer });
        seen.add(rows.gridProps.groupLayout?.pivot);
        return rows;
      },
      { wrapper: strict },
    );
    await act(settle);
    expect(seen.size).toBe(1);
    expect([...seen][0]).toMatchObject({ columnId: "city", omitted: 0 });
    expect(server.calls).toHaveLength(0);
  });

  it("evicts the oldest group blocks so the held cells stay within the cap", async () => {
    const COLUMNS = 200;
    const BLOCK = 200;
    const GROUPS = Math.ceil(MAX_PIVOT_CELLS / (COLUMNS * BLOCK)) * BLOCK + 2 * BLOCK;
    const pivotColumns = Array.from({ length: COLUMNS }, (_, key) => ({ path: [`k${key}`], valueIndex: 0 }));
    const cells = Array.from({ length: COLUMNS }, (_, key) => key);
    const fetchRows = vi.fn(async (request: ServerRowsRequest<never>): Promise<Answer> => ({
      groups: Array.from({ length: request.end - request.start }, (_, i) => ({ key: `g${request.start + i}`, childCount: 1, totalRowCount: 1, pivotCells: cells })),
      groupCount: GROUPS,
      totalRowCount: GROUPS,
      pivotColumns,
    }));
    const { result } = mount({ fetchRows }, { blockSize: BLOCK });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(BLOCK));
    for (let start = BLOCK; start < GROUPS; start += BLOCK) {
      act(() => result.current.gridProps.onRenderedRowsChange({ start, end: start + 10 }));
      await waitFor(() => expect(result.current.gridProps.data).toHaveLength(GROUPS));
      await waitFor(() => expect(result.current.gridProps.groupLayout!.rows.some((slot) => slot.viewRow === start)).toBe(true));
    }
    const slots = result.current.gridProps.groupLayout!.rows;
    const bytes = slots.reduce((total, slot) => total + slot.pivotCells!.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(MAX_PIVOT_CELLS * 8);
    expect(bytes).toBeGreaterThan(MAX_PIVOT_CELLS * 8 - COLUMNS * BLOCK * 8 * 2);
    // The top block stays: it is always wanted, so the oldest block after it drops.
    expect(slots[0]!.viewRow).toBe(0);
    expect(slots.some((slot) => slot.viewRow === BLOCK)).toBe(false);
    expect(slots.at(-1)!.viewRow).toBe(GROUPS - 1);
    expect(fetchRows.mock.calls.every(([request]) => request.childKind === "groups")).toBe(true);
  });
});
