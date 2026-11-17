import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataGrid, useDataGridActions, type ColumnDef, type DataGridActions } from "@/registry/default/blocks/data-grid/data-grid";
import { createDataGridStore } from "@/registry/default/blocks/data-grid/store/create-store";
import type { InternalSyncProps } from "@/registry/default/blocks/data-grid/store/types";
import { useDataGridStoreApi, type DataGridReadState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { buildExportRows, exportDataIndices } from "@/registry/default/blocks/data-grid-io/export-grid";
import { planReplace } from "@/registry/default/blocks/data-grid-find-replace/plan-replace";
import { buildFillCandidatesFromText } from "@/registry/default/blocks/data-grid-fill/use-fill-handle";
import { viewRowOfRowId } from "@/registry/default/blocks/data-grid-comments/own-cell";
import { useDataGridAggregate } from "@/registry/default/blocks/data-grid-pinned-rows/use-data-grid-aggregate";
import { useDataGridSelectionStats } from "@/registry/default/blocks/data-grid-status-bar/use-data-grid-selection-stats";
import { useDefaultGroupRowMenuItems, useDefaultHeaderMenuItems, type GridMenuItemSpec } from "@/registry/default/blocks/data-grid-context-menu/menu-items";

type Row = { id: string; region: string; qty: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
];

const seed = (): Row[] => [
  { id: "1", region: "north", qty: 1 },
  { id: "2", region: "south", qty: 2 },
  { id: "3", region: "north", qty: 3 },
];

const NORTH = "__group:region=north";

function grouped(props: Partial<InternalSyncProps> = {}) {
  const store = createDataGridStore({ data: seed(), columns, getRowId: (row: Row) => row.id, defaultGroupBy: ["region"], ...props } as unknown as InternalSyncProps);
  return { store, read: () => store.getState() as unknown as DataGridReadState };
}

afterEach(cleanup);

describe("export of a grouped grid", () => {
  it("holds the rows of collapsed groups and no group row", () => {
    const { read } = grouped();
    expect(read().viewIndex.every((entry) => entry < 0)).toBe(true);
    expect(exportDataIndices(read(), "view")).toEqual([0, 2, 1]);
    expect(exportDataIndices(read(), "page")).toEqual([]);
  });

  it("skips a group row inside a range selection", () => {
    const { store, read } = grouped({ defaultExpanded: { mode: "expanded", ids: [] } });
    store.getState().actions.selectCellAt({ row: 0, col: 0 });
    store.getState().actions.extendToAt({ row: 2, col: 1 });
    expect(exportDataIndices(read(), "view")).toEqual([0, 2, 1]);
    expect(buildExportRows(read(), "ranges")).toEqual([["north", "1"], ["north", "3"]]);
  });
});

describe("replace in a grouped grid", () => {
  it("plans no patch for a group row and reads the rows of the open groups", () => {
    const { store, read } = grouped({ defaultExpanded: { mode: "collapsed", ids: [NORTH] } });
    expect(store.getState().viewIndex.some((entry) => entry < 0)).toBe(true);
    const plan = planReplace(read() as never, "north", "west", {});
    expect(plan.patches.map((patch) => patch.rowId)).toEqual(["1", "3"]);
  });
});

describe("fill in a grouped grid", () => {
  it("builds no candidate for a group row", () => {
    const { read } = grouped({ defaultExpanded: { mode: "expanded", ids: [] } });
    const strip = { x: 0, y: 0, width: 1, height: 5 };
    const candidates = buildFillCandidatesFromText(read() as never, strip, [["x"], ["x"], ["x"], ["x"], ["x"]]);
    expect(candidates.map((candidate) => candidate.rowId)).toEqual(["1", "3", "2"]);
  });
});

describe("comments in a grouped grid", () => {
  it("finds the view row of a data row and never of a group row", () => {
    const { read } = grouped({ defaultExpanded: { mode: "expanded", ids: [] } });
    expect(viewRowOfRowId(read() as DataGridReadState, "3")).toBe(2);
    expect(viewRowOfRowId(read() as DataGridReadState, NORTH)).toBe(-1);
  });
});

function Probe(props: { onValue: (value: unknown) => void; use: () => unknown; onActions?: (actions: DataGridActions) => void }) {
  const actions = useDataGridActions();
  const storeApi = useDataGridStoreApi();
  props.onValue(props.use());
  props.onActions?.(actions);
  void storeApi;
  return null;
}

function mount(use: () => unknown, props: Record<string, unknown> = {}) {
  const values: unknown[] = [];
  let actions!: DataGridActions;
  render(
    <DataGrid aria-label="Test" data={seed()} columns={columns} getRowId={(row) => row.id} defaultGroupBy={["region"]} {...props}>
      <Probe use={use} onValue={(value) => values.push(value)} onActions={(a) => (actions = a)} />
    </DataGrid>,
  );
  return { last: () => values.at(-1), actions: () => actions };
}

describe("pinned-row aggregate of a grouped grid", () => {
  it("reduces the rows of collapsed groups and reads no group row as a hole", () => {
    const { last } = mount(() => useDataGridAggregate({ qty: "sum" }));
    expect(last()).toEqual({ qty: 6 });
  });
});

describe("selection stats of a grouped grid", () => {
  it("count the values of rows and none of the group row", () => {
    const { last, actions } = mount(() => useDataGridSelectionStats(), { defaultExpanded: { mode: "expanded", ids: [] } });
    act(() => {
      actions().selectCellAt({ row: 0, col: 1 });
      actions().extendToAt({ row: 4, col: 1 });
    });
    expect((last() as { numeric: number; sum: number }).numeric).toBe(3);
    expect((last() as { sum: number }).sum).toBe(6);
  });
});

describe("menus of a grouped grid", () => {
  const ids = (specs: unknown) => (specs as GridMenuItemSpec[]).map((spec) => spec.id);

  it("offers Group by on a groupable column, Ungroup on a group column, and nothing without the gate", () => {
    const region = mount(() => useDefaultHeaderMenuItems({ columnId: "region", scrollRoot: null }));
    expect(ids(region.last())).toContain("ungroup");
    const qty = mount(() => useDefaultHeaderMenuItems({ columnId: "qty", scrollRoot: null }));
    expect(ids(qty.last())).toContain("group-by");
    const off = mount(() => useDefaultHeaderMenuItems({ columnId: "qty", scrollRoot: null }), { defaultGroupBy: undefined });
    expect(ids(off.last())).not.toContain("group-by");
    expect(ids(off.last())).not.toContain("ungroup");
  });

  it("gives a group row copy, toggle, expand all, and collapse all", () => {
    const { last } = mount(() => useDefaultGroupRowMenuItems(0));
    expect(ids(last())).toEqual(["copy", "sep-group", "toggle-group", "expand-all", "collapse-all"]);
  });
});
