import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Range } from "./range-math";
import { useDataGridLazyRows } from "./use-data-grid-lazy-rows";

type Row = { id: string; name: string };

function makeRows(start: number, end: number): Row[] {
  const rows: Row[] = [];
  for (let i = start; i < end; i++) rows.push({ id: `row-${i}`, name: `Person ${i}` });
  return rows;
}

describe("useDataGridLazyRows", () => {
  it("starts fully unloaded (every slot a hole) at the right length", () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() => useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id }));
    expect(result.current.gridProps.data.length).toBe(1000);
    expect(result.current.unloadedCount).toBe(1000);
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it("fetches an expanded range (overscan + batchSize rounding) on the first onRowWindowChange", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 10, batchSize: 50 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 100, end: 130 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(1);
    // [100,130) + 10 overscan each side -> [90,140), rounded to 50 -> [50,150)
    expect(fetchRows).toHaveBeenCalledWith(50, 150, expect.any(AbortSignal));
    expect(result.current.gridProps.data[60]).toEqual({ id: "row-60", name: "Person 60" });
    expect(result.current.gridProps.data[0]).toBeUndefined();
    expect(result.current.unloadedCount).toBe(1000 - 100);
  });

  it("never re-fetches an already-loaded range on a subsequent overlapping window", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 50 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);

    // fully inside the already-loaded [0,50) range.
    act(() => result.current.gridProps.onRowWindowChange({ start: 10, end: 40 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it("only fetches the uncovered gap when a window partially overlaps a loaded range", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.gridProps.onRowWindowChange({ start: 25, end: 75 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(fetchRows).toHaveBeenNthCalledWith(2, 50, 75, expect.any(AbortSignal));
  });

  it("dedups two overlapping in-flight requests fired before either resolves", async () => {
    let resolveFetch: ((rows: Row[]) => void) | undefined;
    const fetchRows = vi.fn(
      (start: number, end: number) =>
        new Promise<Row[]>((resolve) => {
          resolveFetch = () => resolve(makeRows(start, end));
        }),
    );
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 50 }));
    // same range again while the first fetch is still in flight — must not trigger a second call.
    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 50 }));
    expect(fetchRows).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.([]);
      await Promise.resolve();
    });
  });

  it("clamps an over-long fetch response to [start, end) and dev-warns on the mismatch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end + 10));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 50 }));
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
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 50 }));
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
    const fetchRows = vi.fn(async (start: number, end: number) => {
      callCount++;
      if (callCount === 1) throw new Error("network down");
      return makeRows(start, end);
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1, onError }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { start: 0, end: 20 });
    expect(result.current.unloadedCount).toBe(1000);
    expect(result.current.gridProps.data[5]).toBeUndefined();

    // same range requested again (e.g. scrolled back into view) -> refetches, this time succeeding.
    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("catches a fetchRows that throws synchronously instead of returning a rejected promise, and still un-sticks the range for a later retry", async () => {
    let callCount = 0;
    const fetchRows = vi.fn((start: number, end: number) => {
      callCount++;
      if (callCount === 1) throw new Error("sync boom");
      return Promise.resolve(makeRows(start, end));
    });
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1, onError }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("aborts every in-flight fetch on unmount", async () => {
    const fetchRows = vi.fn(
      (_start: number, _end: number, signal: AbortSignal) =>
        new Promise<Row[]>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { result, unmount } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    let capturedSignal: AbortSignal | undefined;
    fetchRows.mockImplementationOnce((_start, _end, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<Row[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("merges adjacent loaded ranges so a later gap-fill query sees one covered span, not two", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 25 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.gridProps.onRowWindowChange({ start: 25, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // now request a window that spans across both merged loaded ranges plus a small gap.
    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 60 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(3);
    expect(fetchRows).toHaveBeenNthCalledWith(3, 50, 60, expect.any(AbortSignal));
  });

  it("resets to fully unloaded when total changes", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result, rerender } = renderHook(
      (props: { total: number }) =>
        useDataGridLazyRows({ total: props.total, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
      { initialProps: { total: 1000 } },
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unloadedCount).toBe(980);

    rerender({ total: 500 });
    expect(result.current.gridProps.data.length).toBe(500);
    expect(result.current.unloadedCount).toBe(500);
  });

  it("onDataChange merges an edited array back into the sparse rows", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const edited = result.current.gridProps.data.slice();
    edited[3] = { id: "row-3", name: "Edited Name" };
    act(() => result.current.onDataChange(edited, { source: "edit", ops: [] }));

    expect(result.current.gridProps.data[3]).toEqual({ id: "row-3", name: "Edited Name" });
    expect(result.current.gridProps.data[0]).toEqual({ id: "row-0", name: "Person 0" });
  });

  it("uses an index-derived placeholder id for unloaded rows via gridProps.getRowId", () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 10, fetchRows, getRowId: (r: Row) => r.id }),
    );

    const id = result.current.gridProps.getRowId(undefined as unknown as Row, 7);
    expect(id).toContain("7");
    expect(result.current.gridProps.getRowId({ id: "row-7", name: "x" }, 7)).toBe("row-7");
  });

  // B11 regression: options.getRowId must accept core's 2-arg (row, index) shape, matching
  // DataGrid's own getRowId, so an index-derived fallback id compiles and resolves correctly.
  it("passes the loaded row's real index through to a 2-arg consumer getRowId", () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const indexedGetRowId = (row: Row, index: number) => row.id ?? `row-${index}`;
    const { result } = renderHook(() => useDataGridLazyRows({ total: 10, fetchRows, getRowId: indexedGetRowId }));

    expect(result.current.gridProps.getRowId({ id: "row-3", name: "x" }, 3)).toBe("row-3");
  });

  it("reset() aborts in-flight fetches, drops all loaded rows, and refetches on the next window", async () => {
    let resolveFetch: ((rows: Row[]) => void) | undefined;
    const fetchRows = vi.fn((start: number, end: number, signal: AbortSignal) => {
      return new Promise<Row[]>((resolve, reject) => {
        resolveFetch = (rows: Row[]) => resolve(rows);
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    expect(result.current.isLoading).toBe(true);

    act(() => result.current.reset());
    expect(result.current.unloadedCount).toBe(1000);
    expect(result.current.gridProps.data[5]).toBeUndefined();
    expect(fetchRows.mock.calls[0]![2]!.aborted).toBe(true);

    // the old fetch rejects via its abort listener after the reset — it must not write stale rows.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.gridProps.data[5]).toBeUndefined();

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveFetch?.(makeRows(0, 20));
      await Promise.resolve();
    });
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
  });

  it("evict() holes the evicted range (keeping the rest of a partially overlapping loaded range) and refetches on the next window covering it", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 50 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unloadedCount).toBe(50);

    act(() => result.current.evict({ start: 10, end: 20 }));
    expect(result.current.gridProps.data[15]).toBeUndefined();
    expect(result.current.gridProps.data[5]).toEqual({ id: "row-5", name: "Person 5" });
    expect(result.current.unloadedCount).toBe(60);

    act(() => result.current.gridProps.onRowWindowChange({ start: 12, end: 18 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(2);
    expect(fetchRows).toHaveBeenNthCalledWith(2, 12, 18, expect.any(AbortSignal));
    expect(result.current.gridProps.data[15]).toEqual({ id: "row-15", name: "Person 15" });
  });

  it("evict() does not abort an in-flight fetch: its resolution still marks the range loaded", async () => {
    let resolveFetch: ((rows: Row[]) => void) | undefined;
    const fetchRows = vi.fn((_start: number, _end: number) => {
      return new Promise<Row[]>((resolve) => {
        resolveFetch = (rows: Row[]) => resolve(rows);
      });
    });
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
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
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
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
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1 }),
    );

    expect(result.current.getLoadedRanges()).toEqual([]);

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 10 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.gridProps.onRowWindowChange({ start: 10, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 20 }]);

    const snapshot = result.current.getLoadedRanges() as Range[];
    snapshot.push({ start: 90, end: 95 });
    expect(result.current.getLoadedRanges()).toEqual([{ start: 0, end: 20 }]);

    act(() => result.current.reset());
    expect(result.current.getLoadedRanges()).toEqual([]);
  });

  it("onLoaded fires with the actually written range after a fetch resolves", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const onLoaded = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1, onLoaded }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith({ start: 0, end: 20 });
  });

  it("onLoaded is clamped for a short response and skipped when nothing was written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchRows = vi.fn(async (start: number, _end: number) => (start === 30 ? [] : makeRows(start, start + 5)));
    const onLoaded = vi.fn();
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1, onLoaded }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledWith({ start: 0, end: 5 });

    act(() => result.current.gridProps.onRowWindowChange({ start: 30, end: 40 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(onLoaded).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("onLoaded is not fired for aborted or rejected fetches", async () => {
    const fetchRows = vi.fn((start: number, end: number, signal: AbortSignal) => {
      return new Promise<Row[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const onLoaded = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDataGridLazyRows({ total: 100, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1, onLoaded }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
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
        batchSize: 1,
        onLoaded,
      }),
    );
    act(() => result2.current.gridProps.onRowWindowChange({ start: 0, end: 20 }));
    await waitFor(() => expect(result2.current.isLoading).toBe(false));
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("maxFetchRows splits a wide gap into consecutive chunked fetches of at most the cap", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1, maxFetchRows: 20 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 45 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchRows).toHaveBeenCalledTimes(3);
    expect(fetchRows).toHaveBeenNthCalledWith(1, 0, 20, expect.any(AbortSignal));
    expect(fetchRows).toHaveBeenNthCalledWith(2, 20, 40, expect.any(AbortSignal));
    expect(fetchRows).toHaveBeenNthCalledWith(3, 40, 45, expect.any(AbortSignal));
    expect(result.current.gridProps.data[44]).toEqual({ id: "row-44", name: "Person 44" });
    expect(result.current.unloadedCount).toBe(1000 - 45);
  });

  it("maxFetchRows still dedups: covered chunks are never re-fetched, new gaps fetch only their uncovered part", async () => {
    const fetchRows = vi.fn(async (start: number, end: number) => makeRows(start, end));
    const { result } = renderHook(() =>
      useDataGridLazyRows({ total: 1000, fetchRows, getRowId: (r: Row) => r.id, overscan: 0, batchSize: 1, maxFetchRows: 20 }),
    );

    act(() => result.current.gridProps.onRowWindowChange({ start: 0, end: 45 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(3);

    act(() => result.current.gridProps.onRowWindowChange({ start: 5, end: 40 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(3);

    act(() => result.current.gridProps.onRowWindowChange({ start: 40, end: 60 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchRows).toHaveBeenCalledTimes(4);
    expect(fetchRows).toHaveBeenNthCalledWith(4, 45, 60, expect.any(AbortSignal));
  });

});
