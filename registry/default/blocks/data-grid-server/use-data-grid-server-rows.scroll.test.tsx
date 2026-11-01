import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RowRange, ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsScrollOptions } from "./use-data-grid-server-rows";

type Row = { id: string; name: string };
type Fetch = (request: ServerRowsRequest) => Promise<ServerRowsAnswer<Row>>;

const makeRows = (start: number, end: number): Row[] => Array.from({ length: Math.max(0, end - start) }, (_, i) => ({ id: `row-${start + i}`, name: `Person ${start + i}` }));
const person = (i: number): Row => ({ id: `row-${i}`, name: `Person ${i}` });

function countedServer(total = 1000) {
  return vi.fn<Fetch>(async ({ start, end }) => ({ rows: makeRows(start, Math.min(end, total)), totalRowCount: total }));
}

type Extra = Partial<UseDataGridServerRowsScrollOptions<Row>>;
const optionsOf = (fetchRows: Fetch, extra: Extra): UseDataGridServerRowsScrollOptions<Row> => ({ mode: "scroll", getRowId: (r) => r.id, fetchRows, blockSize: 10, overscan: 0, ...extra });

async function mount(fetchRows: Fetch, extra: Extra = {}, wrapper?: ({ children }: { children: ReactNode }) => ReactNode) {
  const view = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, extra)), wrapper ? { wrapper } : undefined);
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

const window_ = (result: { current: { gridProps: { onRenderedRowsChange: (range: RowRange) => void } } }, range: RowRange) => act(() => result.current.gridProps.onRenderedRowsChange(range));
const settled = (result: { current: { loading: boolean } }) => waitFor(() => expect(result.current.loading).toBe(false));
const ranges = (fetchRows: ReturnType<typeof countedServer>) => fetchRows.mock.calls.map(([r]) => [r.start, r.end]);

afterEach(() => vi.restoreAllMocks());

describe("useDataGridServerRows scroll mode: first block and count", () => {
  it("sends block 0 first, with the spec, no cursor, and a signal", async () => {
    const fetchRows = countedServer();
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    expect(result.current.loading).toBe(true);
    expect(result.current.gridProps.data).toEqual([]);
    await settled(result);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(fetchRows.mock.calls[0]![0]).toMatchObject({ start: 0, end: 10, cursor: undefined, spec: { sorts: [], filters: [], searchText: "" } });
    expect(fetchRows.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
  });

  it("sizes the sparse data from totalRowCount and loads only block 0", async () => {
    const { result } = await mount(countedServer(1000));
    expect(result.current.gridProps.data.length).toBe(1000);
    expect(result.current.totalRowCount).toBe(1000);
    expect(result.current.gridProps.totalRowCount).toBe(1000);
    expect(result.current.unloadedCount).toBe(990);
    expect(result.current.gridProps.data[3]).toEqual(person(3));
    expect(result.current.gridProps.data[10]).toBeUndefined();
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]);
  });

  it("holds a window reported before block 0 lands until it lands, then fetches that window", async () => {
    const fetchRows = countedServer();
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    window_(result, { start: 100, end: 120 });
    await settled(result);
    await waitFor(() => expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }, { start: 100, end: 120 }]));
    expect(ranges(fetchRows)).toEqual([[0, 10], [100, 110], [110, 120]]);
  });

  it("a count change in an answer resets the blocks to the new size", async () => {
    let total = 1000;
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => ({ rows: makeRows(start, Math.min(end, total)), totalRowCount: total }));
    const { result } = await mount(fetchRows);
    window_(result, { start: 0, end: 10 });
    total = 500;
    window_(result, { start: 200, end: 210 });
    await settled(result);
    await waitFor(() => expect(result.current.totalRowCount).toBe(500));
    expect(result.current.gridProps.data.length).toBe(500);
    expect(result.current.gridProps.data[3]).toBeUndefined();
    expect(result.current.gridProps.data[205]).toEqual(person(205));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 200, end: 210 }]);
  });

  it("a hostile count clamps or reads as unknown through the answer reader", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn<Fetch>(async ({ start }) => ({ rows: makeRows(start, start + 3), totalRowCount: -1 }));
    const { result } = await mount(fetchRows);
    expect(result.current.gridProps.data).toHaveLength(3);
  });
});

