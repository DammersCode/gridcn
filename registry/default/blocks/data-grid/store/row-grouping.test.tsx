import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import type { ExpandedState } from "../group-types";
import { createDataGridStore } from "./create-store";
import { DataGridProvider } from ".";
import { useDataGridStoreApi } from "./provider";
import { fullViewOf, remapRowChannel } from "./compute";
import { groupLayoutOfView, rowIdAtViewRow } from "./view-rows";
import { COLLAPSED, EXPANDED } from "./group-state";
import { CompactSelection } from "../selection/compact-selection";
import type { StoreApi } from "zustand/vanilla";
import type { DataGridStoreState, InternalSyncProps } from "./types";

type Row = { id: string; region: string | null; team: string; qty: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "team", header: "Team", accessorKey: "team", type: "text", groupable: false },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
];

const seed = (): Row[] => [
  { id: "1", region: "north", team: "a", qty: 1 },
  { id: "2", region: "south", team: "a", qty: 2 },
  { id: "3", region: "north", team: "b", qty: 3 },
  { id: "4", region: null, team: "a", qty: 4 },
  { id: "5", region: "south", team: "b", qty: 5 },
];

function make(props: Partial<InternalSyncProps> = {}) {
  const store = createDataGridStore({ data: seed(), columns, getRowId: (row: Row) => row.id, defaultGroupBy: ["region"], ...props } as unknown as InternalSyncProps);
  const state = () => store.getState();
  const ids = () => state().viewIndex.map((_, row) => rowIdAtViewRow(state(), row));
  return { store, state, actions: state().actions, ids };
}

const NORTH = "__group:region=north";
const SOUTH = "__group:region=south";
const EMPTY = "__group:region=";

afterEach(() => vi.restoreAllMocks());

