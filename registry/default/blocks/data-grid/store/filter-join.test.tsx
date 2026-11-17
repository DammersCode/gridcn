import { act, cleanup, renderHook } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataGridProvider, useDataGridActions, type ColumnDef, type FilterNode } from "../data-grid";
import { useDataGridSelector } from "../data-grid-sdk";
import { buildViewIndex } from "../sort-filter/build-view-index";
import { makeFilterPredicate } from "../sort-filter/incremental-view-index";
import { withRootJoin } from "../sort-filter/filter-tree";
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
const two: FilterNode[] = [
  { columnId: "name", operator: "equals", value: "alpha" },
  { columnId: "qty", operator: "gt", value: "50" },
];

afterEach(cleanup);

type Props = { defaultPage?: number; onPageChange?: (page: number) => void; filterState?: FilterNode[]; filterJoin?: "and" | "or"; defaultFilterJoin?: "and" | "or"; defaultFilterState?: FilterNode[]; onFilterJoinChange?: (next: "and" | "or") => void; filterMode?: "client" | "server"; pageSize?: number };

function setup(props: Props = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataGridProvider data={data} columns={columns} getRowId={(row: Row) => row.id} {...props}>
      {children}
    </DataGridProvider>
  );
  return renderHook(() => ({ actions: useDataGridActions(), join: useDataGridSelector((s) => s.filterJoin), view: useDataGridSelector((s) => s.viewIndex) }), { wrapper });
}

describe("evaluation of the top-level join", () => {
  const accessor = {
    getText: (row: number, columnId: string) => String(columnId === "name" ? data[row]!.name : data[row]!.qty),
    getValue: (row: number, columnId: string) => (columnId === "name" ? data[row]!.name : data[row]!.qty),
  };
  const ids = (join?: "and" | "or", filters = two) => buildViewIndex(data.length, accessor as never, { sorts: [], filters, filterJoin: join });

  it("matches every entry for and and any entry for or", () => {
    expect(ids("and")).toEqual([]);
    expect(ids(undefined)).toEqual([]);
    expect(ids("or")).toEqual([0, 1, 2]);
  });

  it("reads one entry and no entry the same under both joins", () => {
    expect(ids("or", [two[1]!])).toEqual(ids("and", [two[1]!]));
    expect(ids("or", [])).toEqual([0, 1, 2, 3]);
  });

  it("nests a group inside the or list", () => {
    const filters: FilterNode[] = [two[0]!, { join: "and", filters: [{ columnId: "qty", operator: "gt", value: "50" }, { columnId: "name", operator: "equals", value: "gamma" }] }];
    expect(ids("or", filters)).toEqual([0, 2]);
  });

  it("keeps the wrapper identity per list and leaves and lists alone", () => {
    expect(withRootJoin(two, "or")).toBe(withRootJoin(two, "or"));
    expect(withRootJoin(two, "and")).toBe(two);
    expect(makeFilterPredicate(accessor as never, withRootJoin(two, "or"))(1)).toBe(true);
  });
});

describe("store", () => {
  it("starts with and and seeds the join once", () => {
    expect(setup().result.current.join).toBe("and");
    expect(setup({ defaultFilterJoin: "or" }).result.current.join).toBe("or");
  });

  it("filters the client view with the join and rebuilds on a change", () => {
    const { result } = setup({ defaultFilterState: two });
    expect(result.current.view).toEqual([]);
    act(() => result.current.actions.setFilterJoin("or"));
    expect(result.current.join).toBe("or");
    expect(result.current.view).toEqual([0, 1, 2]);
    act(() => result.current.actions.setFilterJoin("and"));
    expect(result.current.view).toEqual([]);
  });

  it("does not emit for the current join and emits the change once", () => {
    const onFilterJoinChange = vi.fn();
    const { result } = setup({ onFilterJoinChange });
    act(() => result.current.actions.setFilterJoin("and"));
    expect(onFilterJoinChange).not.toHaveBeenCalled();
    act(() => result.current.actions.setFilterJoin("or"));
    expect(onFilterJoinChange).toHaveBeenCalledExactlyOnceWith("or");
  });

  it("treats a value other than or as and", () => {
    const { result } = setup({ defaultFilterJoin: "or" });
    act(() => result.current.actions.setFilterJoin("xor" as never));
    expect(result.current.join).toBe("and");
  });

  it("emits and waits while the join is controlled", () => {
    const onFilterJoinChange = vi.fn();
    const { result } = setup({ filterJoin: "and", defaultFilterState: two, onFilterJoinChange });
    act(() => result.current.actions.setFilterJoin("or"));
    expect(onFilterJoinChange).toHaveBeenCalledWith("or");
    expect(result.current.join).toBe("and");
  });

  it("follows a controlled join and rebuilds the view", () => {
    const wrapper = ({ children }: { children: ReactNode }) => {
      const [join, setJoin] = useState<"and" | "or">("and");
      return (
        <DataGridProvider data={data} columns={columns} getRowId={(row: Row) => row.id} defaultFilterState={two} filterJoin={join} onFilterJoinChange={setJoin}>
          {children}
        </DataGridProvider>
      );
    };
    const { result } = renderHook(() => ({ actions: useDataGridActions(), join: useDataGridSelector((s) => s.filterJoin), view: useDataGridSelector((s) => s.viewIndex) }), { wrapper });
    act(() => result.current.actions.setFilterJoin("or"));
    expect(result.current.join).toBe("or");
    expect(result.current.view).toEqual([0, 1, 2]);
  });

  it("skips the rebuild when a sync carries the same join", () => {
    const { result, rerender } = setup({ filterJoin: "or", defaultFilterState: two });
    const view = result.current.view;
    rerender();
    expect(result.current.view).toBe(view);
  });

  it("resets a paged grid to page 1 when the join changes", () => {
    const onPageChange = vi.fn();
    const { result } = setup({ defaultFilterState: two, defaultFilterJoin: "or", pageSize: 1, defaultPage: 2, onPageChange });
    act(() => result.current.actions.setFilterJoin("and"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("ignores the join in server mode and carries or in the spec", () => {
    const { result } = setup({ filterMode: "server", defaultFilterState: two });
    act(() => result.current.actions.setFilterJoin("or"));
    expect(result.current.view).toEqual([0, 1, 2, 3]);
    const spec = serverSpecOf({ sortState: [], filterState: two, filterJoin: "or", searchText: "" });
    expect(spec.filterJoin).toBe("or");
    expect("filterJoin" in serverSpecOf({ sortState: [], filterState: two, filterJoin: "and", searchText: "" })).toBe(false);
    expect(serverSpecKey(spec)).not.toBe(serverSpecKey(serverSpecOf({ sortState: [], filterState: two, searchText: "" })));
  });
});
