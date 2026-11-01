import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RowRange } from "@/registry/default/blocks/data-grid/data-grid";
import type { ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridLazyRows, type LazyFetchContext } from "./use-data-grid-lazy-rows";

type Row = { id: string; name: string };

function makeRows(start: number, end: number): Row[] {
  const rows: Row[] = [];
  for (let i = start; i < end; i++) rows.push({ id: `row-${i}`, name: `Person ${i}` });
  return rows;
}

describe("useDataGridLazyRows", () => {
  it("starts fully unloaded (every slot a hole) at the right length", () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() => useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id }));
    expect(result.current.gridProps.data.length).toBe(1000);
    expect(result.current.unloadedCount).toBe(1000);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("fetches an expanded range (overscan + batchSize rounding) on the first onRenderedRowsChange", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 10, pageSize: 50 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 100, end: 130 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(1);
    // [100,130) + 10 overscan each side -> [90,140), rounded to 50 -> [50,150)
    expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({ start: 50, end: 150 }));
    expect(result.current.gridProps.data[60]).toEqual({ id: "row-60", name: "Person 60" });
    expect(result.current.gridProps.data[0]).toBeUndefined();
    expect(result.current.unloadedCount).toBe(1000 - 100);
  });

  it("never re-fetches an already-loaded range on a subsequent overlapping window", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 50 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);

    // fully inside the already-loaded [0,50) range.
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 10, end: 40 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it("only fetches the uncovered gap when a window partially overlaps a loaded range", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 25, end: 75 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(fetchRows).toHaveBeenNthCalledWith(2, expect.objectContaining({ start: 50, end: 75 }));
  });

  it("dedups two overlapping in-flight requests fired before either resolves", async () => {
    let resolveFetch: ((rows: Row[]) => void) | undefined;
    const fetchRows = vi.fn(
      ({ start, end }: LazyFetchContext) =>
        new Promise<Row[]>((resolve) => {
          resolveFetch = () => resolve(makeRows(start, end));
        }),
    );
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 50 }));
    // same range again while the first fetch is still in flight — must not trigger a second call.
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 50 }));
    expect(fetchRows).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.([]);
      await Promise.resolve();
    });
  });

  it("clamps an over-long fetch response to [start, end) and dev-warns on the mismatch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end + 10));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.gridProps.data[49]).toEqual({ id: "row-49", name: "Person 49" });
    // the over-long tail must NOT leak into the adjacent (unloaded) range
    expect(result.current.gridProps.data[50]).toBeUndefined();
    expect(result.current.unloadedCount).toBe(1000 - 50);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("60"))).toBe(true);
    warn.mockRestore();
  });

  it("marks only actually written rows loaded when a fetch response is short, and dev-warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn(async () => makeRows(0, 10));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.gridProps.data[9]).toEqual({ id: "row-9", name: "Person 9" });
    expect(result.current.gridProps.data[10]).toBeUndefined();
    // the shortfall stays unloaded (not permanently poisoned as loaded)
    expect(result.current.unloadedCount).toBe(1000 - 10);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("10"))).toBe(true);
    warn.mockRestore();
  });

  it("reverts a failed range to unloaded, calls onError, and refetches it the next time it's visible", async () => {
    let callCount = 0;
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => {
      callCount++;
      if (callCount === 1) throw new Error("network down");
      return makeRows(start, end);
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, onError }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.unloadedCount).toBe(1000);
    expect(result.current.gridProps.data[5]).toBeUndefined();

    // same range requested again (e.g. scrolled back into view) -> refetches, this time succeeding.
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("catches a fetchRows that throws synchronously instead of returning a rejected promise, and still un-sticks the range for a later retry", async () => {
    let callCount = 0;
    const fetchRows = vi.fn(({ start, end }: LazyFetchContext) => {
      callCount++;
      if (callCount === 1) throw new Error("sync boom");
      return Promise.resolve(makeRows(start, end));
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, onError }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("aborts every in-flight fetch on unmount", async () => {
    const fetchRows = vi.fn(
      ({ signal }: LazyFetchContext) =>
        new Promise<Row[]>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { result, unmount } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    let capturedSignal: AbortSignal | undefined;
    fetchRows.mockImplementationOnce(({ signal }: LazyFetchContext) => {
      capturedSignal = signal;
      return new Promise<Row[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("merges adjacent loaded ranges so a later gap-fill query sees one covered span, not two", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 25 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 25, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // now request a window that spans across both merged loaded ranges plus a small gap.
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 60 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(3);
    expect(fetchRows).toHaveBeenNthCalledWith(3, expect.objectContaining({ start: 50, end: 60 }));
  });

  it("resets to fully unloaded when total changes", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result, rerender } = renderHook(
      (props: { total: number }) =>
        useDataGridLazyRows({ total: props.total, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
      { initialProps: { total: 1000 } },
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unloadedCount).toBe(980);

    rerender({ total: 500 });
    expect(result.current.gridProps.data.length).toBe(500);
    expect(result.current.unloadedCount).toBe(500);
  });

  it("onDataChange merges an edited array back into the sparse rows", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const edited = result.current.gridProps.data.slice();
    edited[3] = { id: "row-3", name: "Edited Name" };
    act(() => result.current.onDataChange(edited, { source: "edit", ops: [] }));

    expect(result.current.gridProps.data[3]).toEqual({ id: "row-3", name: "Edited Name" });
    expect(result.current.gridProps.data[0]).toEqual({ id: "row-0", name: "Person 0" });
  });

  it("onDataChange keeps rows a fetch wrote after the store's snapshot was taken", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.gridProps.data[7]).toEqual({ id: "row-7", name: "Person 7" });

    // The store's snapshot predates the rows just landed in [5,10): its `next` still has holes
    // there, but the operations apply to the same row ids, so the merge must keep the landed rows.
    const staleNext: (Row | undefined)[] = result.current.gridProps.data.slice();
    for (let i = 5; i < 10; i++) staleNext[i] = undefined;
    staleNext[2] = { id: "row-2", name: "Edited Name" };
    act(() =>
      result.current.onDataChange(staleNext as Row[], {
        source: "edit",
        ops: [{ type: "update", rowId: "row-2", row: { id: "row-2", name: "Edited Name" }, prev: { id: "row-2", name: "Person 2" } }],
      }),
    );

    expect(result.current.gridProps.data[2]).toEqual({ id: "row-2", name: "Edited Name" });
    expect(result.current.gridProps.data[7]).toEqual({ id: "row-7", name: "Person 7" });
    expect(result.current.gridProps.data.length).toBe(10);
  });

  it("onDataChange dev-warns once when an edit targets a row evicted before the merge, and writes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.evict({ start: 0, end: 5 }));

    const edit = {
      source: "edit" as const,
      ops: [{ type: "update" as const, rowId: "row-2", row: { id: "row-2", name: "Edited" }, prev: { id: "row-2", name: "Person 2" } }],
    };
    act(() => result.current.onDataChange([], edit));
    act(() => result.current.onDataChange([], edit));

    expect(result.current.gridProps.data[2]).toBeUndefined();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("row-2"))).toHaveLength(1);
    warn.mockRestore();
  });

  it("onDataChange warns when the eviction and the edit land in the same batch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.evict({ start: 0, end: 5 });
      result.current.onDataChange([], {
        source: "edit",
        ops: [{ type: "update", rowId: "row-2", row: { id: "row-2", name: "Edited" }, prev: { id: "row-2", name: "Person 2" } }],
      });
    });

    expect(warn.mock.calls.filter((c) => String(c[0]).includes("row-2"))).toHaveLength(1);
    warn.mockRestore();
  });

  it("onDataChange applies a length-changing row op (delete) to the latest state, keeping alignment", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const next = [
      { id: "row-0", name: "Person 0" },
      { id: "row-1", name: "Person 1" },
      { id: "row-3", name: "Person 3" },
      { id: "row-4", name: "Person 4" },
      { id: "row-5", name: "Person 5" },
      { id: "row-6", name: "Person 6" },
      { id: "row-7", name: "Person 7" },
      { id: "row-8", name: "Person 8" },
      { id: "row-9", name: "Person 9" },
    ];
    act(() =>
      result.current.onDataChange(next, {
        source: "row-operation",
        ops: [{ type: "delete", rowId: "row-2", row: { id: "row-2", name: "Person 2" }, index: 2 }],
      }),
    );

    const data = result.current.gridProps.data;
    expect(data.length).toBe(9);
    expect(data[2]).toEqual({ id: "row-3", name: "Person 3" });
    expect(data[8]).toEqual({ id: "row-9", name: "Person 9" });
  });

  it("uses an index-derived placeholder id for unloaded rows via gridProps.getRowId", () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id }),
    );

    const id = result.current.gridProps.getRowId(undefined as unknown as Row, 7);
    expect(id).toContain("7");
    expect(result.current.gridProps.getRowId({ id: "row-7", name: "x" }, 7)).toBe("row-7");
  });

  // options.getRowId must accept core's 2-arg (row, index) shape, matching
  // DataGrid's own getRowId, so an index-derived fallback id compiles and resolves correctly.
  it("passes the loaded row's real index through to a 2-arg consumer getRowId", () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const indexedGetRowId = (row: Row, index: number) => row.id ?? `row-${index}`;
    const { result } = renderHook(() => useDataGridLazyRows({ total: 10, fetchRows, getRowId: indexedGetRowId }));

    expect(result.current.gridProps.getRowId({ id: "row-3", name: "x" }, 3)).toBe("row-3");
  });

  it("reset() aborts in-flight fetches, drops all loaded rows, and refetches on the next window", async () => {
    let resolveFetch: ((rows: Row[]) => void) | undefined;
    const fetchRows = vi.fn(({ signal }: LazyFetchContext) => {
      return new Promise<Row[]>((resolve, reject) => {
        resolveFetch = (rows: Row[]) => resolve(rows);
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    expect(result.current.isLoading).toBe(true);

    act(() => result.current.reset());
    expect(result.current.unloadedCount).toBe(1000);
    expect(result.current.gridProps.data[5]).toBeUndefined();
    expect(fetchRows.mock.calls[0]![0].signal.aborted).toBe(true);

    // the old fetch rejects via its abort listener after the reset — it must not write stale rows.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.gridProps.data[5]).toBeUndefined();

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveFetch?.(makeRows(0, 20));
      await Promise.resolve();
    });
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("reset() re-requests the last reported window, so visible rows refetch without a scroll", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);

    act(() => result.current.reset());
    expect(fetchRows).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenNthCalledWith(2, expect.objectContaining({ start: 0, end: 20 }));
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("an aborted fetch that settles after a replacement started does not clear the replacement's bookkeeping", async () => {
    let resolveFirst: ((rows: Row[]) => void) | undefined;
    let resolveSecond: ((rows: Row[]) => void) | undefined;
    const fetchRows = vi.fn((_ctx: LazyFetchContext) => {
      const call = fetchRows.mock.calls.length;
      return new Promise<Row[]>((resolve) => {
        if (call === 1) resolveFirst = resolve;
        if (call === 2) resolveSecond = resolve;
      });
    });
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    act(() => result.current.reset());
    // reset aborted the first fetch, and the post-reset effect re-requested the same window (call 2).
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveFirst?.(makeRows(0, 20));
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(true);
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.gridProps.data[5]).toBeUndefined();

    await act(async () => {
      resolveSecond?.(makeRows(0, 20));
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("contains a throwing onLoaded: the error is logged and the fetch bookkeeping stays intact", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onLoaded = vi.fn(() => {
      throw new Error("consumer bug");
    });
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, onLoaded }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
    error.mockRestore();
  });

  it("evict() holes the evicted range (keeping the rest of a partially overlapping loaded range) and refetches on the next window covering it", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unloadedCount).toBe(50);

    act(() => result.current.evict({ start: 10, end: 20 }));
    expect(result.current.gridProps.data[15]).toBeUndefined();
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
    expect(result.current.unloadedCount).toBe(60);

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 12, end: 18 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(fetchRows).toHaveBeenNthCalledWith(2, expect.objectContaining({ start: 12, end: 18 }));
    expect(result.current.gridProps.data[15]).toEqual({ id: "row-15", name: "Person 15" });
  });

  it("evict() does not abort an in-flight fetch: its resolution still marks the range loaded", async () => {
    let resolveFetch: ((rows: Row[]) => void) | undefined;
    const fetchRows = vi.fn((_ctx: LazyFetchContext) => {
      return new Promise<Row[]>((resolve) => {
        resolveFetch = (rows: Row[]) => resolve(rows);
      });
    });
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    act(() => result.current.evict({ start: 0, end: 20 }));
    expect(result.current.gridProps.data[5]).toBeUndefined();

    await act(async () => {
      resolveFetch?.(makeRows(0, 20));
      await Promise.resolve();
    });
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
    expect(result.current.unloadedCount).toBe(80);
  });

  it("evict() is a no-op for unloaded and out-of-range targets, and clamps to [0, total]", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.evict({ start: 50, end: 60 }));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 20 }]);

    act(() => result.current.evict({ start: 100, end: 200 }));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 20 }]);

    act(() => result.current.evict({ start: -10, end: 5 }));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 5, end: 20 }]);
    expect(result.current.gridProps.data[3]).toBeUndefined();
    expect(result.current.gridProps.data[7]).toEqual({ id: "row-7", name: "Person 7" });
  });

  it("getLoadedRanges() returns a merged snapshot and a copy, and is empty after reset()", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1 }),
    );

    expect(result.current.getLoadedRanges()).toEqual([]);

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 10, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 20 }]);

    const snapshot = result.current.getLoadedRanges() as RowRange[];
    snapshot.push({ start: 90, end: 95 });
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 20 }]);

    act(() => result.current.reset());
    expect(result.current.getLoadedRanges()).toEqual([]);
  });

  it("onLoaded fires with the actually written range after a fetch resolves", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const onLoaded = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, onLoaded }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith({ start: 0, end: 20 });
  });

  it("onLoaded is clamped for a short response and skipped when nothing was written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn(async ({ start }: LazyFetchContext) => (start === 30 ? [] : makeRows(start, start + 5)));
    const onLoaded = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, onLoaded }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith({ start: 0, end: 5 });

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 30, end: 40 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("onLoaded is not fired for aborted or rejected fetches", async () => {
    const fetchRows = vi.fn(({ signal }: LazyFetchContext) => {
      return new Promise<Row[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const onLoaded = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, onLoaded }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    unmount();
    expect(onLoaded).not.toHaveBeenCalled();

    const failingFetchRows = vi.fn(async () => {
      throw new Error("down");
    });
    const { result: result2 } = renderHook(() =>
      useDataGridLazyRows({
        total: 100,
        fetchRows: failingFetchRows,
        getRowId: (r: Row) => r.id,
        overscan: 0,
        pageSize: 1,
        onLoaded,
      }),
    );
    act(() => result2.current.gridProps.onRenderedRowsChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result2.current.isLoading).toBe(false));
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("maxFetchRows splits a wide gap into consecutive chunked fetches of at most the cap", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, maxFetchRows: 20 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 45 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(3);
    expect(fetchRows).toHaveBeenNthCalledWith(1, expect.objectContaining({ start: 0, end: 20 }));
    expect(fetchRows).toHaveBeenNthCalledWith(2, expect.objectContaining({ start: 20, end: 40 }));
    expect(fetchRows).toHaveBeenNthCalledWith(3, expect.objectContaining({ start: 40, end: 45 }));
    expect(result.current.gridProps.data[44]).toEqual({ id: "row-44", name: "Person 44" });
    expect(result.current.unloadedCount).toBe(1000 - 45);
  });

  it("maxFetchRows still dedups: covered chunks are never re-fetched, new gaps fetch only their uncovered part", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 1, maxFetchRows: 20 }),
    );

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 45 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(3);

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 5, end: 40 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(3);

    act(() => result.current.gridProps.onRenderedRowsChange({ start: 40, end: 60 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(4);
    expect(fetchRows).toHaveBeenNthCalledWith(4, expect.objectContaining({ start: 45, end: 60 }));
  });

});