describe("a grid that groups", () => {
  it("starts with one collapsed header per group and keeps the layout beside the view", () => {
    const { state, ids } = make();
    expect(ids()).toEqual([NORTH, SOUTH, EMPTY]);
    expect(state().viewIndex.every((entry) => entry < 0)).toBe(true);
    expect(state().groupLayout).toBe(groupLayoutOfView(state().viewIndex));
    expect(state().groupLayout!.rows.map((row) => [row.count, row.aggregates["qty"]])).toEqual([[2, 4], [2, 7], [1, 4]]);
  });

  it("is switched on by any one of the three gate props and by none other", () => {
    expect(make().state().groupingEnabled).toBe(true);
    expect(make({ defaultGroupBy: undefined, onGroupByChange: () => {} }).state().groupingEnabled).toBe(true);
    expect(make({ defaultGroupBy: undefined, groupBy: [] }).state().groupingEnabled).toBe(true);
    expect(make({ defaultGroupBy: undefined }).state().groupingEnabled).toBe(false);
  });

  it("pays nothing without a group column: no layout and the view the sort and filter give", () => {
    const { state } = make({ defaultGroupBy: undefined });
    expect(state().groupLayout).toBeNull();
    expect(state().groupBy).toEqual([]);
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
  });

  it("opens a group on toggle, emits once, and shows its rows in leaf order", () => {
    const onExpandedChange = vi.fn();
    const { actions, ids } = make({ onExpandedChange });
    actions.toggleGroup(SOUTH);
    expect(ids()).toEqual([NORTH, SOUTH, "2", "5", EMPTY]);
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    expect(onExpandedChange).toHaveBeenCalledWith({ mode: "collapsed", ids: [SOUTH] });
    actions.toggleGroup(SOUTH);
    expect(ids()).toEqual([NORTH, SOUTH, EMPTY]);
  });

  it("keeps a group closed and announces it when 10,000 groups are open already", () => {
    const onExpandedChange = vi.fn();
    const ids = Array.from({ length: 10_000 }, (_, i) => `__group:region=x${i}`);
    const { actions, state } = make({ defaultExpanded: { mode: "collapsed", ids }, onExpandedChange });
    actions.toggleGroup(SOUTH);
    expect(state().expanded.ids).toHaveLength(10_000);
    expect(state().expanded.ids).not.toContain(SOUTH);
    expect(onExpandedChange).not.toHaveBeenCalled();
    expect(state().liveAnnouncement?.kind).toBe("groupTooManyOpen");
  });

  it("expands and collapses every group in one step and emits nothing for a no-op", () => {
    const onExpandedChange = vi.fn();
    const { actions, ids } = make({ onExpandedChange });
    expect(actions.expandAll()).toEqual({ ok: true });
    expect(ids()).toEqual([NORTH, "1", "3", SOUTH, "2", "5", EMPTY, "4"]);
    actions.expandAll();
    expect(onExpandedChange).toHaveBeenCalledTimes(1);
    actions.collapseAll();
    expect(ids()).toEqual([NORTH, SOUTH, EMPTY]);
  });

  it("starts expanded from defaultExpanded", () => {
    const { ids } = make({ defaultExpanded: EXPANDED });
    expect(ids()).toHaveLength(8);
  });

  it("normalizes setGroupBy: unknown, ungroupable, and repeated columns drop, at most 4 levels", () => {
    const onGroupByChange = vi.fn();
    const { actions, state } = make({ onGroupByChange });
    actions.setGroupBy(["nope", "team", "qty", "qty", "region"]);
    expect(state().groupBy).toEqual(["qty", "region"]);
    expect(onGroupByChange).toHaveBeenCalledWith(["qty", "region"]);
    actions.setGroupBy(["qty", "region"]);
    expect(onGroupByChange).toHaveBeenCalledTimes(1);
  });

  it("regroups and ungroups through setGroupBy and toggleGroupBy", () => {
    const { actions, state } = make();
    actions.toggleGroupBy("qty");
    expect(state().groupBy).toEqual(["region", "qty"]);
    actions.toggleGroupBy("region");
    expect(state().groupBy).toEqual(["qty"]);
    actions.setGroupBy([]);
    expect(state().groupLayout).toBeNull();
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
  });

  it("orders the groups by a sort on the group column and the rows by a sort on another column", () => {
    const { actions, ids } = make({ defaultExpanded: EXPANDED });
    actions.setSorts([{ columnId: "region", direction: "desc" }]);
    expect(ids()).toEqual([SOUTH, "2", "5", NORTH, "1", "3", EMPTY, "4"]);
    actions.setSorts([{ columnId: "qty", direction: "desc" }]);
    expect(ids()).toEqual([NORTH, "3", "1", SOUTH, "5", "2", EMPTY, "4"]);
  });

  it("filters before grouping: an empty group disappears and counts cover the filtered rows", () => {
    const { actions, state, ids } = make();
    actions.setFilters([{ columnId: "team", operator: "equals", value: "b" }] as never);
    expect(ids()).toEqual([NORTH, SOUTH]);
    expect(state().groupLayout!.rows.map((row) => [row.count, row.aggregates["qty"]])).toEqual([[1, 3], [1, 5]]);
  });

  it("moves the cursor to the group row when a collapse hides its row", () => {
    const { actions, state } = make({ defaultExpanded: EXPANDED });
    actions.setActiveCellAt({ col: 2, row: 5 });
    expect(rowIdAtViewRow(state(), 5)).toBe("5");
    actions.toggleGroup(SOUTH);
    expect(state().activeCell).toEqual({ col: 2, row: 3 });
    expect(rowIdAtViewRow(state(), 3)).toBe(SOUTH);
    expect(state().selection.current?.cell).toEqual({ col: 2, row: 3 });
  });

  it("keeps the cursor on a group row by its id through a regroup of the order", () => {
    const { actions, state } = make();
    actions.setActiveCellAt({ col: 0, row: 1 });
    actions.setSorts([{ columnId: "region", direction: "desc" }]);
    expect(rowIdAtViewRow(state(), state().activeCell!.row)).toBe(SOUTH);
    expect(state().activeCell!.row).toBe(0);
  });

  it("reads a group row as its group id", () => {
    const { state } = make();
    expect(rowIdAtViewRow(state(), 0)).toBe(NORTH);
    expect(rowIdAtViewRow(state(), 3)).toBeUndefined();
  });

  it("carries the row channel by group id for a group row and by record for a row", () => {
    const { actions, state } = make({ defaultExpanded: EXPANDED });
    const before = state().viewIndex;
    actions.setSorts([{ columnId: "region", direction: "desc" }]);
    const moved = remapRowChannel(CompactSelection.fromArray([0, 1]), before, state().viewIndex);
    expect(moved.toArray().map((row) => rowIdAtViewRow(state(), row))).toEqual([NORTH, "1"]);
  });
});

