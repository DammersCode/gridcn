import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ColumnDef, FilterSpec, SortSpec } from "../data-grid";
import { DataGridProvider, useDataGridInternalActions, useDataGridStoreApi, useDataGridViewStale } from "../store";

type Row = { id: string; name: string; price: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "price", header: "Price", accessorKey: "price" },
];

const seed = (): Row[] => [
  { id: "a", name: "Charlie", price: 30 },
  { id: "b", name: "Alice", price: 25 },
  { id: "c", name: "Bob", price: 40 },
];

type Props = {
  data: Row[];
  sortMode?: "client" | "server";
  filterMode?: "client" | "server";
  sortState?: SortSpec[];
  filterState?: FilterSpec[];
  searchText?: string;
};

function renderGrid(initial: Props) {
  let props = initial;
  const hook = renderHook(
    () => ({ actions: useDataGridInternalActions(), store: useDataGridStoreApi(), viewStale: useDataGridViewStale() }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <DataGridProvider
          columns={columns}
          getRowId={(r: Row) => r.id}
          {...props}
          onDataChange={(next) => {
            props = { ...props, data: next as Row[] };
          }}
        >
          {children}
        </DataGridProvider>
      ),
    },
  );
  return {
    ...hook,
    stale: () => [...hook.result.current.store.getState().staleRowIds].sort(),
    push: (patches: { rowId: string; columnId: string; value: unknown }[], options?: Parameters<typeof hook.result.current.actions.updateCells>[1]) =>
      act(() => {
        hook.result.current.actions.updateCells(patches, options);
      }),
    update: (next: Props) => {
      props = next;
      hook.rerender();
    },
  };
}

const sortByName: SortSpec[] = [{ columnId: "name", direction: "asc" }];

describe("stale rows under a server spec", () => {
  it("marks a pushed row on a server sort column and sets viewStale", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    expect(grid.stale()).toEqual(["a"]);
    expect(grid.result.current.viewStale).toBe(true);
  });

  it("leaves a row alone when the push touches a column the spec does not read", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "price", value: 31 }]);
    expect(grid.stale()).toEqual([]);
    expect(grid.result.current.viewStale).toBe(false);
  });

  it("marks a row on a server filter column", () => {
    const grid = renderGrid({ data: seed(), filterMode: "server", filterState: [{ columnId: "price", operator: "gt", value: "10" }] });
    grid.push([{ rowId: "b", columnId: "price", value: 5 }, { rowId: "c", columnId: "name", value: "Bobby" }]);
    expect(grid.stale()).toEqual(["b"]);
  });

  it("marks any column while a server filter carries search text", () => {
    const grid = renderGrid({ data: seed(), filterMode: "server", searchText: "ali" });
    grid.push([{ rowId: "c", columnId: "name", value: "Bobby" }]);
    expect(grid.stale()).toEqual(["c"]);
  });

  it("ignores search text when the filter runs on the client", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName, searchText: "ali" });
    grid.push([{ rowId: "c", columnId: "price", value: 41 }]);
    expect(grid.stale()).toEqual([]);
  });

  it("marks nothing without a server spec", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server" });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    expect(grid.stale()).toEqual([]);
    expect(grid.result.current.viewStale).toBe(false);
  });

  it('marks nothing for reorder "never"', () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "never" });
    expect(grid.stale()).toEqual([]);
    expect(grid.result.current.viewStale).toBe(false);
  });

  it("keeps the set identity when a push adds no new row id", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    const first = grid.result.current.store.getState().staleRowIds;
    grid.push([{ rowId: "a", columnId: "name", value: "Abe" }]);
    expect(grid.result.current.store.getState().staleRowIds).toBe(first);
  });

  it("does not reorder the view and writes the value in place", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const before = grid.result.current.store.getState().viewIndex;
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    const state = grid.result.current.store.getState();
    expect(state.viewIndex).toBe(before);
    expect((state.data as Row[])[0]!.name).toBe("Aaron");
  });
});

afterEach(() => vi.restoreAllMocks());

describe("reshape handler", () => {
  const withHandler = (grid: ReturnType<typeof renderGrid>) => {
    const reshape = vi.fn();
    grid.result.current.store.getState().dataWrite.reshape = reshape;
    return reshape;
  };

  it('immediate marks the row and asks for a reshape once per batch', () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const reshape = withHandler(grid);
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }, { rowId: "b", columnId: "name", value: "Abe" }], { reorder: "immediate" });
    expect(grid.stale()).toEqual(["a", "b"]);
    expect(grid.result.current.viewStale).toBe(true);
    expect(reshape).toHaveBeenCalledTimes(1);
  });

  it('immediate asks again for a row that is stale already', () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const reshape = withHandler(grid);
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "immediate" });
    grid.push([{ rowId: "a", columnId: "name", value: "Abe" }], { reorder: "immediate" });
    expect(reshape).toHaveBeenCalledTimes(2);
  });

  it('immediate on a column the spec does not read asks for nothing', () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const reshape = withHandler(grid);
    grid.push([{ rowId: "a", columnId: "price", value: 31 }], { reorder: "immediate" });
    expect(reshape).not.toHaveBeenCalled();
    expect(grid.stale()).toEqual([]);
  });

  it('defer never asks for a reshape', () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const reshape = withHandler(grid);
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    expect(reshape).not.toHaveBeenCalled();
  });

  it('immediate without a handler marks the row and warns once', () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "immediate" });
    grid.push([{ rowId: "b", columnId: "name", value: "Abe" }], { reorder: "immediate" });
    expect(grid.stale()).toEqual(["a", "b"]);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("immediate"))).toHaveLength(1);
  });

  it("reconcileView without a handler clears the marks and keeps the order", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const before = grid.result.current.store.getState().viewIndex;
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    act(() => grid.result.current.actions.reconcileView());
    expect(grid.stale()).toEqual([]);
    expect(grid.result.current.viewStale).toBe(false);
    expect(grid.result.current.store.getState().viewIndex).toBe(before);
  });

  it("reconcileView with a handler calls it once and keeps the marks", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const reshape = withHandler(grid);
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    act(() => grid.result.current.actions.reconcileView());
    expect(reshape).toHaveBeenCalledTimes(1);
    expect(grid.stale()).toEqual(["a"]);
    expect(grid.result.current.viewStale).toBe(true);
  });

  it("reconcileView does nothing while no row is stale", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server", sortState: sortByName });
    const reshape = withHandler(grid);
    act(() => grid.result.current.actions.reconcileView());
    expect(reshape).not.toHaveBeenCalled();
  });
});

