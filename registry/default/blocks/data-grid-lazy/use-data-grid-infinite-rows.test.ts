import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDataGridInfiniteRows, type InfiniteFetchContext } from "./use-data-grid-infinite-rows";

type Row = { id: string };

const rowsOf = (from: number, count: number): Row[] => Array.from({ length: count }, (_, i) => ({ id: `r${from + i}` }));

type Fetch = (ctx: InfiniteFetchContext<number>) => Promise<{ rows: Row[]; nextCursor: number | null }>;

/** A keyset source of `size` rows; the cursor is the index of the next row. */
function source(size: number) {
  return vi.fn<Fetch>(async ({ cursor, limit }) => {
    const from = cursor ?? 0;
    const count = Math.min(limit, size - from);
    return { rows: rowsOf(from, count), nextCursor: from + count < size ? from + count : null };
  });
}

const getRowId = (row: Row) => row.id;
const options = (fetchRows: Fetch, extra = {}) => ({ fetchRows, getRowId, pageSize: 10, overscan: 0, ...extra });
const view = (end: number) => ({ start: 0, end });
const never = () => new Promise<never>(() => {});

afterEach(() => vi.restoreAllMocks());

describe("useDataGridInfiniteRows", () => {
  it("starts with one page of skeleton rows, no total, and no fetch", () => {
    const fetchRows = source(25);
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    expect(result.current.gridProps.data).toHaveLength(10);
    expect(result.current.unloadedCount).toBe(10);
    expect(result.current.total).toBeUndefined();
    expect(result.current.hasMore).toBe(true);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("fetches the first page with an undefined cursor and grows by one page of skeletons", async () => {
    const fetchRows = source(25);
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledWith({ cursor: undefined, start: 0, limit: 10, signal: expect.any(AbortSignal) });
    expect(result.current.gridProps.data).toHaveLength(20);
    expect(result.current.gridProps.data[9]).toEqual({ id: "r9" });
    expect(result.current.gridProps.data[10]).toBeUndefined();
    expect(result.current.unloadedCount).toBe(10);
  });

  it("chains the cursor, one page at a time, while the window reaches the end", async () => {
    const fetchRows = source(25);
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    act(() => result.current.gridProps.onRenderedRowsChange(view(10)));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    act(() => result.current.gridProps.onRenderedRowsChange(view(10)));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2));
    expect(fetchRows.mock.calls[1]![0]).toMatchObject({ cursor: 10, start: 10 });
  });

  it("ends on a null cursor: exact length, final total, no skeletons", async () => {
    const fetchRows = source(25);
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    act(() => result.current.gridProps.onRenderedRowsChange(view(30)));
    await waitFor(() => expect(result.current.total).toBe(25));
    expect(result.current.hasMore).toBe(false);
    expect(result.current.gridProps.data).toHaveLength(25);
    expect(result.current.unloadedCount).toBe(0);
    act(() => result.current.gridProps.onRenderedRowsChange(view(30)));
    expect(fetchRows).toHaveBeenCalledTimes(3);
  });

  it("treats a cursor of 0 as more rows", async () => {
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: rowsOf(0, 10), nextCursor: 0 }));
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(result.current.gridProps.data[0]).toBeDefined());
    expect(result.current.hasMore).toBe(true);
  });

  it("does not fetch while the window stays far from the loaded end (overscan)", async () => {
    const fetchRows = source(100);
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows, { overscan: 2 })));
    act(() => result.current.gridProps.onRenderedRowsChange(view(3)));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const calls = fetchRows.mock.calls.length;
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    expect(fetchRows).toHaveBeenCalledTimes(calls);
  });

  it("an empty page ends the source and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn<Fetch>(async () => ({ rows: [], nextCursor: 5 }));
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.total).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a rejected fetch calls onError, stops the chain, and retries on the next window report", async () => {
    const onError = vi.fn();
    let fail = true;
    const fetchRows = vi.fn<Fetch>(async () => {
      if (fail) throw new Error("down");
      return { rows: rowsOf(0, 10), nextCursor: null };
    });
    const { result } = renderHook(() => useDataGridInfiniteRows({ ...options(fetchRows), onError }));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);
    fail = false;
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(result.current.total).toBe(10));
  });

  it("a non-array rows answer counts as a failed fetch", async () => {
    const onError = vi.fn();
    const fetchRows = vi.fn(async () => ({ rows: "oops", nextCursor: null }));
    const { result } = renderHook(() => useDataGridInfiniteRows({ ...options(fetchRows as unknown as Fetch), onError }));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(result.current.unloadedCount).toBe(10);
  });

  it("reset aborts the fetch, drops rows and cursor, and refetches the first page", async () => {
    let calls = 0;
    const fetchRows = vi.fn<Fetch>(() => (++calls === 1 ? never() : Promise.resolve({ rows: rowsOf(100, 10), nextCursor: null })));
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    const first = fetchRows.mock.calls[0]![0].signal;
    expect(first.aborted).toBe(false);
    act(() => result.current.reset());
    expect(first.aborted).toBe(true);
    await waitFor(() => expect(result.current.gridProps.data[0]).toEqual({ id: "r100" }));
    expect(fetchRows.mock.calls[1]![0].cursor).toBeUndefined();
  });

  it("aborts the fetch on unmount", () => {
    const fetchRows = vi.fn<Fetch>(never);
    const { result, unmount } = renderHook(() => useDataGridInfiniteRows(options(fetchRows)));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    unmount();
    expect(fetchRows.mock.calls[0]![0].signal.aborted).toBe(true);
  });

  it("merges edits into loaded rows and keeps the skeletons", async () => {
    const { result } = renderHook(() => useDataGridInfiniteRows(options(source(25))));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(result.current.gridProps.data[0]).toBeDefined());
    const edited = { id: "r0", name: "x" } as Row;
    act(() => result.current.onDataChange([], { source: "edit", ops: [{ type: "update", rowId: "r0", row: edited, index: 0 }] } as never));
    expect(result.current.gridProps.data[0]).toMatchObject({ name: "x" });
    expect(result.current.gridProps.data).toHaveLength(20);
  });

  it("a deleted row shrinks the loaded length", async () => {
    const { result } = renderHook(() => useDataGridInfiniteRows(options(source(25))));
    act(() => result.current.gridProps.onRenderedRowsChange(view(5)));
    await waitFor(() => expect(result.current.gridProps.data[0]).toBeDefined());
    act(() => result.current.onDataChange([], { source: "row-operation", ops: [{ type: "delete", rowId: "r0", row: { id: "r0" }, index: 0 }] } as never));
    expect(result.current.gridProps.data).toHaveLength(19);
    expect(result.current.gridProps.data[0]).toEqual({ id: "r1" });
  });

  it("caps limit at maxFetchRows", () => {
    const fetchRows = source(100);
    const { result } = renderHook(() => useDataGridInfiniteRows(options(fetchRows, { maxFetchRows: 4 })));
    act(() => result.current.gridProps.onRenderedRowsChange(view(3)));
    expect(fetchRows.mock.calls[0]![0].limit).toBe(4);
  });

  it("gives skeleton rows a placeholder id", () => {
    const { result } = renderHook(() => useDataGridInfiniteRows(options(source(5))));
    expect(result.current.gridProps.getRowId(undefined as never, 3)).toContain("3");
  });
});