describe("writes on a grouped grid", () => {
  it("skips a cell commit, a delete, and a clear on a group row", () => {
    const onDataChange = vi.fn();
    const { actions } = make({ onDataChange });
    actions.commitCellValueAt({ col: 0, row: 0 }, "x");
    actions.deleteRowsAt([0]);
    actions.selectCellAt({ col: 0, row: 0 });
    actions.deleteSelection();
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("refuses an insert and a duplicate from a group row with the reason group-row", () => {
    const onRowActionSkipped = vi.fn();
    const { actions } = make({ onRowActionSkipped, createRow: () => ({ id: "n", region: null, team: "a", qty: 0 }), duplicateRow: (row: unknown) => ({ ...(row as Row), id: "d" }) });
    expect(actions.insertRows(0, 1, "below")).toEqual({ ok: false, reason: "group-row" });
    expect(actions.duplicateRowsAt([0] as never)).toEqual({ ok: false, reason: "group-row" });
    expect(onRowActionSkipped).toHaveBeenCalledWith(expect.objectContaining({ reason: "group-row" }));
  });

  it("inserts from a row inside a group and regroups the new row by value", () => {
    const { actions, state, ids } = make({ defaultExpanded: EXPANDED, createRow: () => ({ id: "n", region: "south", team: "a", qty: 0 }) });
    expect(actions.insertRows(2, 1, "below")).toEqual({ ok: true });
    expect(state().data).toHaveLength(6);
    expect(ids()).toContain("n");
  });

  it("keeps the view on a tick that touches no group, sort, filter, or aggregate column", () => {
    const { actions, state } = make();
    const before = state().viewIndex;
    actions.updateCells([{ rowId: "1", columnId: "team", value: "z" }], { source: "stream" });
    expect(state().viewIndex).toBe(before);
    expect(state().viewStale).toBe(false);
  });

  it("refreshes the aggregates of the touched groups only, keeping the view", () => {
    const { actions, state } = make();
    const before = state().viewIndex;
    const southBefore = state().groupLayout!.rows[1]!;
    actions.updateCells([{ rowId: "1", columnId: "qty", value: 10 }], { source: "stream" });
    expect(state().viewIndex).toBe(before);
    const rows = state().groupLayout!.rows;
    expect(rows[0]!.aggregates["qty"]).toBe(13);
    expect(rows[1]).toBe(southBefore);
    expect(groupLayoutOfView(state().viewIndex)).toBe(state().groupLayout);
  });

  it("leaves the view stale on a write to a group column and regroups on reconcile", () => {
    const { actions, state, ids } = make();
    actions.updateCells([{ rowId: "1", columnId: "region", value: "south" }], { source: "stream" });
    expect(state().viewStale).toBe(true);
    expect(ids()).toEqual([NORTH, SOUTH, EMPTY]);
    actions.reconcileView();
    expect(state().groupLayout!.rows.map((row) => row.count)).toEqual([1, 3, 1]);
    expect(state().viewStale).toBe(false);
  });

  it("regroups at once on an immediate write to a group column", () => {
    const { actions, state } = make();
    actions.updateCells([{ rowId: "1", columnId: "region", value: "south" }], { source: "stream", reorder: "immediate" });
    expect(state().groupLayout!.rows.map((row) => row.count)).toEqual([1, 3, 1]);
  });

  it("refreshes aggregates after a user edit of an aggregate column", () => {
    const { actions, state } = make({ defaultExpanded: EXPANDED });
    actions.commitCellValueAt({ col: 2, row: 1 }, 10);
    expect(state().groupLayout!.rows[0]!.aggregates["qty"]).toBe(13);
    expect(state().viewStale).toBe(false);
  });

  it("keeps toggles and group changes available on a read-only grid", () => {
    const { actions, ids } = make({ readOnly: true });
    actions.toggleGroup(NORTH);
    expect(ids()).toEqual([NORTH, "1", "3", SOUTH, EMPTY]);
  });
});

describe("a grid that cannot group the rows it holds", () => {
  it("shows the rows ungrouped with one warning when sortMode is server", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state } = make({ sortMode: "server" });
    expect(state().groupLayout).toBeNull();
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("groupBy needs every row"))).toHaveLength(1);
  });

  it("shows the rows ungrouped when they are a window of a larger result", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(make({ totalRowCount: 50 }).state().groupLayout).toBeNull();
  });

  it("shows the rows ungrouped while a row is unloaded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const data = [seed()[0], undefined, seed()[2]] as unknown as Row[];
    const { state } = make({ data, getRowId: (row: Row | undefined, index: number) => (row === undefined ? `__lazy-unloaded-${index}` : row.id) } as never);
    expect(state().groupLayout).toBeNull();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("unloaded"))).toBe(true);
  });
});