describe("useDataGridServerRows scroll mode: block fetching", () => {
  it("fetches the window plus overscan rounded out to blocks, one request per block", async () => {
    const fetchRows = countedServer();
    const { result } = await mount(fetchRows, { overscan: 10, blockSize: 50 });
    fetchRows.mockClear();
    window_(result, { start: 100, end: 130 });
    await settled(result);
    expect(ranges(fetchRows)).toEqual([[50, 100], [100, 150]]);
    expect(result.current.gridProps.data[60]).toEqual(person(60));
    expect(result.current.gridProps.data[149]).toEqual(person(149));
    expect(result.current.unloadedCount).toBe(1000 - 150 - 0);
  });

  it("never refetches a loaded block on an overlapping window", async () => {
    const fetchRows = countedServer();
    const { result } = await mount(fetchRows);
    fetchRows.mockClear();
    window_(result, { start: 0, end: 10 });
    window_(result, { start: 2, end: 8 });
    await settled(result);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("fetches only the uncovered blocks when a window partly overlaps a loaded range", async () => {
    const fetchRows = countedServer();
    const { result } = await mount(fetchRows);
    window_(result, { start: 20, end: 50 });
    await settled(result);
    fetchRows.mockClear();
    window_(result, { start: 30, end: 80 });
    await settled(result);
    expect(ranges(fetchRows)).toEqual([[50, 60], [60, 70], [70, 80]]);
  });

  it("dedups a window reported again while its blocks are in flight", async () => {
    let calls = 0;
    const resolvers: Array<() => void> = [];
    const fetchRows = vi.fn<Fetch>(
      ({ start, end }) =>
        new Promise((resolve) => {
          calls++;
          resolvers.push(() => resolve({ rows: makeRows(start, end), totalRowCount: 1000 }));
        }),
    );
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    await waitFor(() => expect(calls).toBe(1));
    await act(async () => resolvers.shift()!());
    await waitFor(() => expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]));
    window_(result, { start: 20, end: 30 });
    window_(result, { start: 20, end: 30 });
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });

  it("drops the tail of an over-long answer and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => ({ rows: makeRows(start, end + 10), totalRowCount: 1000 }));
    const { result } = await mount(fetchRows);
    expect(result.current.gridProps.data[9]).toEqual(person(9));
    expect(result.current.gridProps.data[10]).toBeUndefined();
    expect(result.current.unloadedCount).toBe(990);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("only the first 10"))).toBe(true);
  });

  it("marks only the written rows loaded after a short answer and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn<Fetch>(async ({ start }) => ({ rows: makeRows(start, start + 4), totalRowCount: 1000 }));
    const { result } = await mount(fetchRows);
    expect(result.current.gridProps.data[3]).toEqual(person(3));
    expect(result.current.gridProps.data[4]).toBeUndefined();
    expect(result.current.unloadedCount).toBe(996);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("4 rows"))).toBe(true);
  });

  it("merges adjacent loaded blocks into one range", async () => {
    const { result } = await mount(countedServer());
    window_(result, { start: 10, end: 20 });
    await settled(result);
    window_(result, { start: 20, end: 30 });
    await settled(result);
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 30 }]);
  });

  it("the last block stops at the count", async () => {
    const fetchRows = countedServer(25);
    const { result } = await mount(fetchRows);
    window_(result, { start: 15, end: 25 });
    await settled(result);
    expect(ranges(fetchRows)).toEqual([[0, 10], [10, 20], [20, 25]]);
    expect(result.current.unloadedCount).toBe(0);
  });

  it("writes the blocks that land in one frame with one copy of the rows", async () => {
    const fetchRows = countedServer(100_000);
    const { result } = await mount(fetchRows, { blockSize: 50, overscan: 0 });
    const seen = new Set<unknown>([result.current.gridProps.data]);
    window_(result, { start: 5000, end: 5300 });
    await settled(result);
    seen.add(result.current.gridProps.data);
    expect(result.current.getLoadedRanges().at(-1)).toEqual({ start: 5000, end: 5300 });
    expect(seen.size).toBeLessThanOrEqual(3);
  });
});

