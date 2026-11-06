import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDataGridPagination } from "./use-data-grid-pagination";

function makeData(count: number): { id: number }[] {
  return Array.from({ length: count }, (_, i) => ({ id: i }));
}

describe("useDataGridPagination: client mode", () => {
  it("slices the first page by default", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 25 }));
    expect(result.current.pageData).toHaveLength(25);
    expect(result.current.pageData?.[0]).toEqual({ id: 0 });
    expect(result.current.pager.page).toBe(1);
    expect(result.current.pager.pageCount).toBe(5);
    expect(result.current.pager.totalRowCount).toBe(101);
  });

  it("seeds the page size from defaultPageSize and lets onPageSizeChange move it", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 10 }));
    expect(result.current.pager.pageSize).toBe(10);
    expect(result.current.pageData).toHaveLength(10);
    act(() => result.current.pager.onPageSizeChange(50));
    expect(result.current.pageData).toHaveLength(50);
  });

  it("follows a controlled pageSize and only reports the change", () => {
    const onPageSizeChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), pageSize: 20, onPageSizeChange }));
    act(() => result.current.pager.onPageSizeChange(50));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    expect(result.current.pager.pageSize).toBe(20);
  });

  it("seeds the page from defaultPage", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 25, defaultPage: 3 }));
    expect(result.current.pager.page).toBe(3);
  });

  it("onPageChange advances to the requested page and re-slices", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 25 }));
    act(() => result.current.pager.onPageChange(3));
    expect(result.current.pager.page).toBe(3);
    expect(result.current.pageData).toHaveLength(25);
    expect(result.current.pageData?.[0]).toEqual({ id: 50 });
  });

  it("clamps onPageChange to the last page when asked to go past the end", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 25 }));
    act(() => result.current.pager.onPageChange(99));
    expect(result.current.pager.page).toBe(5);
    expect(result.current.pageData).toEqual([{ id: 100 }]);
  });

  it("clamps onPageChange below 1 up to page 1", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 25 }));
    act(() => result.current.pager.onPageChange(3));
    act(() => result.current.pager.onPageChange(-5));
    expect(result.current.pager.page).toBe(1);
  });

  it("re-clamps the current page when a page-size change shrinks pageCount below it", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(100), defaultPageSize: 25 }));
    act(() => result.current.pager.onPageChange(4)); // last page at pageSize 25 (4 pages)
    act(() => result.current.pager.onPageSizeChange(50)); // now only 2 pages
    expect(result.current.pager.page).toBe(2);
    expect(result.current.pager.pageCount).toBe(2);
    expect(result.current.pageData).toHaveLength(50);
  });

  it("calls the optional onPageChange callback with the clamped page", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 25, onPageChange }));
    act(() => result.current.pager.onPageChange(99));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("keeps a controlled page while data is empty (loading) without rewriting it, and shows it again once data arrives", () => {
    const onPageChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ data }: { data: { id: number }[] }) => useDataGridPagination({ data, defaultPageSize: 25, page: 3, onPageChange }),
      { initialProps: { data: [] as { id: number }[] } },
    );
    // empty data (a fetch in flight): the controls show a valid page, and the consumer's page is never rewritten
    expect(result.current.pager.page).toBe(1);
    expect(result.current.pageData).toEqual([]);
    expect(onPageChange).not.toHaveBeenCalled();

    rerender({ data: makeData(101) });
    expect(result.current.pager.page).toBe(3);
    expect(result.current.pageData?.[0]).toEqual({ id: 50 });
  });

  it("supports a fully controlled page prop", () => {
    const onPageChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ page }) => useDataGridPagination({ data: makeData(101), defaultPageSize: 25, page, onPageChange }),
      { initialProps: { page: 1 } },
    );
    act(() => result.current.pager.onPageChange(2));
    // controlled: internal state does not move on its own, only the callback fires
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(result.current.pager.page).toBe(1);
    rerender({ page: 2 });
    expect(result.current.pager.page).toBe(2);
  });

  it("defaults pageSize to the first pageSizeOptions entry when neither is given", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(40), pageSizeOptions: [10, 20] }));
    expect(result.current.pager.pageSize).toBe(10);
  });

  it("calls the optional onPageSizeChange callback with the new size", () => {
    const onPageSizeChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), defaultPageSize: 25, onPageSizeChange }));
    act(() => result.current.pager.onPageSizeChange(50));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
});

  it("client mode reports hasMore too", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(30), defaultPageSize: 20 }));
    expect(result.current.pager.hasMore).toBe(true);
  });
});