describe("controlled grouping", () => {
  type Controlled = { groupBy?: readonly string[]; expanded?: ExpandedState };
  type Callbacks = { onGroupByChange?: (next: readonly string[]) => void; onExpandedChange?: (next: ExpandedState) => void };
  const data = seed();

  function mount(initial: Controlled, callbacks: Callbacks = {}) {
    let store!: StoreApi<DataGridStoreState>;
    const Probe = () => {
      store = useDataGridStoreApi();
      return null;
    };
    const tree = (props: Controlled) => (
      <DataGridProvider data={data} columns={columns} getRowId={(row: Row) => row.id} {...props} {...callbacks}>
        <Probe />
      </DataGridProvider>
    );
    const view = render(tree(initial));
    return { store: () => store.getState(), rerender: (next: Controlled) => act(() => view.rerender(tree(next))) };
  }

  it("applies a new controlled value and keeps the view for a value equal by content", () => {
    const { store, rerender } = mount({ groupBy: ["region"], expanded: COLLAPSED });
    const view = store().viewIndex;
    rerender({ groupBy: ["region"], expanded: { mode: "collapsed", ids: [] } });
    expect(store().viewIndex).toBe(view);
    rerender({ groupBy: ["region", "qty"], expanded: { mode: "collapsed", ids: [NORTH] } });
    expect(store().groupBy).toEqual(["region", "qty"]);
    expect(store().viewIndex).not.toBe(view);
    expect(store().viewIndex.length).toBeGreaterThan(3);
  });

  it("applies a gesture at once and takes the echo of the emitted value as no change", () => {
    const emitted: ExpandedState[] = [];
    const { store, rerender } = mount({ groupBy: ["region"], expanded: COLLAPSED }, { onExpandedChange: (next) => emitted.push(next) });
    act(() => store().actions.toggleGroup(NORTH));
    expect(store().viewIndex).toHaveLength(5);
    const view = store().viewIndex;
    rerender({ groupBy: ["region"], expanded: emitted[0]! });
    expect(store().viewIndex).toBe(view);
    expect(emitted).toHaveLength(1);
  });

  it("does not undo a gesture when the same prop renders again", () => {
    const first: ExpandedState = COLLAPSED;
    const { store, rerender } = mount({ groupBy: ["region"], expanded: first });
    act(() => store().actions.toggleGroup(SOUTH));
    rerender({ groupBy: ["region"], expanded: first });
    expect(store().expanded.ids).toEqual([SOUTH]);
  });

  it("applies a foreign controlled expanded value", () => {
    const { store, rerender } = mount({ groupBy: ["region"], expanded: COLLAPSED });
    rerender({ groupBy: ["region"], expanded: EXPANDED });
    expect(store().viewIndex).toHaveLength(8);
  });

  it("drops hostile ids and a bad mode from a controlled expanded value", () => {
    const { store, rerender } = mount({ groupBy: ["region"], expanded: COLLAPSED });
    rerender({ groupBy: ["region"], expanded: { mode: "x", ids: [1, null, NORTH, NORTH] } as never });
    expect(store().expanded).toEqual({ mode: "collapsed", ids: [NORTH] });
  });
});

describe("full view of a paged grouped grid", () => {
  it("keeps a group row of the shown page readable by its id", () => {
    const { state } = make({ defaultPageSize: 2 } as never);
    expect(fullViewOf(state().viewIndex).length).toBe(3);
    expect(rowIdAtViewRow(state(), 0)).toBe(NORTH);
    expect(rowIdAtViewRow(state(), 1)).toBe(SOUTH);
  });
});

describe("a function seed", () => {
  it("groups after mount, like the function form of defaultSortState", () => {
    let store!: StoreApi<DataGridStoreState>;
    const Probe = () => {
      store = useDataGridStoreApi();
      return null;
    };
    render(
      <DataGridProvider data={seed()} columns={columns} getRowId={(row: Row) => row.id} defaultGroupBy={() => ["region"]}>
        <Probe />
      </DataGridProvider>,
    );
    expect(store.getState().groupBy).toEqual(["region"]);
    expect(store.getState().groupingEnabled).toBe(true);
    expect(store.getState().viewIndex.every((entry) => entry < 0)).toBe(true);
  });
});