describe("useDataGridLazyRows: gridProps", () => {
  it("carries totalRowCount, so the provider needs no second count", () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result } = renderHook(() => useDataGridLazyRows({ total: 321, fetchRows, getRowId: (r: Row) => r.id }));
    expect(result.current.gridProps.totalRowCount).toBe(321);
  });
});

describe("useDataGridLazyRows: spec and retry", () => {
  const specOf = (searchText: string): ServerSpec => ({ sorts: [], filters: [], searchText });

  it("hands the spec to fetchRows and resets when its content changes", async () => {
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => makeRows(start, end));
    const { result, rerender } = renderHook(({ spec }: { spec: ServerSpec }) => useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 10, spec }), { initialProps: { spec: specOf("a") } });
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows.mock.calls[0]![0].spec.searchText).toBe("a");
    rerender({ spec: specOf("a") });
    expect(fetchRows).toHaveBeenCalledTimes(1);
    rerender({ spec: specOf("b") });
    await waitFor(() => expect(fetchRows.mock.calls.at(-1)![0].spec.searchText).toBe("b"));
    expect(result.current.gridProps.data[0]).toBeDefined();
  });

  it("retry fetches the failed window again", async () => {
    let fail = true;
    const fetchRows = vi.fn(async ({ start, end }: LazyFetchContext) => {
      if (fail) throw new Error("down");
      return makeRows(start, end);
    });
    const { result } = renderHook(() => useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, pageSize: 10, onError: () => {} }));
    act(() => result.current.gridProps.onRenderedRowsChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    fail = false;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.gridProps.data[0]).toBeDefined());
  });
});
