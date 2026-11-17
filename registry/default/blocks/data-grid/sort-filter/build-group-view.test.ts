import { describe, expect, it, vi } from "vitest";
import { cellTypes } from "../cell-types/cell-types";
import type { ColumnDef } from "../types";
import { textAccessorFor } from "../store/compute";
import { COLLAPSED, EXPANDED } from "../store/group-state";
import { buildViewIndex } from "./build-view-index";
import { buildGroupView, groupIdsOfRow, leavesOfTree, refreshGroupAggregates, type GroupAggregateSpec, type GroupBuildInput } from "./build-group-view";

type Row = { id: string; region: string | null; team?: string; qty: number | string | null };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "team", header: "Team", accessorKey: "team", type: "text" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

const rows: Row[] = [
  { id: "1", region: "north", team: "a", qty: 1 },
  { id: "2", region: "south", team: "a", qty: 2 },
  { id: "3", region: "north", team: "b", qty: 3 },
  { id: "4", region: null, team: "a", qty: 4 },
  { id: "5", region: "south", team: "b", qty: null },
  { id: "6", region: "north", team: "a", qty: "x" },
];

const accessorOf = (data: Row[]) => textAccessorFor(columns as never, data, cellTypes as never);

function input(overrides: Partial<GroupBuildInput> & { data?: Row[] } = {}): GroupBuildInput {
  const data = overrides.data ?? rows;
  const accessor = accessorOf(data);
  return { leaves: buildViewIndex(data.length, accessor, { sorts: [], filters: [] }), accessor, groupBy: ["region"], rowAt: (i) => data[i], ...overrides };
}

const shape = (view: ReturnType<typeof buildGroupView>) => view!.viewIndex.map((e) => (e < 0 ? view!.layout.rows[-e - 1]!.id : e));