describe("useDataGridServerRows scroll mode: errors and retry", () => {
  it("a failed block reverts to unloaded, sets the error, calls onError, and refetches when it is visible again", async () => {
    const onError = vi.fn();
    let failNext = false;
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => {
      if (failNext) {
        failNext = false;
        throw new Error("network down");
      }
      return { rows: makeRows(start, end), totalRowCount: 1000 };
    });
    const { result } = await mount(fetchRows, { onError });
    failNext = true;
    window_(result, { start: 50, end: 60 });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.gridProps.error).toBe(result.current.error);
    expect(result.current.gridProps.data[55]).toBeUndefined();
    fetchRows.mockClear();
    window_(result, { start: 50, end: 60 });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(ranges(fetchRows)).toEqual([[50, 60]]);
    expect(result.current.error).toBeNull();
    expect(result.current.gridProps.data[55]).toEqual(person(55));
  });

  it("retry repeats the failed blocks only", async () => {
    let fail = false;
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => {
      if (fail && start >= 50) throw new Error("down");
      return { rows: makeRows(start, end), totalRowCount: 1000 };
    });
    const { result } = await mount(fetchRows, { onError: () => {} });
    window_(result, { start: 20, end: 30 });
    await settled(result);
    fail = true;
    window_(result, { start: 50, end: 70 });
    await waitFor(() => expect(result.current.status).toBe("error"));
    fail = false;
    fetchRows.mockClear();
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(ranges(fetchRows).sort()).toEqual([[50, 60], [60, 70]]);
    expect(result.current.gridProps.data[65]).toEqual(person(65));
  });

  it("retry does nothing without an error, and a failed first block retries as block 0", async () => {
    let fail = true;
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => {
      if (fail) throw new Error("down");
      return { rows: makeRows(start, end), totalRowCount: 100 };
    });
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, { onError: () => {} })));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.gridProps.data).toEqual([]);
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ start: 0, end: 10 });
    fetchRows.mockClear();
    act(() => result.current.retry());
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("a fetchRows that throws synchronously counts as a failed block", async () => {
    let calls = 0;
    const fetchRows = vi.fn<Fetch>(({ start, end }) => {
      calls++;
      if (calls === 2) throw new Error("sync boom");
      return Promise.resolve({ rows: makeRows(start, end), totalRowCount: 1000 });
    });
    const onError = vi.fn();
    const { result } = await mount(fetchRows, { onError });
    window_(result, { start: 20, end: 30 });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    window_(result, { start: 20, end: 30 });
    await waitFor(() => expect(result.current.gridProps.data[25]).toEqual(person(25)));
  });

  it("contains a throwing onLoaded and onError", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onLoaded = vi.fn(() => {
      throw new Error("consumer bug");
    });
    const { result } = await mount(countedServer(), { onLoaded });
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(result.current.gridProps.data[5]).toEqual(person(5));
  });
});