describe("stale row prune", () => {
  const marked = () => {
    const data = seed();
    const grid = renderGrid({ data, sortMode: "server", sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    return { grid, data, pushed: grid.result.current.store.getState().data as Row[] };
  };

  it("unmarks a row that a foreign sync delivers as a new object", () => {
    const { grid, pushed } = marked();
    grid.update({ data: pushed.map((row) => ({ ...row })), sortMode: "server", sortState: sortByName });
    expect(grid.stale()).toEqual([]);
    expect(grid.result.current.viewStale).toBe(false);
  });

  it("keeps the mark when the foreign sync delivers the same row object", () => {
    const { grid, pushed } = marked();
    const next = pushed.slice();
    next[1] = { ...next[1]!, price: 26 };
    grid.update({ data: next, sortMode: "server", sortState: sortByName });
    expect(grid.stale()).toEqual(["a"]);
    expect(grid.result.current.viewStale).toBe(true);
  });

  it("keeps the mark when the row object moves to another index", () => {
    const { grid, pushed } = marked();
    grid.update({ data: [pushed[1]!, pushed[0]!, pushed[2]!], sortMode: "server", sortState: sortByName });
    expect(grid.stale()).toEqual(["a"]);
  });

  it("unmarks a row that leaves the data", () => {
    const { grid, pushed } = marked();
    grid.update({ data: pushed.slice(1), sortMode: "server", sortState: sortByName });
    expect(grid.stale()).toEqual([]);
    expect(grid.result.current.viewStale).toBe(false);
  });

  it("keeps the other marks when one row leaves", () => {
    const { grid, pushed } = marked();
    grid.push([{ rowId: "c", columnId: "name", value: "Carl" }]);
    const now = grid.result.current.store.getState().data as Row[];
    expect(pushed).not.toBe(now);
    grid.update({ data: now.filter((row) => row.id !== "a"), sortMode: "server", sortState: sortByName });
    expect(grid.stale()).toEqual(["c"]);
  });

  it("clears every mark when the sort changes", () => {
    const { grid, pushed } = marked();
    grid.update({ data: pushed, sortMode: "server", sortState: [{ columnId: "price", direction: "desc" }] });
    expect(grid.stale()).toEqual([]);
    expect(grid.result.current.viewStale).toBe(false);
  });

  it("clears every mark when the search text changes", () => {
    const grid = renderGrid({ data: seed(), filterMode: "server", searchText: "a" });
    grid.push([{ rowId: "c", columnId: "name", value: "Bobby" }]);
    expect(grid.stale()).toEqual(["c"]);
    grid.update({ data: grid.result.current.store.getState().data as Row[], filterMode: "server", searchText: "b" });
    expect(grid.stale()).toEqual([]);
  });

  it("keeps the marks across a render with an equal spec", () => {
    const { grid, pushed } = marked();
    grid.update({ data: pushed, sortMode: "server", sortState: [{ columnId: "name", direction: "asc" }] });
    expect(grid.stale()).toEqual(["a"]);
  });

  it("clears the marks when the grid sorts itself in uncontrolled state", () => {
    const grid = renderGrid({ data: seed(), sortMode: "server" });
    act(() => grid.result.current.actions.setSorts(sortByName));
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    expect(grid.stale()).toEqual(["a"]);
    act(() => grid.result.current.actions.setSorts([{ columnId: "price", direction: "asc" }]));
    expect(grid.stale()).toEqual([]);
  });
});

describe("client modes keep their reorder contract", () => {
  it('defer flips viewStale on a sort column and marks no row', () => {
    const grid = renderGrid({ data: seed(), sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }]);
    expect(grid.result.current.viewStale).toBe(true);
    expect(grid.stale()).toEqual([]);
  });

  it('immediate re-places the row and leaves the view fresh', () => {
    const grid = renderGrid({ data: seed(), sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "immediate" });
    expect(grid.result.current.store.getState().viewIndex).toEqual([0, 1, 2]);
    expect(grid.result.current.viewStale).toBe(false);
  });

  it('never leaves the view fresh', () => {
    const grid = renderGrid({ data: seed(), sortState: sortByName });
    grid.push([{ rowId: "a", columnId: "name", value: "Aaron" }], { reorder: "never" });
    expect(grid.result.current.viewStale).toBe(false);
  });
});
