import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataGridProvider, useDataGridApi, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
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
  return renderHook(() => ({ pager: useDataGridPager(), api: useDataGridApi() }), { wrapper });
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