describe("useDataGridServerRows scroll mode: aborts and races", () => {
  it("aborts every in-flight request on unmount", async () => {
    const signals: AbortSignal[] = [];
    const fetchRows = vi.fn<Fetch>(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { unmount } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);
    unmount();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("a spec change mid-flight aborts the old requests and drops their rows", async () => {
    const pending: Array<{ spec: ServerSpec; signal: AbortSignal; resolve: () => void; start: number; end: number }> = [];
    const fetchRows = vi.fn<Fetch>(
      ({ spec, signal, start, end }) =>
        new Promise((resolve) => {
          pending.push({ spec, signal, start, end, resolve: () => resolve({ rows: makeRows(start, end).map((r) => ({ ...r, name: spec.searchText })), totalRowCount: 100 }) });
        }),
    );
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.gridProps.onSearchTextChange("b"));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]!.signal.aborted).toBe(true);
    await act(async () => pending[0]!.resolve());
    expect(result.current.gridProps.data).toEqual([]);
    await act(async () => pending[1]!.resolve());
    await settled(result);
    expect(result.current.gridProps.data[0]?.name).toBe("b");
    expect(pending[1]!.spec.searchText).toBe("b");
  });

  it("a stale answer that settles after its replacement started does not clear the replacement", async () => {
    const pending: Array<{ signal: AbortSignal; resolve: () => void }> = [];
    const fetchRows = vi.fn<Fetch>(
      ({ signal, start, end }) =>
        new Promise((resolve) => {
          pending.push({ signal, resolve: () => resolve({ rows: makeRows(start, end), totalRowCount: 100 }) });
        }),
    );
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    await waitFor(() => expect(pending).toHaveLength(1));
    act(() => result.current.gridProps.onSortChange([{ columnId: "name", direction: "asc" }]));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[0]!.resolve());
    expect(result.current.loading).toBe(true);
    await act(async () => pending[1]!.resolve());
    await settled(result);
    expect(result.current.gridProps.data[5]).toEqual(person(5));
  });

  it("a count change mid-flight drops the answers of the old count", async () => {
    const pending: Array<{ start: number; resolve: (total: number) => void; signal: AbortSignal }> = [];
    const fetchRows = vi.fn<Fetch>(
      ({ start, end, signal }) =>
        new Promise((resolve) => {
          pending.push({ start, signal, resolve: (total) => resolve({ rows: makeRows(start, Math.min(end, total)), totalRowCount: total }) });
        }),
    );
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]!.resolve(1000));
    window_(result, { start: 100, end: 110 });
    window_(result, { start: 300, end: 310 });
    await waitFor(() => expect(pending).toHaveLength(3));
    await act(async () => pending[2]!.resolve(200));
    await waitFor(() => expect(result.current.gridProps.data.length).toBe(200));
    expect(pending[1]!.signal.aborted).toBe(true);
    await act(async () => pending[1]!.resolve(1000));
    expect(result.current.gridProps.data.length).toBe(200);
    expect(result.current.gridProps.data[105]).toBeUndefined();
  });

  it("StrictMode double mount fetches block 0 once", async () => {
    const fetchRows = countedServer();
    const { result } = await mount(fetchRows, {}, ({ children }) => <StrictMode>{children}</StrictMode>);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(result.current.gridProps.data[3]).toEqual(person(3));
    window_(result, { start: 20, end: 30 });
    await settled(result);
    expect(ranges(fetchRows)).toEqual([[0, 10], [20, 30]]);
  });
});

