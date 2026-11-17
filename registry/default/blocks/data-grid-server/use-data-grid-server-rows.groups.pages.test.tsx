import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupIdOf, type ExpandedState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { fakeServer, rowsOf, type Row } from "./group-fake-server.test-helper";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

const idOf = (region: string) => groupIdOf([{ columnId: "region", key: region }]);
const open = (...ids: string[]): ExpandedState => ({ mode: "collapsed", ids });
const REGIONS = { A: 7, B: 3, C: 4, D: 2, E: 5 };

function mount(server: ReturnType<typeof fakeServer>, extra: Record<string, unknown> = {}) {
  return renderHook(() =>
    useDataGridServerRows<Row>({
      fetchRows: server.fetchRows as never,
      defaultPageSize: 2,
      pageSizeOptions: [2, 3],
      defaultSpec: { groupBy: ["region"] },
      ...extra,
    }),
  );
}

type Grouped = { current: { gridProps: { groupLayout?: { rows: readonly { path: readonly { key: unknown }[] }[] } } } };
const keysOf = (result: Grouped) => result.current.gridProps.groupLayout?.rows.map((slot) => slot.path.at(-1)!.key);

afterEach(() => vi.restoreAllMocks());

describe("grouped pages source", () => {
  it("fetches the top level as one page of groups and counts pages by groups", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ start: 0, end: 2, page: 1, pageSize: 2, groupPath: [], childKind: "groups" });
    const { pager } = result.current;
    expect([pager.page, pager.pageCount, pager.totalRowCount, pager.unit]).toEqual([1, 3, 5, "groups"]);
    expect(result.current.totalRowCount).toBe(21);
    expect(result.current.gridProps.groupLayout!.leafCount).toBe(21);
    expect(result.current.gridProps.groupMode).toBe("server");
    expect(result.current.status).toBe("ready");
  });

  it("shows the groups of the page it moves to and nothing of the other pages", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(keysOf(result)).toEqual(["C", "D"]));
    expect(server.calls.at(-1)).toMatchObject({ start: 2, end: 4, page: 2, childKind: "groups" });
    act(() => result.current.pager.onPageChange(3));
    await waitFor(() => expect(keysOf(result)).toEqual(["E"]));
    expect(result.current.pager.hasMore).toBe(false);
    const calls = server.calls.length;
    act(() => result.current.pager.onPageChange(1));
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    expect(server.calls.length).toBe(calls);
  });

  it("opens a group under the page with pageSize as the block size", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("A"))));
    act(() => result.current.gridProps.onRenderedRowsChange!({ start: 0, end: 4 }));
    await waitFor(() => expect(result.current.gridProps.data[1]?.id).toBe("A0"));
    const rowCalls = server.calls.filter((call) => call.childKind === "rows");
    expect(rowCalls[0]).toMatchObject({ start: 0, end: 2, page: 1, pageSize: 2 });
    expect(rowCalls.every((call) => call.start % 2 === 0 && (call as { pageSize?: number }).pageSize === 2)).toBe(true);
    expect(result.current.gridProps.data).toHaveLength(2 + 7);
    expect(result.current.gridProps.groupLayout!.rows.map((slot) => slot.viewRow)).toEqual([0, 8]);
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(keysOf(result)).toEqual(["C", "D"]));
    act(() => result.current.pager.onPageChange(1));
    await waitFor(() => expect(result.current.gridProps.data[1]?.id).toBe("A0"));
  });

  it("goes back to page 1 when the group columns or the page size change", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(keysOf(result)).toEqual(["C", "D"]));
    act(() => result.current.gridProps.onGroupByChange!(["city"]));
    await waitFor(() => expect(result.current.pager.page).toBe(1));
    await waitFor(() => expect(keysOf(result)?.[0]).toBe("A-c0"));
    expect(server.calls.at(-1)).toMatchObject({ start: 0, groupPath: [], childKind: "groups" });
    act(() => result.current.pager.onPageSizeChange(3));
    await waitFor(() => expect(server.calls.at(-1)).toMatchObject({ start: 0, end: 3, pageSize: 3 }));
    await waitFor(() => expect(keysOf(result)).toHaveLength(3));
    expect(result.current.pager.pageSize).toBe(3);
  });

  it("hands the rows to the flat pager when the last group column goes", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    act(() => result.current.gridProps.onGroupByChange!([]));
    await waitFor(() => expect(result.current.gridProps.data).toHaveLength(2));
    expect(result.current.gridProps.data[0]?.id).toBe("A0");
    expect(result.current.pager.unit).toBeUndefined();
    expect(result.current.pager.totalRowCount).toBe(21);
    expect("childKind" in server.calls.at(-1)!).toBe(false);
  });

  it("shows an initialAnswer of groups without a request", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const initialAnswer = { groups: [{ key: "A", childCount: 7, totalRowCount: 7 }, { key: "B", childCount: 3, totalRowCount: 3 }], groupCount: 5, totalRowCount: 21 };
    const { result } = mount(server, { initialAnswer });
    expect(keysOf(result)).toEqual(["A", "B"]);
    expect(result.current.pager.totalRowCount).toBe(5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.calls).toHaveLength(0);
    act(() => result.current.pager.onPageChange(2));
    await waitFor(() => expect(keysOf(result)).toEqual(["C", "D"]));
  });

  it("shows an initialAnswer of groups in scroll mode without a request", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const initialAnswer = { groups: [{ key: "A", childCount: 7, totalRowCount: 7 }, { key: "B", childCount: 3, totalRowCount: 3 }], groupCount: 2, totalRowCount: 10 };
    const { result } = renderHook(() => useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, blockSize: 20, loadDelayMs: 0, defaultSpec: { groupBy: ["region"] }, initialAnswer }));
    expect(keysOf(result)).toEqual(["A", "B"]);
    expect(result.current.totalRowCount).toBe(10);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(server.calls).toHaveLength(0);
  });

  it("starts over on a search change and keeps the open groups", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server, { defaultExpanded: open(idOf("B")) });
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    act(() => result.current.gridProps.onRenderedRowsChange!({ start: 0, end: 6 }));
    await waitFor(() => expect(result.current.gridProps.data[2]?.id).toBe("B0"));
    act(() => result.current.gridProps.onSearchTextChange("x"));
    await waitFor(() => expect(server.calls.at(-1)!.spec.searchText).toBe("x"));
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    expect(result.current.gridProps.expanded?.ids).toEqual([idOf("B")]);
  });

  it("runs under StrictMode", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result, unmount } = renderHook(() => useDataGridServerRows<Row>({ fetchRows: server.fetchRows as never, defaultPageSize: 2, defaultSpec: { groupBy: ["region"] } }), { wrapper: StrictMode });
    await waitFor(() => expect(keysOf(result)).toEqual(["A", "B"]));
    unmount();
  });

  it("sends nothing new without a group prop", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = renderHook(() => useDataGridServerRows<Row>({ fetchRows: server.fetchRows as never, defaultPageSize: 2 }));
    await waitFor(() => expect(result.current.gridProps.data).toHaveLength(2));
    expect("groupPath" in server.calls[0]! || "childKind" in server.calls[0]!).toBe(false);
    expect("groupBy" in result.current.gridProps).toBe(false);
  });
});
