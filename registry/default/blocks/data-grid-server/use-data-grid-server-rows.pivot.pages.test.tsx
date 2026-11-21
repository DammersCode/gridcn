import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupIdOf, type ServerAggregate } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { fakeServer, rowsOf, type Answer, type Row } from "./group-fake-server.test-helper";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

const SUM: ServerAggregate = { columnId: "qty", reducer: "sum" };
const REGIONS = { A: 4, B: 2, C: 2, D: 2, E: 1 };
const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const keysOf = (result: { current: { gridProps: { groupLayout?: { rows: readonly { path: readonly { key: unknown }[] }[] } } } }) => result.current.gridProps.groupLayout?.rows.map((slot) => slot.path[0]!.key);

function mount(server: ReturnType<typeof fakeServer<Row>>, extra: Record<string, unknown> = {}, wrapper?: typeof strict) {
  return renderHook(() => useDataGridServerRows<Row>({ fetchRows: server.fetchRows as never, defaultPageSize: 2, pageSizeOptions: [2, 3], defaultSpec: { groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } }, ...extra }), { wrapper });
}

afterEach(() => vi.restoreAllMocks());

describe("a pivot pages source (server pagination)", () => {
  it("sends spec.pivot with each page of groups and keeps one held set across pages", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    expect(server.calls[0]).toMatchObject({ start: 0, end: 2, page: 1, pageSize: 2, childKind: "groups", spec: { aggregates: [SUM], pivot: { columnIds: ["city"] } } });
    const held = result.current.gridProps.groupLayout!.pivot!;
    expect(held.columns).toHaveLength(9);
    expect(Array.from(result.current.gridProps.groupLayout!.rows[1]!.pivotCells!.slice(0, 4))).toEqual([NaN, NaN, 1, 1]);
    expect([result.current.pager.pageCount, result.current.pager.totalRowCount, result.current.totalRowCount]).toEqual([3, 5, 11]);
    act(() => result.current.pager.onPageChange(3));
    await waitFor(() => expect(keysOf(result)).toEqual(["E"]));
    expect(server.calls.at(-1)).toMatchObject({ start: 4, end: 5, page: 3, childKind: "groups" });
    expect(result.current.gridProps.groupLayout!.pivot).toBe(held);
    expect(result.current.gridProps.groupLayout!.rows[0]!.childCount).toBe(0);
    act(() => result.current.refresh());
    await waitFor(() => expect(server.calls.at(-1)!.reason).toBe("refresh"));
    await act(settle);
    expect(result.current.gridProps.groupLayout!.pivot).toBe(held);
  });

  it("clamps the page size to 200 groups under pivot", async () => {
    const regions = Object.fromEntries(Array.from({ length: 450 }, (_, index) => [`r${String(index).padStart(3, "0")}`, 1]));
    const server = fakeServer(rowsOf(regions));
    const { result } = mount(server, { defaultPageSize: 10_000, pageSizeOptions: [10_000] });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(200));
    expect(server.calls[0]).toMatchObject({ start: 0, end: 200, page: 1, pageSize: 200 });
    expect([result.current.pager.pageSize, result.current.pager.pageCount]).toEqual([200, 3]);
    expect(result.current.pager.pageSizeOptions).toEqual([200]);
    act(() => result.current.pager.onPageChange(3));
    await waitFor(() => expect(keysOf(result)).toHaveLength(50));
    expect(server.calls.at(-1)).toMatchObject({ start: 400, end: 450, page: 3, pageSize: 200 });
    expect(keysOf(result)![0]).toBe("r400");
  });

  it("offers only the page sizes a pivot page can hold, and drops a larger size to the largest of them", async () => {
    const regions = Object.fromEntries(Array.from({ length: 450 }, (_, index) => [`r${String(index).padStart(3, "0")}`, 1]));
    const server = fakeServer(rowsOf(regions));
    const onPageSizeChange = vi.fn();
    const { result } = mount(server, { defaultPageSize: 500, pageSizeOptions: [50, 100, 500], onPageSizeChange });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(100));
    expect(result.current.pager.pageSizeOptions).toEqual([50, 100]);
    expect(result.current.pager.pageSize).toBe(100);
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
    expect(server.calls[0]).toMatchObject({ start: 0, end: 100, pageSize: 100 });
  });

  it("never sends a rows request when groups open on any page", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server, { defaultExpanded: { mode: "collapsed", ids: [groupIdOf([{ columnId: "region", key: "A" }])] } });
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    act(() => result.current.gridProps.onExpandedChange!({ mode: "expanded", ids: [] }));
    act(() => result.current.gridProps.onRenderedRowsChange!({ start: 0, end: 2 }));
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(keysOf(result)).toEqual(["C", "D"]));
    act(() => result.current.gridProps.onExpandedChange!({ mode: "collapsed", ids: [groupIdOf([{ columnId: "region", key: "C" }])] }));
    await act(settle);
    expect(result.current.gridProps.data).toHaveLength(2);
    expect(server.calls.every((call) => call.childKind === "groups")).toBe(true);
  });

  it("runs under StrictMode, aborts on unmount, and fetches nothing after a late page", async () => {
    let late: (answer: Answer) => void = () => {};
    let held: ServerRowsRequest<never> | undefined;
    const server = fakeServer(rowsOf(REGIONS));
    const { result, unmount } = mount(server, {}, strict);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    server.fetchRows.mockImplementationOnce((request) => ((held = request), new Promise<Answer>((resolve) => (late = resolve))));
    act(() => result.current.pager.onPageChange(2));
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
    const initialAnswer = await server.fetchRows({ spec: { sorts: [], filters: [], searchText: "", groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } }, start: 0, end: 2, page: 1, pageSize: 2, groupPath: [], childKind: "groups", cursor: undefined, reason: "load", signal: new AbortController().signal } as ServerRowsRequest<never>);
    server.calls.length = 0;
    const seen = new Set<unknown>();
    renderHook(
      () => {
        const rows = useDataGridServerRows<Row>({ fetchRows: server.fetchRows as never, defaultPageSize: 2, pageSizeOptions: [2, 3], defaultSpec: { groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } }, initialAnswer });
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
});