describe("useDataGridServerRows scroll mode: spec and refresh", () => {
  it("sends the spec and resets to block 0 when its content changes, keeping the skeleton count", async () => {
    const fetchRows = countedServer();
    const { result, rerender } = renderHook(({ spec }: { spec: ServerSpec }) => useDataGridServerRows<Row>(optionsOf(fetchRows, { spec })), { initialProps: { spec: { sorts: [], filters: [], searchText: "a" } } });
    await settled(result);
    expect(fetchRows.mock.calls[0]![0].spec.searchText).toBe("a");
    rerender({ spec: { sorts: [], filters: [], searchText: "a" } });
    expect(fetchRows).toHaveBeenCalledTimes(1);
    rerender({ spec: { sorts: [], filters: [], searchText: "b" } });
    expect(result.current.gridProps.data.length).toBe(1000);
    expect(result.current.gridProps.data[0]).toBeUndefined();
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.searchText).toBe("b"));
    await settled(result);
    expect(result.current.gridProps.data[0]).toEqual(person(0));
  });

  it("refresh refetches the rendered blocks in place and evicts the rest", async () => {
    let suffix = "";
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => ({ rows: makeRows(start, end).map((r) => ({ ...r, name: r.name + suffix })), totalRowCount: 1000 }));
    const { result } = await mount(fetchRows);
    window_(result, { start: 100, end: 120 });
    await settled(result);
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }, { start: 100, end: 120 }]);
    suffix = "!";
    fetchRows.mockClear();
    act(() => result.current.refresh());
    expect(result.current.gridProps.data[105]).toEqual(person(105));
    expect(result.current.loading).toBe(true);
    expect(result.current.getLoadedRanges()).toEqual([{ start: 100, end: 120 }]);
    await settled(result);
    expect(ranges(fetchRows)).toEqual([[100, 110], [110, 120]]);
    expect(result.current.gridProps.data[105]?.name).toBe("Person 105!");
    expect(result.current.gridProps.data[3]).toBeUndefined();
  });

  it("keeps refresh, retry, and the provider callbacks stable across renders", async () => {
    const { result, rerender } = await mount(countedServer());
    const before = result.current;
    rerender();
    const after = result.current;
    expect(after.refresh).toBe(before.refresh);
    expect(after.retry).toBe(before.retry);
    expect(after.evict).toBe(before.evict);
    expect(after.getLoadedRanges).toBe(before.getLoadedRanges);
    for (const key of ["getRowId", "onDataChange", "onRenderedRowsChange", "onSortChange", "onFilterChange", "onSearchTextChange"] as const) {
      expect(after.gridProps[key]).toBe(before.gridProps[key]);
    }
    expect(after.gridProps).toBe(before.gridProps);
    expect(after.gridProps).toMatchObject({ sortMode: "server", filterMode: "server", keepCheckedRows: true });
  });

  it("uses an index-derived placeholder id for unloaded rows", async () => {
    const { result } = await mount(countedServer());
    expect(result.current.gridProps.getRowId(undefined as unknown as Row, 7)).toContain("7");
    expect(result.current.gridProps.getRowId(person(7), 7)).toBe("row-7");
  });
});

describe("useDataGridServerRows scroll mode: loaded ranges", () => {
  it("onLoaded fires with the written range, clamped for a short answer and skipped for an empty one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn<Fetch>(async ({ start }) => ({ rows: start === 30 ? [] : makeRows(start, start + 5), totalRowCount: 100 }));
    const onLoaded = vi.fn();
    const { result } = await mount(fetchRows, { onLoaded });
    expect(onLoaded).toHaveBeenCalledWith({ start: 0, end: 5 });
    window_(result, { start: 30, end: 40 });
    await settled(result);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("onLoaded is not fired for aborted or rejected requests", async () => {
    const onLoaded = vi.fn();
    const hung = vi.fn<Fetch>(({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const { unmount } = renderHook(() => useDataGridServerRows<Row>(optionsOf(hung, { onLoaded })));
    await waitFor(() => expect(hung).toHaveBeenCalled());
    unmount();
    const failing = vi.fn<Fetch>(async () => {
      throw new Error("down");
    });
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(failing, { onLoaded, onError: () => {} })));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("evict holes the range, keeps the rest of a partly overlapping block, and refetches on the next window", async () => {
    const fetchRows = countedServer(100);
    const { result } = await mount(fetchRows);
    window_(result, { start: 10, end: 50 });
    await settled(result);
    expect(result.current.unloadedCount).toBe(50);
    act(() => result.current.evict({ start: 12, end: 20 }));
    expect(result.current.gridProps.data[15]).toBeUndefined();
    expect(result.current.gridProps.data[11]).toEqual(person(11));
    expect(result.current.unloadedCount).toBe(58);
    fetchRows.mockClear();
    window_(result, { start: 13, end: 18 });
    await settled(result);
    expect(ranges(fetchRows)).toEqual([[12, 20]]);
    expect(result.current.gridProps.data[15]).toEqual(person(15));
  });

  it("evict does not abort an in-flight request: it still lands", async () => {
    const resolvers: Array<() => void> = [];
    const fetchRows = vi.fn<Fetch>(
      ({ start, end }) =>
        new Promise((resolve) => {
          resolvers.push(() => resolve({ rows: makeRows(start, end), totalRowCount: 100 }));
        }),
    );
    const { result } = renderHook(() => useDataGridServerRows<Row>(optionsOf(fetchRows, {})));
    await waitFor(() => expect(resolvers).toHaveLength(1));
    await act(async () => resolvers[0]!());
    await waitFor(() => expect(result.current.getLoadedRanges()).toHaveLength(1));
    window_(result, { start: 20, end: 30 });
    act(() => result.current.evict({ start: 20, end: 30 }));
    await act(async () => resolvers[1]!());
    await waitFor(() => expect(result.current.gridProps.data[25]).toEqual(person(25)));
  });

  it("evict is a no-op for unloaded and out-of-range targets and clamps to [0, count]", async () => {
    const { result } = await mount(countedServer(100));
    act(() => result.current.evict({ start: 50, end: 60 }));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]);
    act(() => result.current.evict({ start: 100, end: 200 }));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]);
    act(() => result.current.evict({ start: -10, end: 5 }));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 5, end: 10 }]);
  });

  it("getLoadedRanges returns a copy", async () => {
    const { result } = await mount(countedServer(100));
    (result.current.getLoadedRanges() as RowRange[]).push({ start: 90, end: 95 });
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]);
  });
});

