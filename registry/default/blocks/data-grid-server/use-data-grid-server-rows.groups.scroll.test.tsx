import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataChange } from "@/registry/default/blocks/data-grid/data-grid";
import { groupIdOf, type ExpandedState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { ServerRowsAnswer, ServerRowsRequest } from "./read-answer";
import type { ServerGroupRow, ServerGroupsAnswer } from "./read-groups-answer";
import { useDataGridServerRows } from "./use-data-grid-server-rows";

type Row = { id: string; region: string; city: string; qty: number };
type Answer = ServerRowsAnswer<Row, never> | ServerGroupsAnswer;

const rowsOf = (regions: Record<string, number>): Row[] =>
  Object.entries(regions).flatMap(([region, count]) => Array.from({ length: count }, (_, i) => ({ id: `${region}${i}`, region, city: `${region}-c${i % 2}`, qty: 1 })));

/** A server that implements the grouping contract over fixed rows: the oracle of these tests. */
function fakeServer(rows: readonly Row[], answerFor?: (request: ServerRowsRequest<never>) => Answer | undefined) {
  const calls: ServerRowsRequest<never>[] = [];
  const keyOf = (row: Row, columnId: string) => row[columnId as keyof Row] as string;
  const fetchRows = vi.fn((request: ServerRowsRequest<never>): Promise<Answer> => {
    calls.push(request);
    const override = answerFor?.(request);
    if (override) return Promise.resolve(override);
    const { spec, start, end, groupPath = [], childKind } = request;
    if (!childKind) return Promise.resolve({ rows: rows.slice(start, end), totalRowCount: rows.length });
    const groupBy = spec.groupBy ?? [];
    const inside = rows.filter((row) => groupPath.every((segment) => keyOf(row, segment.columnId) === segment.key));
    if (childKind === "rows") return Promise.resolve({ rows: inside.slice(start, end), totalRowCount: inside.length });
    const columnId = groupBy[groupPath.length]!;
    const keys = [...new Set(inside.map((row) => keyOf(row, columnId)))].sort();
    const groups: ServerGroupRow[] = keys.slice(start, end).map((key) => {
      const members = inside.filter((row) => keyOf(row, columnId) === key);
      const last = groupPath.length + 1 === groupBy.length;
      const childCount = last ? members.length : new Set(members.map((row) => keyOf(row, groupBy[groupPath.length + 1]!))).size;
      return { key, childCount, totalRowCount: members.length, aggregates: { qty: members.length } };
    });
    return Promise.resolve({ groups, groupCount: keys.length, ...(groupPath.length === 0 ? { totalRowCount: inside.length } : null) });
  });
  return { calls, fetchRows };
}

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const idOf = (region: string) => groupIdOf([{ columnId: "region", key: region }]);
const open = (...ids: string[]): ExpandedState => ({ mode: "collapsed", ids });
const REGIONS = { A: 120, B: 60, C: 10 };

function mount(server: ReturnType<typeof fakeServer>, extra: Record<string, unknown> = {}, wrapper?: typeof strict) {
  return renderHook(
    () =>
      useDataGridServerRows<Row>({
        mode: "scroll",
        fetchRows: server.fetchRows as never,
        blockSize: 20,
        overscan: 0,
        loadDelayMs: 0,
        defaultSpec: { groupBy: ["region"], aggregates: [{ columnId: "qty", reducer: "sum" }] },
        ...extra,
      }),
    { wrapper },
  );
}

afterEach(() => vi.restoreAllMocks());

describe("grouped scroll source", () => {
  it("asks for the top level of groups and lays the group rows out", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ start: 0, end: 20, groupPath: [], childKind: "groups" });
    const { groupLayout, data } = result.current.gridProps;
    expect(groupLayout!.rows.map((slot) => slot.viewRow)).toEqual([0, 1, 2]);
    expect(groupLayout!.rows.map((slot) => [slot.count, slot.childCount, slot.aggregates?.["qty"]])).toEqual([[120, 120, 120], [60, 60, 60], [10, 10, 10]]);
    expect(groupLayout!.leafCount).toBe(190);
    expect(data).toHaveLength(3);
    expect(result.current.gridProps.groupMode).toBe("server");
    expect(result.current.gridProps.groupBy).toEqual(["region"]);
    expect(result.current.totalRowCount).toBe(190);
    expect(result.current.status).toBe("ready");
  });

  it("fetches the rows of a group by its path when it opens, and nothing for a closed group", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("B"))));
    expect(result.current.gridProps.data).toHaveLength(63);
    expect(result.current.unloadedCount).toBe(60);
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.gridProps.data[3]?.id).toBe("B1"));
    const rowCall = server.calls.find((call) => call.childKind === "rows")!;
    expect(rowCall).toMatchObject({ start: 0, end: 20, groupPath: [{ columnId: "region", key: "B" }] });
    expect(server.calls.filter((call) => call.childKind === "rows")).toHaveLength(1);
    expect(result.current.gridProps.groupLayout!.rows.map((slot) => slot.viewRow)).toEqual([0, 1, 62]);
  });

  it("loads the blocks of a long group as the rendered rows move, nearest first", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("A"))));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 60, end: 70 }));
    await waitFor(() => expect(result.current.gridProps.data[65]?.id).toBe("A64"));
    const starts = server.calls.filter((call) => call.childKind === "rows").map((call) => call.start);
    expect(starts.sort()).toEqual([40, 60]);
    expect(result.current.getLoadedRanges().some((range) => range.start <= 65 && range.end > 65)).toBe(true);
  });

  it("opens a second level through a request of childKind groups", async () => {
    const server = fakeServer(rowsOf({ A: 30 }));
    const { result } = mount(server, { defaultSpec: { groupBy: ["region", "city"] } });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(1));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("A"))));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 5 }));
    await waitFor(() => expect(result.current.gridProps.groupLayout!.rows).toHaveLength(3));
    const call = server.calls.at(-1)!;
    expect(call).toMatchObject({ childKind: "groups", groupPath: [{ columnId: "region", key: "A" }] });
    expect(result.current.gridProps.groupLayout!.rows.map((slot) => slot.path.length)).toEqual([1, 2, 2]);
  });

  it("aborts the request of a group that closes, and shows its rows again from the cache", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    const original = server.fetchRows.getMockImplementation()!;
    let held: ServerRowsRequest<never> | undefined;
    let release: (answer: Answer) => void = () => {};
    server.fetchRows.mockImplementationOnce((request) => ((held = request), new Promise<Answer>((resolve) => (release = resolve))));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("C"))));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 5 }));
    await waitFor(() => expect(held?.childKind).toBe("rows"));
    act(() => result.current.gridProps.onExpandedChange!(open()));
    await waitFor(() => expect(held!.signal.aborted).toBe(true));
    release({ rows: [{ id: "late", region: "C", city: "x", qty: 1 }], totalRowCount: 10 });
    await settle();
    expect(result.current.gridProps.data).toHaveLength(3);
    server.fetchRows.mockImplementation(original);
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("C"))));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 5 }));
    await waitFor(() => expect(result.current.gridProps.data[3]?.id).toBe("C0"));
  });

  it("keeps an edit when a block of another list lands after it", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("C"), idOf("B"))));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 12 }));
    await waitFor(() => expect(result.current.gridProps.data[2]?.id).toBe("B0"));
    const before = result.current.gridProps.data[2]!;
    const change: DataChange<Row> = { ops: [{ type: "update", rowId: "B0", row: { ...before, qty: 99 } } as never], source: "edit" };
    act(() => result.current.gridProps.onDataChange(result.current.gridProps.data, change));
    expect(result.current.gridProps.data[2]?.qty).toBe(99);
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 58, end: 70 }));
    await waitFor(() => expect(result.current.gridProps.data[63]?.id).toBe("C0"));
    expect(result.current.gridProps.data[2]?.qty).toBe(99);
  });

  it("fails a groups block that shifts twice instead of looping", async () => {
    const server = fakeServer([], (request) => {
      if (request.childKind !== "groups") return undefined;
      const keys = request.start === 0 ? ["a", "b"] : ["b", "c"];
      return { groups: keys.map((key) => ({ key, childCount: 1, totalRowCount: 1 })), groupCount: 4, totalRowCount: 4 };
    });
    const { result } = mount(server, { blockSize: 2, overscan: 4 });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows.length).toBeGreaterThan(1));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 4 }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(String((result.current.error as Error).message)).toContain("shifted");
    const before = server.calls.length;
    await settle();
    expect(server.calls.length).toBe(before);
  });

  it("rejects an answer with a bad key, a reserved row id, and a wrong kind", async () => {
    const onError = vi.fn();
    const bad = fakeServer(rowsOf({ A: 3 }), (request) => (request.childKind === "groups" ? { groups: [{ key: { evil: 1 } as never, childCount: 1, totalRowCount: 1 }], groupCount: 1, totalRowCount: 1 } : undefined));
    const first = mount(bad, { onError });
    await waitFor(() => expect(first.result.current.status).toBe("error"));
    expect(onError).toHaveBeenCalledTimes(1);
    const reserved = fakeServer(rowsOf({ A: 3 }), (request) => (request.childKind === "rows" ? { rows: [{ id: "__group:x", region: "A", city: "", qty: 1 }], totalRowCount: 1 } : undefined));
    const second = mount(reserved);
    await waitFor(() => expect(second.result.current.gridProps.groupLayout?.rows).toHaveLength(1));
    act(() => second.result.current.gridProps.onExpandedChange!(open(idOf("A"))));
    act(() => second.result.current.gridProps.onRenderedRowsChange({ start: 0, end: 3 }));
    await waitFor(() => expect(second.result.current.status).toBe("error"));
    expect(String((second.result.current.error as Error).message)).toContain("reserves");
    const wrongKind = fakeServer(rowsOf({ A: 3 }), (request) => (request.childKind === "groups" ? { rows: [], totalRowCount: 0 } : undefined));
    const third = mount(wrongKind);
    await waitFor(() => expect(third.result.current.status).toBe("error"));
  });

  it("starts over on a spec change, keeps the open groups, and drops a late answer", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("C"))));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 5 }));
    await waitFor(() => expect(result.current.gridProps.data[3]?.id).toBe("C0"));
    let held: ServerRowsRequest<never> | undefined;
    let late: (answer: Answer) => void = () => {};
    server.fetchRows.mockImplementationOnce((request) => ((held = request), new Promise<Answer>((resolve) => (late = resolve))));
    act(() => result.current.gridProps.onSearchTextChange("x"));
    await waitFor(() => expect(held?.spec.searchText).toBe("x"));
    expect(result.current.gridProps.data[3]?.id).toBe("C0");
    expect(result.current.loading).toBe(true);
    act(() => result.current.gridProps.onSearchTextChange("y"));
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    expect(held!.signal.aborted).toBe(true);
    late({ groups: [{ key: "stale", childCount: 1, totalRowCount: 1 }], groupCount: 1, totalRowCount: 1 });
    await settle();
    expect(result.current.gridProps.groupLayout!.rows.map((slot) => slot.path[0]!.key)).toEqual(["A", "B", "C"]);
    expect(result.current.gridProps.expanded?.ids).toEqual([idOf("C")]);
  });

  it("drops the kept rows once a spec change answers no groups", async () => {
    const server = fakeServer(rowsOf(REGIONS), (request) => (request.spec.searchText === "none" ? { groups: [], groupCount: 0, totalRowCount: 0 } : undefined));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onSearchTextChange("none"));
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(0));
    expect(result.current.gridProps.data).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it("keeps the rows with the error after a spec change fails, and shows the answer of the retry", async () => {
    let failing = true;
    const server = fakeServer(rowsOf(REGIONS), (request) => (request.spec.searchText === "x" && failing ? { rows: "bad" } as never : undefined));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onSearchTextChange("x"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3);
    failing = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    await waitFor(() => expect(server.calls.at(-1)!.spec.searchText).toBe("x"));
    expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3);
  });

  it("hands the rows back to the flat engine when the last group column goes", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onGroupByChange!([]));
    await waitFor(() => expect(result.current.gridProps.data).toHaveLength(190));
    expect(result.current.gridProps.groupLayout).toBeUndefined();
    expect(result.current.gridProps.groupBy).toEqual([]);
    const flat = server.calls.at(-1)!;
    expect("groupPath" in flat).toBe(false);
    expect("childKind" in flat).toBe(false);
    expect(flat.spec.groupBy).toBeUndefined();
    act(() => result.current.gridProps.onGroupByChange!(["city"]));
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows.length).toBeGreaterThan(0));
    expect(server.calls.at(-1)).toMatchObject({ childKind: "groups", groupPath: [] });
  });

  it("evicts the row blocks furthest from the rendered rows past maxLoadedRows and loads them again", async () => {
    const server = fakeServer(rowsOf({ A: 120 }));
    const { result } = mount(server, { maxLoadedRows: 40 });
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(1));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("A"))));
    for (const start of [0, 40, 80, 100]) {
      act(() => result.current.gridProps.onRenderedRowsChange({ start, end: start + 10 }));
      await waitFor(() => expect(result.current.gridProps.data[start + 5]?.id).toBe(`A${start + 4}`));
    }
    expect(result.current.gridProps.data[5]).toBeUndefined();
    const fetches = server.calls.filter((call) => call.childKind === "rows").length;
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.gridProps.data[5]?.id).toBe("A4"));
    expect(server.calls.filter((call) => call.childKind === "rows").length).toBeGreaterThan(fetches);
  });

  it("refreshes in place and retries a failed block", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    act(() => result.current.gridProps.onExpandedChange!(open(idOf("C"))));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 5 }));
    await waitFor(() => expect(result.current.gridProps.data[3]?.id).toBe("C0"));
    const before = server.calls.length;
    act(() => result.current.refresh());
    expect(result.current.gridProps.data[3]?.id).toBe("C0");
    await waitFor(() => expect(server.calls.length).toBeGreaterThan(before));
    expect(server.calls.slice(before).every((call) => call.reason === "refresh")).toBe(true);
    const original = server.fetchRows.getMockImplementation()!;
    server.fetchRows.mockImplementation(() => Promise.reject(new Error("down")));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status).toBe("error"));
    server.fetchRows.mockImplementation(original);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("runs under StrictMode with one top-level request kept", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result, unmount } = mount(server, {}, strict);
    await waitFor(() => expect(result.current.gridProps.groupLayout?.rows).toHaveLength(3));
    unmount();
  });

  it("sends nothing new without a group prop", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server, { defaultSpec: undefined });
    await waitFor(() => expect(result.current.gridProps.data).toHaveLength(190));
    const call = server.calls[0]!;
    expect("groupPath" in call || "childKind" in call || "groupBy" in call.spec).toBe(false);
    expect("groupBy" in result.current.gridProps).toBe(false);
    expect("onExpandedChange" in result.current.gridProps).toBe(false);
  });

  it("offers grouping while the spec holds an empty groupBy", async () => {
    const server = fakeServer(rowsOf(REGIONS));
    const { result } = mount(server, { defaultSpec: { groupBy: [] } });
    await waitFor(() => expect(result.current.gridProps.data).toHaveLength(190));
    expect(result.current.gridProps.groupBy).toEqual([]);
    expect(result.current.gridProps.groupLayout).toBeUndefined();
    expect("groupPath" in server.calls[0]!).toBe(false);
  });
});
