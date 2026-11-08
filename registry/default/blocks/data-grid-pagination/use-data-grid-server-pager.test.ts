import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridServerPager } from "./use-data-grid-server-pager";

describe("useDataGridServerPager", () => {
  it("passes page and totalRowCount through and derives pageCount", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridServerPager({ page: 3, pageSize: 20, totalRowCount: 240, onPageChange }));
    expect(result.current.pager.page).toBe(3);
    expect(result.current.pager.pageCount).toBe(12);
    expect(result.current.pager.totalRowCount).toBe(240);
  });

  it("clamps an out-of-range controlled page against the given total", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridServerPager({ page: 99, pageSize: 20, totalRowCount: 240, onPageChange }));
    expect(result.current.pager.page).toBe(12);
  });

  it("delegates onPageChange to the consumer's callback verbatim (fully controlled)", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridServerPager({ page: 1, pageSize: 20, totalRowCount: 240, onPageChange }));
    act(() => result.current.pager.onPageChange(5));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("delegates onPageSizeChange to the consumer's callback when given", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const { result } = renderHook(() =>
      useDataGridServerPager({ page: 1, pageSize: 20, totalRowCount: 240, onPageChange, onPageSizeChange }),
    );
    act(() => result.current.pager.onPageSizeChange(50));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("hides the page-size options and ignores a size change without onPageSizeChange", () => {
    const { result } = renderHook(() => useDataGridServerPager({ page: 1, pageSize: 10, totalRowCount: 95, onPageChange: () => {} }));
    expect(result.current.pager.pageSizeOptions).toEqual([]);
    expect(() => result.current.pager.onPageSizeChange(25)).not.toThrow();
  });
});

describe("useDataGridServerPager, page reconcile", () => {
  it("fires the consumer's onPageChange with the clamped page when total shrinks below it", () => {
    const onPageChange = vi.fn();
    const { rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number }) =>
        useDataGridServerPager({ page: 12, pageSize: 20, totalRowCount, onPageChange }),
      { initialProps: { totalRowCount: 240 } },
    );
    // page 12 of 12 at mount — in range, nothing fires
    expect(onPageChange).not.toHaveBeenCalled();
    rerender({ totalRowCount: 100 }); // now 5 pages
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("does not fire while the page stays in range", () => {
    const onPageChange = vi.fn();
    const { rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number }) =>
        useDataGridServerPager({ page: 3, pageSize: 20, totalRowCount, onPageChange }),
      { initialProps: { totalRowCount: 240 } },
    );
    rerender({ totalRowCount: 100 }); // 5 pages, page 3 still in range
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("does not rewrite a deep link while total is 0 (data still loading)", () => {
    const onPageChange = vi.fn();
    const { rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number }) =>
        useDataGridServerPager({ page: 5, pageSize: 20, totalRowCount, onPageChange }),
      { initialProps: { totalRowCount: 0 } },
    );
    expect(onPageChange).not.toHaveBeenCalled();
    rerender({ totalRowCount: 40 });
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("fires once for an out-of-range page at mount and not again on an unrelated rerender", () => {
    const onPageChange = vi.fn();
    const { rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number; tick: number }) => useDataGridServerPager({ page: 99, pageSize: 20, totalRowCount, onPageChange }),
      { initialProps: { totalRowCount: 240, tick: 0 } },
    );
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(12);
    rerender({ totalRowCount: 240, tick: 1 });
    rerender({ totalRowCount: 240, tick: 2 });
    expect(onPageChange).toHaveBeenCalledTimes(1);
  });

  it("never fires while the count is 0", () => {
    const onPageChange = vi.fn();
    renderHook(() => useDataGridServerPager({ page: 7, pageSize: 20, totalRowCount: 0, onPageChange }));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});

describe("useDataGridServerPager, unknown total", () => {
  const onPageChange = vi.fn();

  it("reports no total, and a page count that reaches one page ahead while hasMore", () => {
    const { result } = renderHook(() => useDataGridServerPager({ page: 3, pageSize: 20, totalRowCount: null, hasMore: true, onPageChange }));
    expect(result.current.pager).toMatchObject({ page: 3, pageCount: 4, totalRowCount: null, hasMore: true });
  });

  it("stops the page count at the current page without a next page", () => {
    const { result } = renderHook(() => useDataGridServerPager({ page: 3, pageSize: 20, totalRowCount: null, hasMore: false, onPageChange }));
    expect(result.current.pager).toMatchObject({ pageCount: 3, hasMore: false });
  });

  it("does not clamp a deep page", () => {
    const { result } = renderHook(() => useDataGridServerPager({ page: 500, pageSize: 20, totalRowCount: null, hasMore: true, onPageChange }));
    expect(result.current.pager.page).toBe(500);
  });

  it("never reconciles the upper bound but still lifts a page below 1", () => {
    const change = vi.fn();
    renderHook(() => useDataGridServerPager({ page: 500, pageSize: 20, totalRowCount: null, hasMore: false, onPageChange: change }));
    expect(change).not.toHaveBeenCalled();
    renderHook(() => useDataGridServerPager({ page: 0, pageSize: 20, totalRowCount: null, hasMore: true, onPageChange: change }));
    expect(change).toHaveBeenCalledWith(1);
  });

  it("a known total reports hasMore from the page position", () => {
    const first = renderHook(() => useDataGridServerPager({ page: 1, pageSize: 20, totalRowCount: 30, onPageChange }));
    expect(first.result.current.pager.hasMore).toBe(true);
    const last = renderHook(() => useDataGridServerPager({ page: 2, pageSize: 20, totalRowCount: 30, onPageChange }));
    expect(last.result.current.pager.hasMore).toBe(false);
  });

});
