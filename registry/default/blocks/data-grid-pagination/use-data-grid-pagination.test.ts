import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useDataGridPagination,
  type UseDataGridPaginationClientOptions,
  type UseDataGridPaginationServerOptions,
} from "./use-data-grid-pagination";

function makeData(count: number): { id: number }[] {
  return Array.from({ length: count }, (_, i) => ({ id: i }));
}

describe("useDataGridPagination: mode switching", () => {
  it("survives switching between client and server options across renders (rules-of-hooks)", () => {
    type Options = UseDataGridPaginationClientOptions<{ id: number }> | UseDataGridPaginationServerOptions;
    const client: Options = { data: makeData(10), defaultPageSize: 5 };
    const server: Options = { page: 2, pageSize: 5, totalRowCount: 100, onPageChange: vi.fn() };
    const { result, rerender } = renderHook((options: Options) => useDataGridPagination(options), { initialProps: client as Options });
    expect(result.current.pageData).toHaveLength(5);
    rerender(server);
    expect(result.current.pageData).toBeUndefined();
    expect(result.current.pager.page).toBe(2);
    rerender(client);
    expect(result.current.pageData).toHaveLength(5);
  });
});

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
});

describe("useDataGridPagination: server mode", () => {
  it("returns pageData undefined and passes total/page/pageSize straight through", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 3, pageSize: 20, totalRowCount: 240, onPageChange }));
    expect(result.current.pageData).toBeUndefined();
    expect(result.current.pager.page).toBe(3);
    expect(result.current.pager.pageCount).toBe(12);
    expect(result.current.pager.totalRowCount).toBe(240);
  });

  it("clamps an out-of-range controlled page against the given total", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 99, pageSize: 20, totalRowCount: 240, onPageChange }));
    expect(result.current.pager.page).toBe(12);
  });

  it("delegates onPageChange to the consumer's callback verbatim (fully controlled)", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 1, pageSize: 20, totalRowCount: 240, onPageChange }));
    act(() => result.current.pager.onPageChange(5));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("delegates onPageSizeChange to the consumer's callback when given", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const { result } = renderHook(() =>
      useDataGridPagination({ page: 1, pageSize: 20, totalRowCount: 240, onPageChange, onPageSizeChange }),
    );
    act(() => result.current.pager.onPageSizeChange(50));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("dev-warns once when a page-size change lands on the missing onPageSizeChange", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 1, pageSize: 20, totalRowCount: 240, onPageChange }));
    act(() => result.current.pager.onPageSizeChange(50));
    act(() => result.current.pager.onPageSizeChange(100));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("onPageSizeChange"));
    warn.mockRestore();
  });
});

describe("useDataGridPagination: server mode, page reconcile", () => {
  it("fires the consumer's onPageChange with the clamped page when total shrinks below it", () => {
    const onPageChange = vi.fn();
    const { rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number }) =>
        useDataGridPagination({ page: 12, pageSize: 20, totalRowCount, onPageChange }),
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
        useDataGridPagination({ page: 3, pageSize: 20, totalRowCount, onPageChange }),
      { initialProps: { totalRowCount: 240 } },
    );
    rerender({ totalRowCount: 100 }); // 5 pages, page 3 still in range
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("does not rewrite a deep link while total is 0 (data still loading)", () => {
    const onPageChange = vi.fn();
    const { rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number }) =>
        useDataGridPagination({ page: 5, pageSize: 20, totalRowCount, onPageChange }),
      { initialProps: { totalRowCount: 0 } },
    );
    expect(onPageChange).not.toHaveBeenCalled();
    rerender({ totalRowCount: 40 });
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("fires once for a shrinking count and not again on an unrelated rerender", () => {
    const onPageChange = vi.fn();
    const { rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number; tick: number }) => useDataGridPagination({ page: 99, pageSize: 20, totalRowCount, onPageChange }),
      { initialProps: { totalRowCount: 240, tick: 0 } },
    );
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(12);
    rerender({ totalRowCount: 240, tick: 1 });
    rerender({ totalRowCount: 240, tick: 2 });
    expect(onPageChange).toHaveBeenCalledTimes(1);
  });

  it("never fires while the count is 0", () => {
    const onPageChange = vi.fn();
    renderHook(() => useDataGridPagination({ page: 7, pageSize: 20, totalRowCount: 0, onPageChange }));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});

describe("useDataGridPagination: server mode, unknown total", () => {
  const onPageChange = vi.fn();

  it("reports no total, and a page count that reaches one page ahead while hasNextPage", () => {
    const { result } = renderHook(() => useDataGridPagination({ page: 3, pageSize: 20, totalRowCount: null, hasNextPage: true, onPageChange }));
    expect(result.current.pager).toMatchObject({ page: 3, pageCount: 4, totalRowCount: null, hasNextPage: true });
  });

  it("stops the page count at the current page without a next page", () => {
    const { result } = renderHook(() => useDataGridPagination({ page: 3, pageSize: 20, totalRowCount: null, hasNextPage: false, onPageChange }));
    expect(result.current.pager).toMatchObject({ pageCount: 3, hasNextPage: false });
  });

  it("does not clamp a deep page", () => {
    const { result } = renderHook(() => useDataGridPagination({ page: 500, pageSize: 20, totalRowCount: null, hasNextPage: true, onPageChange }));
    expect(result.current.pager.page).toBe(500);
  });

  it("never reconciles the upper bound but still lifts a page below 1", () => {
    const change = vi.fn();
    renderHook(() => useDataGridPagination({ page: 500, pageSize: 20, totalRowCount: null, hasNextPage: false, onPageChange: change }));
    expect(change).not.toHaveBeenCalled();
    renderHook(() => useDataGridPagination({ page: 0, pageSize: 20, totalRowCount: null, hasNextPage: true, onPageChange: change }));
    expect(change).toHaveBeenCalledWith(1);
  });

  it("a known total reports hasNextPage from the page position", () => {
    const first = renderHook(() => useDataGridPagination({ page: 1, pageSize: 20, totalRowCount: 30, onPageChange }));
    expect(first.result.current.pager.hasNextPage).toBe(true);
    const last = renderHook(() => useDataGridPagination({ page: 2, pageSize: 20, totalRowCount: 30, onPageChange }));
    expect(last.result.current.pager.hasNextPage).toBe(false);
  });

  it("client mode reports hasNextPage too", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(30), defaultPageSize: 20 }));
    expect(result.current.pager.hasNextPage).toBe(true);
  });
});
