import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupIdOf, type ServerAggregate } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { fakeServer, rowsOf, type Answer, type Row } from "./group-fake-server.test-helper";
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

describe("a pivot pages source", () => {
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

  it("runs under StrictMode and drops a page that lands after unmount", async () => {
    const error = vi.spyOn(console, "error");
    let late: (answer: Answer) => void = () => {};
    const server = fakeServer(rowsOf(REGIONS));
    const { result, unmount } = mount(server, {}, strict);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    server.fetchRows.mockImplementationOnce(() => new Promise<Answer>((resolve) => (late = resolve)));
    act(() => result.current.pager.onPageChange(2));
    unmount();
    late({ groups: [], groupCount: 0, totalRowCount: 0, pivotColumns: [] });
    await settle();
    expect(error).not.toHaveBeenCalled();
  });
});