describe("useDataGridServerRows scroll mode: edits", () => {
  it("merges an edit into the sparse rows and calls the consumer's onDataChange after it", async () => {
    const onDataChange = vi.fn();
    const { result } = await mount(countedServer(10), { onDataChange });
    const edited = result.current.gridProps.data.slice();
    edited[3] = { id: "row-3", name: "Edited Name" };
    const change = { source: "edit" as const, ops: [] };
    act(() => result.current.gridProps.onDataChange(edited, change));
    expect(result.current.gridProps.data[3]).toEqual({ id: "row-3", name: "Edited Name" });
    expect(result.current.gridProps.data[0]).toEqual(person(0));
    expect(onDataChange).toHaveBeenCalledWith(edited, change);
  });

  it("keeps rows a request wrote after the store's snapshot was taken", async () => {
    const { result } = await mount(countedServer(20));
    window_(result, { start: 10, end: 20 });
    await settled(result);
    const stale: (Row | undefined)[] = result.current.gridProps.data.slice();
    for (let i = 10; i < 20; i++) stale[i] = undefined;
    stale[2] = { id: "row-2", name: "Edited Name" };
    act(() =>
      result.current.gridProps.onDataChange(stale as Row[], {
        source: "edit",
        ops: [{ type: "update", rowId: "row-2", row: { id: "row-2", name: "Edited Name" }, prev: person(2) }],
      }),
    );
    expect(result.current.gridProps.data[2]?.name).toBe("Edited Name");
    expect(result.current.gridProps.data[17]).toEqual(person(17));
    expect(result.current.gridProps.data.length).toBe(20);
  });

  it("warns once when an edit targets a row evicted before the merge, and writes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = await mount(countedServer(10));
    act(() => result.current.evict({ start: 0, end: 5 }));
    const edit = { source: "edit" as const, ops: [{ type: "update" as const, rowId: "row-2", row: { id: "row-2", name: "Edited" }, prev: person(2) }] };
    act(() => result.current.gridProps.onDataChange([], edit));
    act(() => result.current.gridProps.onDataChange([], edit));
    expect(result.current.gridProps.data[2]).toBeUndefined();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("row-2"))).toHaveLength(1);
  });

  it("applies a length-changing row operation to the latest rows", async () => {
    const { result } = await mount(countedServer(10));
    const next = makeRows(0, 10).filter((r) => r.id !== "row-2");
    act(() => result.current.gridProps.onDataChange(next, { source: "row-operation", ops: [{ type: "delete", rowId: "row-2", row: person(2), index: 2 }] }));
    const data = result.current.gridProps.data;
    expect(data.length).toBe(9);
    expect(data[2]).toEqual(person(3));
    expect(data[8]).toEqual(person(9));
  });
});
