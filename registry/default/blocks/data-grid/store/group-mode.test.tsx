import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import type { ColumnDef } from "../types";
import type { ExpandedState, ServerGroupLayout, ServerGroupSlot } from "../group-types";
import { createDataGridStore } from "./create-store";
import { DataGridProvider } from ".";
import { useDataGridStoreApi } from "./provider";
import { groupLayoutOfView, rowAtViewRow, rowIdAtViewRow } from "./view-rows";
import { COLLAPSED } from "./group-state";
import type { DataGridStoreState, InternalSyncProps } from "./types";

type Row = { id: string; region: string; qty: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

const placeholder: Row = { id: "", region: "", qty: 0 };
const row = (id: string, region: string): Row => ({ id, region, qty: 1 });

const slot = (viewRow: number, key: string | number | boolean | null, extra: Partial<ServerGroupSlot> = {}): ServerGroupSlot => ({
  viewRow,
  path: [{ columnId: "region", key }],
  count: 3,
  childCount: 3,
  ...extra,
});

/** A group row at view rows 0 and 3, the rows of the first group between them. */
const data = (): Row[] => [placeholder, row("1", "EU"), row("2", "EU"), placeholder, row("4", "US")];
const layout = (rows: readonly ServerGroupSlot[] = [slot(0, "EU", { label: "Europe", aggregates: { qty: 2 } }), slot(3, "US", { status: "loading" })]): ServerGroupLayout => ({ rows, leafCount: 3 });

function make(props: Partial<InternalSyncProps> = {}) {
  const store = createDataGridStore({ data: data(), columns, getRowId: (r: Row, i: number) => r.id || `slot-${i}`, groupBy: ["region"], groupLayout: layout(), ...props } as unknown as InternalSyncProps);
  const state = () => store.getState();
  return { store, state, ids: () => state().viewIndex.map((_, i) => rowIdAtViewRow(state(), i)) };
}

let warn: ReturnType<typeof vi.spyOn>;
afterEach(() => vi.restoreAllMocks());
const spyWarn = () => (warn = vi.spyOn(console, "warn").mockImplementation(() => {}));

describe("groupMode", () => {
  it("is client without a layout and server with one, and the prop wins", () => {
    expect(make({ groupLayout: undefined }).state().groupMode).toBe("client");
    expect(make().state().groupMode).toBe("server");
    expect(make({ groupMode: "client" }).state().groupMode).toBe("client");
  });

  it("changes nothing for a grid that does not group", () => {
    const { state } = make({ groupBy: undefined, groupLayout: undefined });
    expect(state().groupLayout).toBeNull();
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("a server layout", () => {
  it("lays the view out at the group rows and keeps every other row at its own index", () => {
    const { state, ids } = make();
    expect(state().viewIndex).toEqual([-1, 1, 2, -2, 4]);
    expect(ids()).toEqual(["__group:region=EU", "1", "2", "__group:region=US", "4"]);
    expect(rowAtViewRow(state(), 1)).toBe(state().data[1]);
    expect(rowAtViewRow(state(), 0)).toBeUndefined();
    expect(state().groupLayout).toBe(groupLayoutOfView(state().viewIndex));
  });

  it("builds each group row from the slot: depth, key, label, counts, aggregates, status", () => {
    const [eu, us] = make().state().groupLayout!.rows;
    expect(eu).toMatchObject({ id: "__group:region=EU", depth: 0, columnId: "region", key: "EU", label: "Europe", count: 3, childCount: 3, aggregates: { qty: 2 } });
    expect(eu!.status).toBeUndefined();
    expect(us).toMatchObject({ label: "US", status: "loading" });
    expect(make().state().groupLayout!.leafCount).toBe(3);
  });

  it("derives the id of a nested group from the whole path", () => {
    const nested: ServerGroupSlot = { viewRow: 1, path: [{ columnId: "region", key: "EU" }, { columnId: "qty", key: 7 }], count: 1, childCount: 1 };
    const { ids } = make({ groupBy: ["region", "qty"], groupLayout: { rows: [slot(0, "EU"), nested], leafCount: 3 } });
    expect(ids().slice(0, 2)).toEqual(["__group:region=EU", "__group:region=EU/qty=7"]);
  });

  it("never buckets rows: rows that share a value stay in the order the server sent", () => {
    const { state } = make({ groupLayout: layout([]) });
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
    expect(state().groupLayout!.rows).toEqual([]);
  });

  it("groups over a partial result: totalRowCount and sortMode server do not ungroup it", () => {
    const { state } = make({ totalRowCount: 100, sortMode: "server" });
    expect(state().viewIndex[0]).toBe(-1);
  });

  it("builds every id itself: an id the slot carries is ignored", () => {
    const forged = { ...slot(0, "EU"), id: "__group:forged" } as ServerGroupSlot;
    expect(make({ groupLayout: { rows: [forged], leafCount: 1 } }).ids()[0]).toBe("__group:region=EU");
  });

  it("reads a hostile aggregates bag as plain numbers and nulls", () => {
    const aggregates = JSON.parse('{"qty":"x","__proto__":{"polluted":1},"n":3}') as Record<string, unknown>;
    const node = make({ groupLayout: { rows: [slot(0, "EU", { aggregates })], leafCount: 1 } }).state().groupLayout!.rows[0]!;
    expect(node.aggregates).toEqual({ qty: null, n: 3 });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("a layout the core refuses", () => {
  const cases: [string, ServerGroupSlot[]][] = [
    ["a view row out of range", [slot(9, "EU")]],
    ["view rows that do not increase", [slot(3, "EU"), slot(1, "US")]],
    ["a fractional view row", [slot(1.5, "EU")]],
    ["a key that is an object", [slot(0, { a: 1 } as never)]],
    ["a key longer than 1,024 characters", [slot(0, "x".repeat(1025))]],
    ["a count below 0", [slot(0, "EU", { count: -1 })]],
    ["the same group twice", [slot(0, "EU"), slot(3, "EU")]],
    ["an empty path", [{ ...slot(0, "EU"), path: [] }]],
    ["a path longer than groupBy", [{ ...slot(0, "EU"), path: [{ columnId: "region", key: "a" }, { columnId: "qty", key: 1 }] }]],
  ];

  it.each(cases)("renders ungrouped with one warning for %s", (_name, rows) => {
    spyWarn();
    const { state } = make({ groupLayout: { rows, leafCount: 1 } });
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
    expect(state().groupLayout).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("renders ungrouped with one warning when groupMode is server and no layout is given", () => {
    spyWarn();
    const { state } = make({ groupMode: "server", groupLayout: undefined });
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("groupLayout");
  });

  it("waits quietly for a layout of the new group columns after groupBy changed", () => {
    spyWarn();
    const { state, store } = make();
    act(() => state().actions.setGroupBy(["qty"]));
    expect(store.getState().viewIndex).toEqual([0, 1, 2, 3, 4]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("expanded state under a server layout", () => {
  it("expandAll refuses and changes nothing", () => {
    const { state } = make();
    const view = state().viewIndex;
    expect(state().actions.expandAll()).toEqual({ ok: false, reason: "server-groups" });
    expect(state().expanded).toEqual(COLLAPSED);
    expect(state().viewIndex).toBe(view);
  });

  it("collapseAll and toggleGroup work and emit; the layout stays the server's to change", () => {
    const emitted: ExpandedState[] = [];
    const { state } = make({ onExpandedChange: (next: ExpandedState) => emitted.push(next) });
    const view = state().viewIndex;
    state().actions.toggleGroup("__group:region=EU");
    expect(state().expanded).toEqual({ mode: "collapsed", ids: ["__group:region=EU"] });
    expect(emitted).toHaveLength(1);
    expect(state().viewIndex).toBe(view);
    expect(state().actions.collapseAll()).toEqual({ ok: true });
    expect(state().expanded).toEqual(COLLAPSED);
  });

  it("keeps mode collapsed when asked for mode expanded, with one warning", () => {
    spyWarn();
    const { state } = make();
    state().actions.setExpanded({ mode: "expanded", ids: [] });
    state().actions.setExpanded({ mode: "expanded", ids: ["x"] });
    expect(state().expanded).toEqual(COLLAPSED);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the layout prop", () => {
  function mount(first: ServerGroupLayout) {
    let store!: StoreApi<DataGridStoreState>;
    const Probe = () => {
      store = useDataGridStoreApi();
      return null;
    };
    const tree = (groupLayout: ServerGroupLayout, rows: Row[]) => (
      <DataGridProvider data={rows} columns={columns} getRowId={(r: Row, i: number) => r.id || `slot-${i}`} groupBy={["region"]} groupLayout={groupLayout}>
        <Probe />
      </DataGridProvider>
    );
    const rows = data();
    const view = render(tree(first, rows));
    return { state: () => store.getState(), rerender: (next: ServerGroupLayout, nextRows = rows) => act(() => view.rerender(tree(next, nextRows))) };
  }

  it("lays the view out again when the layout and the rows change together, and keeps it when neither does", () => {
    const first = layout();
    const { state, rerender } = mount(first);
    const view = state().viewIndex;
    rerender(first);
    expect(state().viewIndex).toBe(view);
    const moved = [placeholder, row("1", "EU"), placeholder, row("4", "US")];
    rerender({ rows: [slot(0, "EU"), slot(2, "US")], leafCount: 3 }, moved);
    expect(state().viewIndex).toEqual([-1, 1, -2, 3]);
    expect(state().groupLayout!.rows.map((node) => node.id)).toEqual(["__group:region=EU", "__group:region=US"]);
  });

  it("updates the status of a group row in place", () => {
    const { state, rerender } = mount(layout());
    expect(state().groupLayout!.rows[1]!.status).toBe("loading");
    rerender(layout([slot(0, "EU"), slot(3, "US", { status: "failed" })]));
    expect(state().groupLayout!.rows[1]!.status).toBe("failed");
  });
});
