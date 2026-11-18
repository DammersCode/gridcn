import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridProvider, useDataGridActions, type ColumnDef, type FilterNode } from "../data-grid";
import { useDataGridSelector } from "../data-grid-sdk";
import { serverSpecKey, serverSpecOf } from "../server-spec";

type Row = { id: string; name: string; qty: number };
const data: Row[] = [
  { id: "1", name: "alpha", qty: 10 },
  { id: "2", name: "beta", qty: 60 },
  { id: "3", name: "gamma", qty: 70 },
  { id: "4", name: "delta", qty: 5 },
];
const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];
const inner: FilterNode[] = [
  { columnId: "name", operator: "equals", value: "alpha" },
  { columnId: "qty", operator: "gt", value: "50" },
];
const negated = (not: boolean): FilterNode[] => [{ join: "or", ...(not ? { not } : null), filters: inner }];

afterEach(cleanup);

function setup(props: { defaultFilterState?: FilterNode[]; filterState?: FilterNode[]; filterMode?: "client" | "server" } = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataGridProvider data={data} columns={columns} getRowId={(row: Row) => row.id} {...props}>
      {children}
    </DataGridProvider>
  );
  return renderHook(() => ({ actions: useDataGridActions(), view: useDataGridSelector((s) => s.viewIndex), state: useDataGridSelector((s) => s.filterState) }), { wrapper });
}

describe("negated filter group in the store", () => {
  it("shows the rows the group does not match", () => {
    expect(setup({ defaultFilterState: negated(false) }).result.current.view).toEqual([0, 1, 2]);
    expect(setup({ defaultFilterState: negated(true) }).result.current.view).toEqual([3]);
  });

  it("rebuilds the view when setFilters flips not, and keeps the key off at false", () => {
    const { result } = setup({ defaultFilterState: negated(false) });
    act(() => result.current.actions.setFilters(negated(true)));
    expect(result.current.view).toEqual([3]);
    expect(result.current.state[0]).toMatchObject({ not: true });
    act(() => result.current.actions.setFilters(negated(false)));
    expect(result.current.view).toEqual([0, 1, 2]);
  });

  it("follows a controlled filterState that flips not", () => {
    let filterState = negated(false);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataGridProvider data={data} columns={columns} getRowId={(row: Row) => row.id} filterState={filterState}>
        {children}
      </DataGridProvider>
    );
    const { result, rerender } = renderHook(() => useDataGridSelector((s) => s.viewIndex), { wrapper });
    expect(result.current).toEqual([0, 1, 2]);
    filterState = negated(true);
    rerender();
    expect(result.current).toEqual([3]);
  });

  it("never filters in server mode and carries not in the spec", () => {
    const { result } = setup({ defaultFilterState: negated(true), filterMode: "server" });
    expect(result.current.view).toEqual([0, 1, 2, 3]);
    const spec = (not: boolean) => serverSpecOf({ sortState: [], filterState: negated(not), searchText: "" });
    expect(serverSpecKey(spec(true))).not.toBe(serverSpecKey(spec(false)));
    expect(spec(true).filters[0]).toMatchObject({ not: true });
  });
});