describe("buildGroupView", () => {
  it("emits headers only while collapsed, in key order with the empty group last", () => {
    const view = buildGroupView(input(), COLLAPSED)!;
    expect(view.layout.rows.map((r) => [r.key, r.count])).toEqual([["north", 3], ["south", 2], [null, 1]]);
    expect(view.viewIndex).toEqual([-1, -2, -3]);
    expect(view.layout.leafCount).toBe(6);
  });

  it("keeps rows in leaf order inside an open group", () => {
    const view = buildGroupView(input(), EXPANDED)!;
    expect(shape(view)).toEqual(["__group:region=north", 0, 2, 5, "__group:region=south", 1, 4, "__group:region=", 3]);
  });

  it("opens only the named groups in collapsed mode, and closes only the named ones in expanded mode", () => {
    expect(shape(buildGroupView(input(), { mode: "collapsed", ids: ["__group:region=south"] }))).toEqual(["__group:region=north", "__group:region=south", 1, 4, "__group:region="]);
    expect(shape(buildGroupView(input(), { mode: "expanded", ids: ["__group:region=south"] }))).toEqual(["__group:region=north", 0, 2, 5, "__group:region=south", "__group:region=", 3]);
  });

  it("orders groups by the sort direction on the group column, the empty group still last", () => {
    const view = buildGroupView(input({ directions: new Map([["region", "desc"]]) }), COLLAPSED)!;
    expect(view.layout.rows.map((r) => r.key)).toEqual(["south", "north", null]);
  });

  it("nests two levels with ids that carry the whole path, and counts every row below a group", () => {
    const view = buildGroupView(input({ groupBy: ["region", "team"] }), EXPANDED)!;
    const north = view.layout.rows[0]!;
    expect([north.depth, north.count, north.childCount]).toEqual([0, 3, 2]);
    expect(view.layout.rows[1]).toMatchObject({ id: "__group:region=north/team=a", depth: 1, count: 2, childCount: 2 });
    expect(view.layout.rows.map((r) => r.depth)).toEqual([0, 1, 1, 0, 1, 1, 0, 1]);
  });

  it("encodes a slash, an equals sign, and a percent sign in a key so it cannot forge another id", () => {
    const data: Row[] = [{ id: "1", region: "a/team=b%", qty: 1 }, { id: "2", region: "a", qty: 1 }];
    const view = buildGroupView(input({ data, groupBy: ["region"] }), COLLAPSED)!;
    expect(view.layout.rows.map((r) => r.id)).toEqual(["__group:region=a", "__group:region=a%2Fteam%3Db%25"]);
  });

  it("keeps two keys that the collator ties as two groups, never interleaved", () => {
    const data: Row[] = [{ id: "1", region: "a", qty: 1 }, { id: "2", region: "A", qty: 1 }, { id: "3", region: "a", qty: 1 }, { id: "4", region: "A", qty: 1 }];
    const view = buildGroupView(input({ data }), EXPANDED)!;
    const keys = view.viewIndex.filter((e) => e >= 0).map((e) => data[e]!.region);
    expect(keys.join("")).toMatch(/^(aaAA|AAaa)$/);
  });

  it("gives up when a leaf is an unloaded row", () => {
    const data = [rows[0], undefined, rows[2]] as unknown as Row[];
    expect(buildGroupView(input({ data, leaves: [0, 1, 2] }), COLLAPSED)).toBeNull();
  });

  it("keys a null-prototype value through its safe text", () => {
    const hostile = Object.create(null) as never;
    const data = [{ id: "1", region: hostile, qty: 1 } as Row];
    const view = buildGroupView(input({ data }), COLLAPSED)!;
    expect(view.layout.rows[0]!.key).toBe("");
  });

  it("builds 100k rows in 1,000 groups with two levels in linear time", () => {
    const data: Row[] = Array.from({ length: 100_000 }, (_, i) => ({ id: String(i), region: `r${i % 1000}`, team: `t${i % 7}`, qty: i }));
    const started = performance.now();
    const view = buildGroupView(input({ data, groupBy: ["region", "team"], aggregates: [{ columnId: "qty", reducer: "sum" }] }), COLLAPSED)!;
    expect(view.layout.rows.filter((r) => r.depth === 0)).toHaveLength(1000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("aggregates", () => {
  const reduce = (reducer: GroupAggregateSpec["reducer"]) => buildGroupView(input({ aggregates: [{ columnId: "qty", reducer }] }), COLLAPSED)!.layout.rows.map((r) => r.aggregates["qty"]);

  it("reads finite numbers only and gives null when none counted", () => {
    expect(reduce("sum")).toEqual([4, 2, 4]);
    expect(reduce("avg")).toEqual([2, 2, 4]);
    expect(reduce("min")).toEqual([1, 2, 4]);
    expect(reduce("max")).toEqual([3, 2, 4]);
    const none = buildGroupView(input({ data: [{ id: "1", region: "a", qty: null }, { id: "2", region: "b", qty: "x" }], aggregates: [{ columnId: "qty", reducer: "sum" }] }), COLLAPSED)!;
    expect(none.layout.rows.map((r) => r.aggregates["qty"])).toEqual([null, null]);
  });

  it("counts values other than null, undefined, and the empty string", () => {
    expect(reduce("count")).toEqual([3, 1, 1]);
  });

  it("calls a function reducer with the values and the rows, and gives null with one report when it throws", () => {
    const seen: unknown[][] = [];
    reduce((values, groupRows) => (seen.push([values, groupRows.length]), values.length));
    expect(seen[0]).toEqual([[1, 3, "x"], 3]);
    const onReducerError = vi.fn();
    const throwing = () => {
      throw new Error("boom");
    };
    const view = buildGroupView(input({ aggregates: [{ columnId: "qty", reducer: throwing }], onReducerError }), COLLAPSED)!;
    expect(view.layout.rows.map((r) => r.aggregates["qty"])).toEqual([null, null, null]);
    expect(onReducerError).toHaveBeenCalled();
  });

  it("reduces again only the groups of the touched rows and their parents", () => {
    const data = rows.map((r) => ({ ...r }));
    const built = input({ data, groupBy: ["region", "team"], aggregates: [{ columnId: "qty", reducer: "sum" }] });
    const view = buildGroupView(built, EXPANDED)!;
    const tree = view.layout.tree as never;
    data[2]!.qty = 30;
    const replaced = refreshGroupAggregates(tree, [2], { ...built, accessor: accessorOf(data) });
    expect([...replaced.keys()].sort()).toEqual(["__group:region=north", "__group:region=north/team=b"]);
    expect(replaced.get("__group:region=north")!.aggregates["qty"]).toBe(31);
    expect(groupIdsOfRow(tree, 2)).toEqual(["__group:region=north/team=b", "__group:region=north"]);
    expect(leavesOfTree(tree)).toHaveLength(6);
  });
});
