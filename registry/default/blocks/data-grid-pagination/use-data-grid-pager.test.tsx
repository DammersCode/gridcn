import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataGridProvider, useDataGridApi, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridPager } from "./use-data-grid-pager";

type Row = { id: string; n: number };
const columns = defineColumns<Row>()([{ id: "n", header: "N", accessorKey: "n", type: "number" }] as const);
const rows: Row[] = Array.from({ length: 23 }, (_, i) => ({ id: `r${i}`, n: i }));

function setup(extra: Record<string, unknown> = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataGridProvider data={rows} columns={columns} getRowId={(row) => row.id} defaultPageSize={10} {...extra}>
      {children}
    </DataGridProvider>
  );
  return renderHook(() => ({ pager: useDataGridPager().pager, api: useDataGridApi() }), { wrapper });
}

describe("useDataGridPager", () => {
  it("counts every row and follows page and size changes", () => {
    const { result } = setup();
    expect(result.current.pager).toMatchObject({ page: 1, pageSize: 10, pageCount: 3, totalRowCount: 23, hasMore: true });
    act(() => result.current.pager.onPageChange(3));
    expect(result.current.pager).toMatchObject({ page: 3, hasMore: false });
    act(() => result.current.pager.onPageSizeChange(25));
    expect(result.current.pager).toMatchObject({ page: 1, pageCount: 1, pageSize: 25 });
  });

  it("the total follows a filter over every page", () => {
    const { result } = setup();
    act(() => result.current.api.actions.setFilters([{ columnId: "n", operator: "gte", value: "20" }]));
    expect(result.current.pager).toMatchObject({ totalRowCount: 3, pageCount: 1 });
  });

  it("without pageSize the grid reads as one page of every row", () => {
    const { result } = setup({ defaultPageSize: undefined });
    expect(result.current.pager).toMatchObject({ page: 1, pageCount: 1, totalRowCount: 23, hasMore: false });
  });
});

describe("useDataGridPager, edge cases", () => {
  it("keeps a deep-linked page while the total is 0", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataGridProvider data={[] as Row[]} columns={columns} getRowId={(row) => row.id} defaultPageSize={10} defaultPage={5}>
        {children}
      </DataGridProvider>
    );
    const { result } = renderHook(() => ({ pager: useDataGridPager().pager, requested: useDataGridSelector<unknown, number>((s) => s.page) }), { wrapper });
    expect(result.current.requested).toBe(5);
  });

  it("a controlled pageSize of null shows every row and reports setPageSize(null)", () => {
    const onPageSizeChange = vi.fn();
    const { result, rerender } = setup({ defaultPageSize: undefined, pageSize: 10, onPageSizeChange });
    act(() => result.current.api.actions.setPageSize(null));
    expect(onPageSizeChange).toHaveBeenCalledWith(null);
    expect(result.current.pager.pageCount).toBe(3);
    const { result: shown } = setup({ defaultPageSize: undefined, pageSize: null });
    expect(shown.current.pager).toMatchObject({ pageCount: 1, totalRowCount: 23 });
    rerender();
  });

  it("setPageSize(null) shows every row again", () => {
    const { result } = setup();
    act(() => result.current.api.actions.setPageSize(null));
    expect(result.current.pager).toMatchObject({ pageCount: 1, totalRowCount: 23 });
  });
});
