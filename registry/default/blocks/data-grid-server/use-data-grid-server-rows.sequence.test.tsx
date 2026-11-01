import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RowRange, ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridServerRows, type ServerRowsAnswer, type ServerRowsRequest, type UseDataGridServerRowsScrollOptions } from "./use-data-grid-server-rows";

type Row = { id: string; name?: string };
type Fetch = (request: ServerRowsRequest<number>) => Promise<ServerRowsAnswer<Row, number>>;

const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}` }));

/** A keyset source of `size` rows; the cursor is the index of the next row. */
function keyset(size: number) {
  return vi.fn<Fetch>(async ({ cursor, start, end }) => {
    const from = cursor ?? 0;
    const count = Math.min(end - start, size - from);
    return { rows: rowsOf(from, count), nextCursor: from + count < size ? from + count : null };
  });
}

const never = () => new Promise<never>(() => {});
const view = (end: number): RowRange => ({ start: 0, end });
type Extra = Partial<UseDataGridServerRowsScrollOptions<Row, number>>;
const optionsOf = (fetchRows: Fetch, extra: Extra = {}): UseDataGridServerRowsScrollOptions<Row, number> => ({ mode: "scroll", getRowId: (r) => r.id, fetchRows, blockSize: 10, overscan: 0, ...extra });

function mount(fetchRows: Fetch, extra: Extra = {}) {
  return renderHook(() => useDataGridServerRows<Row, number>(optionsOf(fetchRows, extra)));
}
type Hook = ReturnType<typeof mount>["result"];

const settled = (result: Hook) => waitFor(() => expect(result.current.loading).toBe(false));
const report = (result: Hook, range: RowRange) => act(() => result.current.gridProps.onRenderedRowsChange(range));
const spyWarn = () => vi.spyOn(console, "warn").mockImplementation(() => {});
const warningsAbout = (warn: ReturnType<typeof spyWarn>, text: string) => warn.mock.calls.filter((c) => String(c[0]).includes(text));

afterEach(() => vi.restoreAllMocks());

describe("scroll mode, sequential: the first block decides", () => {
  it("a cursor answer loads rows plus one block of skeletons, with no count", async () => {
    const fetchRows = keyset(25);
    const { result } = mount(fetchRows);
    await settled(result);
    expect(fetchRows.mock.calls[0]![0]).toMatchObject({ start: 0, end: 10, cursor: undefined });
    expect(result.current.gridProps.data).toHaveLength(20);
    expect(result.current.gridProps.data[9]).toEqual({ id: "r9" });
    expect(result.current.gridProps.data[10]).toBeUndefined();
    expect(result.current.unloadedCount).toBe(10);
    expect(result.current.totalRowCount).toBeNull();
    expect(result.current.gridProps.totalRowCount).toBeNull();
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]);
  });

  it("an answer with a count and no cursor stays random access", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => ({ rows: rowsOf(start, end - start), totalRowCount: 500 }));
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(500);
    expect(result.current.unloadedCount).toBe(490);
  });

  it("an answer with neither a count nor a cursor loads by offset while hasMore", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => ({ rows: rowsOf(start, Math.min(end, 25) - start), hasMore: end < 25 }));
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(20);
    report(result, view(10));
    await settled(result);
    expect(fetchRows.mock.calls[1]![0]).toMatchObject({ start: 10, end: 20, cursor: undefined });
    report(result, view(20));
    await waitFor(() => expect(result.current.totalRowCount).toBe(25));
    expect(result.current.gridProps.data).toHaveLength(25);
  });

  it("a short answer without hasMore ends an offset source", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ start }) => ({ rows: rowsOf(start, 4) }));
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(4);
    expect(result.current.totalRowCount).toBe(4);
    expect(result.current.unloadedCount).toBe(0);
  });

  it("a count that comes with a cursor feeds totalRowCount and caps the skeletons", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
      const from = cursor ?? 0;
      const count = Math.min(end - start, 14 - from);
      return { rows: rowsOf(from, count), totalRowCount: 14, nextCursor: from + count < 14 ? from + count : null };
    });
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.totalRowCount).toBe(14);
    expect(result.current.gridProps.data).toHaveLength(14);
    expect(result.current.unloadedCount).toBe(4);
    report(result, view(14));
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(14);
    expect(result.current.unloadedCount).toBe(0);
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });
});

describe("scroll mode, sequential: the chain", () => {
  it("chains the cursor one block at a time while the window reaches the end", async () => {
    const fetchRows = keyset(25);
    const { result } = mount(fetchRows);
    await settled(result);
    report(result, view(10));
    report(result, view(10));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    await settled(result);
    expect(fetchRows.mock.calls[1]![0]).toMatchObject({ cursor: 10, start: 10, end: 20 });
  });

  it("ends at a null cursor: exact length, final count, no skeletons, no more requests", async () => {
    const fetchRows = keyset(25);
    const { result } = mount(fetchRows);
    await settled(result);
    report(result, view(30));
    await waitFor(() => expect(result.current.totalRowCount).toBe(25));
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(25);
    expect(result.current.unloadedCount).toBe(0);
    expect(result.current.gridProps.totalRowCount).toBe(25);
    report(result, view(30));
    expect(fetchRows).toHaveBeenCalledTimes(3);
  });

  it("hasMore: false ends the source even with a cursor", async () => {
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 10), nextCursor: 10, hasMore: false }));
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.totalRowCount).toBe(10);
    expect(result.current.gridProps.data).toHaveLength(10);
  });

  it("treats a cursor of 0 as more rows", async () => {
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 10), nextCursor: 0 }));
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(20);
    expect(result.current.totalRowCount).toBeNull();
  });

  it("does not fetch while the window stays far from the loaded end (overscan)", async () => {
    const fetchRows = keyset(100);
    const { result } = mount(fetchRows, { overscan: 2 });
    await settled(result);
    report(result, view(5));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    report(result, view(8));
    await settled(result);
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });

  it("the same cursor twice ends the chain with one warning", async () => {
    const warn = spyWarn();
    const fetchRows = vi.fn<Fetch>(async ({ start, end }) => ({ rows: rowsOf(start, end - start), nextCursor: 7 }));
    const { result } = mount(fetchRows);
    await settled(result);
    report(result, view(10));
    await waitFor(() => expect(result.current.totalRowCount).toBe(20));
    report(result, view(20));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.gridProps.data).toHaveLength(20);
    expect(warningsAbout(warn, "cursor")).toHaveLength(1);
  });

  it("an empty page ends the source and does not ask again", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ cursor }) => (cursor === undefined ? { rows: rowsOf(0, 10), nextCursor: 10 } : { rows: [], nextCursor: 20 }));
    const { result } = mount(fetchRows);
    await settled(result);
    report(result, view(10));
    await waitFor(() => expect(result.current.totalRowCount).toBe(10));
    expect(result.current.gridProps.data).toHaveLength(10);
    report(result, view(10));
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });

  it("keeps the first block of rows of a longer answer and warns once", async () => {
    const warn = spyWarn();
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 15), nextCursor: null }));
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.totalRowCount).toBe(10);
    expect(warningsAbout(warn, "15 rows")).toHaveLength(1);
  });

  it("keeps the rows of the chain when blocks land in one frame", async () => {
    const fetchRows = keyset(100);
    const { result } = mount(fetchRows, { blockSize: 5 });
    await settled(result);
    for (let end = 5; end <= 40; end += 5) {
      report(result, view(end));
      await settled(result);
    }
    expect(result.current.gridProps.data[39]).toEqual({ id: "r39" });
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 45 }]);
  });
});

describe("scroll mode, sequential: errors and retry", () => {
  it("a rejected block sets the error, calls onError, stops the chain, and the next window report asks again", async () => {
    const onError = vi.fn();
    let fail = false;
    const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
      if (fail && cursor !== undefined) throw new Error("down");
      return { rows: rowsOf(cursor ?? 0, end - start), nextCursor: (cursor ?? 0) + (end - start) };
    });
    const { result } = mount(fetchRows, { onError });
    await settled(result);
    fail = true;
    report(result, view(10));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await settled(result);
    expect(result.current.status).toBe("error");
    expect(fetchRows).toHaveBeenCalledTimes(2);
    fail = false;
    report(result, view(10));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.gridProps.data[15]).toEqual({ id: "r15" });
    expect(result.current.error).toBeNull();
  });

  it("a failed first block waits for retry", async () => {
    let fail = true;
    const fetchRows = vi.fn<Fetch>(async () => {
      if (fail) throw new Error("down");
      return { rows: rowsOf(0, 10), nextCursor: null };
    });
    const { result } = mount(fetchRows, { onError: () => {} });
    await waitFor(() => expect(result.current.status).toBe("error"));
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.totalRowCount).toBe(10));
  });

  it("retry repeats the failed block with the cursor it sent", async () => {
    let fail = false;
    const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
      if (fail && cursor === 10) throw new Error("down");
      const from = cursor ?? 0;
      return { rows: rowsOf(from, end - start), nextCursor: from + 10 };
    });
    const { result } = mount(fetchRows, { onError: () => {} });
    await settled(result);
    fail = true;
    report(result, view(10));
    await waitFor(() => expect(result.current.status).toBe("error"));
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ cursor: 10, start: 10, end: 20 });
    expect(result.current.gridProps.data[15]).toEqual({ id: "r15" });
  });

  it("a non-array rows answer counts as a failed request", async () => {
    const onError = vi.fn();
    const fetchRows = vi.fn(async () => ({ rows: "oops", nextCursor: null }));
    const { result } = mount(fetchRows as unknown as Fetch, { onError });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current.gridProps.data).toHaveLength(0);
  });

  it("a throwing onLoaded cannot stop the chain", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = mount(keyset(25), { onLoaded: () => { throw new Error("consumer bug"); } });
    await settled(result);
    expect(result.current.gridProps.data[3]).toEqual({ id: "r3" });
  });
});

describe("scroll mode, sequential: spec, aborts, and races", () => {
  const specOf = (searchText: string): ServerSpec => ({ sorts: [], filters: [], searchText });

  it("a spec change mid-chain drops the old chain and restarts at block 0 with no cursor", async () => {
    const pending: Array<{ spec: ServerSpec; cursor: number | undefined; signal: AbortSignal; resolve: () => void }> = [];
    const fetchRows = vi.fn<Fetch>(
      ({ spec, cursor, signal, start, end }) =>
        new Promise((resolve) => {
          pending.push({ spec, cursor, signal, resolve: () => resolve({ rows: rowsOf(start, end - start).map((r) => ({ ...r, name: spec.searchText })), nextCursor: end }) });
        }),
    );
    const { result } = mount(fetchRows);
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0]!.resolve());
    report(result, view(10));
    await waitFor(() => expect(pending).toHaveLength(2));
    act(() => result.current.gridProps.onSearchTextChange("b"));
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(pending[1]!.signal.aborted).toBe(true);
    expect(pending[2]).toMatchObject({ cursor: undefined });
    expect(pending[2]!.spec.searchText).toBe("b");
    expect(result.current.gridProps.data).toHaveLength(0);
    report(result, view(5));
    await act(async () => pending[1]!.resolve());
    expect(result.current.gridProps.data).toHaveLength(0);
    await act(async () => pending[2]!.resolve());
    await settled(result);
    expect(result.current.gridProps.data[0]?.name).toBe("b");
    expect(result.current.gridProps.data).toHaveLength(20);
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]);
  });

  it("a content change of a controlled spec restarts the chain; an equal spec does not", async () => {
    const fetchRows = keyset(25);
    const { result, rerender } = renderHook(({ spec }: { spec: ServerSpec }) => useDataGridServerRows<Row, number>(optionsOf(fetchRows, { spec })), { initialProps: { spec: specOf("a") } });
    await settled(result);
    rerender({ spec: specOf("a") });
    expect(fetchRows).toHaveBeenCalledTimes(1);
    rerender({ spec: specOf("b") });
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.searchText).toBe("b"));
    expect(fetchRows.mock.calls.at(-1)![0].cursor).toBeUndefined();
  });

  it("a server sort change restarts the chain with the sort in the request", async () => {
    const fetchRows = keyset(25);
    const { result } = mount(fetchRows);
    await settled(result);
    report(result, view(10));
    await settled(result);
    act(() => result.current.gridProps.onSortChange([{ columnId: "name", direction: "asc" }]));
    await waitFor(() => expect(fetchRows.mock.calls.some(([request]) => request.spec.sorts.length === 1)).toBe(true));
    expect(fetchRows.mock.calls.find(([request]) => request.spec.sorts.length === 1)![0]).toMatchObject({ start: 0, cursor: undefined });
    expect(result.current.gridProps).toMatchObject({ sortMode: "server", filterMode: "server", keepCheckedRows: true });
  });

  it("the source may switch its kind after a spec change", async () => {
    const fetchRows = vi.fn<Fetch>(async ({ spec, start, end }) =>
      spec.searchText === "" ? { rows: rowsOf(start, end - start), nextCursor: end } : { rows: rowsOf(start, Math.min(end, 300) - start), totalRowCount: 300 },
    );
    const { result } = mount(fetchRows);
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(20);
    act(() => result.current.gridProps.onSearchTextChange("x"));
    await waitFor(() => expect(result.current.totalRowCount).toBe(300));
    expect(result.current.gridProps.data).toHaveLength(300);
  });

  it("aborts the request on unmount", async () => {
    const fetchRows = vi.fn<Fetch>(never);
    const { unmount } = mount(fetchRows);
    await waitFor(() => expect(fetchRows).toHaveBeenCalled());
    unmount();
    expect(fetchRows.mock.calls[0]![0].signal.aborted).toBe(true);
  });

  it("StrictMode double mount fetches block 0 once", async () => {
    const fetchRows = keyset(25);
    const { result } = renderHook(() => useDataGridServerRows<Row, number>(optionsOf(fetchRows)), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
    await settled(result);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    expect(result.current.gridProps.data).toHaveLength(20);
  });
});

describe("scroll mode, sequential: edits", () => {
  it("merges an edit into a loaded row and keeps the skeletons", async () => {
    const { result } = mount(keyset(25));
    await settled(result);
    const edited = { id: "r0", name: "x" };
    act(() => result.current.gridProps.onDataChange([], { source: "edit", ops: [{ type: "update", rowId: "r0", row: edited, prev: { id: "r0" } }] } as never));
    expect(result.current.gridProps.data[0]).toMatchObject({ name: "x" });
    expect(result.current.gridProps.data).toHaveLength(20);
  });

  it("a deleted row shrinks the loaded length and the next request starts after the shorter list", async () => {
    const fetchRows = keyset(100);
    const { result } = mount(fetchRows);
    await settled(result);
    act(() => result.current.gridProps.onDataChange([], { source: "row-operation", ops: [{ type: "delete", rowId: "r0", row: { id: "r0" }, index: 0 }] } as never));
    expect(result.current.gridProps.data).toHaveLength(19);
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 9 }]);
    report(result, view(9));
    await settled(result);
    expect(fetchRows.mock.calls.at(-1)![0]).toMatchObject({ start: 9, cursor: 10 });
  });

  it("an inserted row grows the loaded length", async () => {
    const { result } = mount(keyset(25));
    await settled(result);
    act(() => result.current.gridProps.onDataChange([], { source: "row-operation", ops: [{ type: "insert", rowId: "new", row: { id: "new" }, index: 0 }] } as never));
    expect(result.current.gridProps.data).toHaveLength(21);
    expect(result.current.gridProps.data[0]).toEqual({ id: "new" });
    expect(result.current.unloadedCount).toBe(10);
  });

  it("the count of an ended source follows inserts and deletes", async () => {
    const { result } = mount(keyset(5));
    await settled(result);
    act(() => result.current.gridProps.onDataChange([], { source: "row-operation", ops: [{ type: "delete", rowId: "r0", row: { id: "r0" }, index: 0 }] } as never));
    expect(result.current.totalRowCount).toBe(4);
    expect(result.current.gridProps.totalRowCount).toBe(4);
  });

  it("an edit made while a block is in flight survives the block", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
      if (cursor === 10) await gate;
      return { rows: rowsOf(start, end - start), nextCursor: end };
    });
    const { result } = mount(fetchRows);
    await settled(result);
    report(result, view(10));
    act(() => result.current.gridProps.onDataChange([], { source: "edit", ops: [{ type: "update", rowId: "r0", row: { id: "r0", name: "x" }, prev: { id: "r0" } }] } as never));
    release();
    await waitFor(() => expect(result.current.gridProps.data[10]).toBeDefined());
    expect(result.current.gridProps.data[0]).toMatchObject({ name: "x" });
  });

  it("gives an unloaded row a placeholder id", async () => {
    const { result } = mount(keyset(25));
    await settled(result);
    expect(result.current.gridProps.getRowId(undefined as never, 13)).toContain("13");
  });
});

describe("scroll mode, sequential: refresh in place", () => {
  it("refetches from the first block, keeps the rows on screen until the answers land, then drops the rows beyond the window", async () => {
    let suffix = "";
    const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
      const from = cursor ?? 0;
      return { rows: rowsOf(from, end - start).map((r) => ({ ...r, name: r.id + suffix })), nextCursor: from + (end - start) };
    });
    const { result } = mount(fetchRows);
    await settled(result);
    report(result, view(10));
    await settled(result);
    report(result, view(20));
    await settled(result);
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 30 }]);
    suffix = "!";
    fetchRows.mockClear();
    report(result, view(8));
    act(() => result.current.refresh());
    expect(result.current.loading).toBe(true);
    expect(result.current.gridProps.data[5]).toEqual({ id: "r5", name: "r5" });
    await settled(result);
    expect(fetchRows.mock.calls[0]![0]).toMatchObject({ start: 0, end: 10, cursor: undefined });
    expect(result.current.gridProps.data[5]).toEqual({ id: "r5", name: "r5!" });
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 10 }]);
    expect(result.current.gridProps.data).toHaveLength(20);
    expect(result.current.gridProps.data[15]).toBeUndefined();
  });

  it("a refresh that finds a shorter source ends it there", async () => {
    let size = 100;
    const fetchRows = vi.fn<Fetch>(async ({ cursor, start, end }) => {
      const from = cursor ?? 0;
      const count = Math.max(0, Math.min(end - start, size - from));
      return { rows: rowsOf(from, count), nextCursor: from + count < size ? from + count : null };
    });
    const { result } = mount(fetchRows);
    await settled(result);
    size = 6;
    act(() => result.current.refresh());
    await settled(result);
    expect(result.current.gridProps.data).toHaveLength(6);
    expect(result.current.totalRowCount).toBe(6);
  });

  it("keeps refresh, retry, and the provider props stable across renders", async () => {
    const { result, rerender } = mount(keyset(25));
    await settled(result);
    const before = result.current;
    rerender();
    expect(result.current.refresh).toBe(before.refresh);
    expect(result.current.retry).toBe(before.retry);
    expect(result.current.gridProps).toBe(before.gridProps);
  });
});
