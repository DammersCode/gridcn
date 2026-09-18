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
    const client: Options = { data: makeData(10), pageSize: 5 };
    const server: Options = { page: 2, pageSize: 5, total: 100, onPageChange: vi.fn() };
    const { result, rerender } = renderHook((options: Options) => useDataGridPagination(options), { initialProps: client as Options });
    expect(result.current.pageData).toHaveLength(5);
    rerender(server);
    expect(result.current.pageData).toBeUndefined();
    expect(result.current.controls.page).toBe(2);
    rerender(client);
    expect(result.current.pageData).toHaveLength(5);
  });
});

describe("useDataGridPagination: client mode", () => {
  it("slices the first page by default", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), pageSize: 25 }));
    expect(result.current.pageData).toHaveLength(25);
    expect(result.current.pageData?.[0]).toEqual({ id: 0 });
    expect(result.current.controls.page).toBe(1);
    expect(result.current.controls.pageCount).toBe(5);
    expect(result.current.controls.total).toBe(101);
  });

  it("onPageChange advances to the requested page and re-slices", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), pageSize: 25 }));
    act(() => result.current.controls.onPageChange(3));
    expect(result.current.controls.page).toBe(3);
    expect(result.current.pageData).toHaveLength(25);
    expect(result.current.pageData?.[0]).toEqual({ id: 50 });
  });

  it("clamps onPageChange to the last page when asked to go past the end", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), pageSize: 25 }));
    act(() => result.current.controls.onPageChange(99));
    expect(result.current.controls.page).toBe(5);
    expect(result.current.pageData).toEqual([{ id: 100 }]);
  });

  it("clamps onPageChange below 1 up to page 1", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), pageSize: 25 }));
    act(() => result.current.controls.onPageChange(3));
    act(() => result.current.controls.onPageChange(-5));
    expect(result.current.controls.page).toBe(1);
  });

  it("re-clamps the current page when a page-size change shrinks pageCount below it", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(100), pageSize: 25 }));
    act(() => result.current.controls.onPageChange(4)); // last page at pageSize 25 (4 pages)
    act(() => result.current.controls.onPageSizeChange(50)); // now only 2 pages
    expect(result.current.controls.page).toBe(2);
    expect(result.current.controls.pageCount).toBe(2);
    expect(result.current.pageData).toHaveLength(50);
  });

  it("calls the optional onPageChange callback with the clamped page", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(101), pageSize: 25, onPageChange }));
    act(() => result.current.controls.onPageChange(99));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("supports a fully controlled page prop", () => {
    const onPageChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ page }) => useDataGridPagination({ data: makeData(101), pageSize: 25, page, onPageChange }),
      { initialProps: { page: 1 } },
    );
    act(() => result.current.controls.onPageChange(2));
    // controlled: internal state does not move on its own, only the callback fires
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(result.current.controls.page).toBe(1);
    rerender({ page: 2 });
    expect(result.current.controls.page).toBe(2);
  });

  it("defaults pageSize to the first pageSizeOptions entry when neither is given", () => {
    const { result } = renderHook(() => useDataGridPagination({ data: makeData(40), pageSizeOptions: [10, 20] }));
    expect(result.current.controls.pageSize).toBe(10);
  });
});

describe("useDataGridPagination: server mode", () => {
  it("returns pageData undefined and passes total/page/pageSize straight through", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 3, pageSize: 20, total: 240, onPageChange }));
    expect(result.current.pageData).toBeUndefined();
    expect(result.current.controls.page).toBe(3);
    expect(result.current.controls.pageCount).toBe(12);
    expect(result.current.controls.total).toBe(240);
  });

  it("clamps an out-of-range controlled page against the given total", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 99, pageSize: 20, total: 240, onPageChange }));
    expect(result.current.controls.page).toBe(12);
  });

  it("delegates onPageChange to the consumer's callback verbatim (fully controlled)", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 1, pageSize: 20, total: 240, onPageChange }));
    act(() => result.current.controls.onPageChange(5));
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it("delegates onPageSizeChange to the consumer's callback when given", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const { result } = renderHook(() =>
      useDataGridPagination({ page: 1, pageSize: 20, total: 240, onPageChange, onPageSizeChange }),
    );
    act(() => result.current.controls.onPageSizeChange(50));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it("onPageSizeChange is a harmless no-op when the consumer doesn't provide one", () => {
    const onPageChange = vi.fn();
    const { result } = renderHook(() => useDataGridPagination({ page: 1, pageSize: 20, total: 240, onPageChange }));
    expect(() => result.current.controls.onPageSizeChange(50)).not.toThrow();
  });
});
