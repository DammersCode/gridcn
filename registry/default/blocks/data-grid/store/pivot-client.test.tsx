import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerAggregate } from "../server-spec";
import { pivotColumnId } from "../pivot-columns";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import { pageUnitsOf } from "./group-pages";
import { getInternalActions } from "./internal-actions";
import { pivotCellAt } from "./pivot-view";
import type { InternalSyncProps } from "./types";
import { fullViewOf } from "./compute";

type Row = { id: string; region: string; city: string; year: number | null; amount: number; note: string };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "city", header: "City", accessorKey: "city" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
  { id: "note", header: "Note", accessorKey: "note", groupable: false },
];

const SUM: ServerAggregate = { columnId: "amount", reducer: "sum" };
const id = (year: number | null) => pivotColumnId("year", year, SUM);

const rows: Row[] = [
  { id: "r0", region: "EU", city: "Paris", year: 2024, amount: 1, note: "" },
  { id: "r1", region: "EU", city: "Rome", year: 2025, amount: 2, note: "" },
  { id: "r2", region: "US", city: "Austin", year: 2024, amount: 3, note: "" },
  { id: "r3", region: "US", city: "Boston", year: 2025, amount: 4, note: "" },
  { id: "r4", region: "EU", city: "Paris", year: null, amount: 5, note: "" },
];

function make(extra: Record<string, unknown> = {}) {
  const base = { data: rows.map((row) => ({ ...row })), columns, getRowId: (row: Row) => row.id, groupBy: ["region"], defaultPivot: { columnIds: ["year"] }, ...extra } as unknown as InternalSyncProps;
  const store = createDataGridStore(base);
  const state = () => store.getState();
  let props = base;
  const sync = (next: Record<string, unknown>) => {
    props = { ...props, ...next } as InternalSyncProps;
    getInternalActions(store)._syncConfig(props);
    getInternalActions(store)._syncProps(props);
  };
  const ids = () => state().visibleColumns.map((column) => column.id);
  const cells = () =>
    state().viewIndex.map((_, row) => [state().groupLayout?.rows[-state().viewIndex[row]! - 1]?.id, ...state().visibleColumns.slice(1).map((column) => pivotCellAt(state(), row, column))]);
  return { store, state, sync, ids, cells };
}

const warnings = () => vi.mocked(console.warn).mock.calls.map((call) => String(call[0]));

afterEach(() => vi.restoreAllMocks());

describe("client pivot", () => {
  it("shows the groupBy column and one generated column per key, the empty key last, with the cells of each group", () => {
    const { ids, cells, state } = make();
    expect(ids()).toEqual(["region", id(2024), id(2025), id(null)]);
    expect(cells()).toEqual([
      ["__group:region=EU", 1, 2, 5],
      ["__group:region=US", 3, 4, null],
    ]);
    expect(state().pivot?.columnId).toBe("year");
  });

  it("nests 3 levels with subtotals, and an innermost row never lists its rows", () => {
    const { state, cells } = make({ groupBy: ["region", "city", "note"], columns: columns.map((c) => (c.id === "note" ? { ...c, groupable: true } : c)), defaultExpanded: { mode: "expanded", ids: [] } });
    expect(state().viewIndex.every((entry) => entry < 0)).toBe(true);
    expect(cells()[0]).toEqual(["__group:region=EU", 1, 2, 5]);
    expect(cells()[1]).toEqual(["__group:region=EU/city=Paris", 1, null, 5]);
    const innermost = state().groupLayout!.rows.filter((node) => node.depth === 2);
    expect(innermost.every((node) => node.childCount === 0)).toBe(true);
  });

  it("shows the group counts only when no column has an aggregate", () => {
    const { ids, state } = make({ columns: columns.map(({ aggregate: _, ...c }) => c) });
    expect(ids()).toEqual(["region"]);
    expect(state().groupLayout?.rows.map((node) => node.count)).toEqual([3, 2]);
  });

  it("ignores the pivot without groupBy, warning once", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state, sync } = make({ groupBy: [] });
    sync({ data: rows.map((row) => ({ ...row })) });
    expect(state().pivot).toBeNull();
    expect(state().viewIndex).toEqual([0, 1, 2, 3, 4]);
    expect(warnings().filter((m) => m.includes("pivot needs groupBy"))).toHaveLength(1);
  });

  it.each([
    ["an unknown column", "missing"],
    ["a column that is not groupable", "note"],
    ["a groupBy column", "region"],
  ])("ignores %s as the pivot column, warning in development", (_, columnId) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state, ids } = make({ defaultPivot: { columnIds: [columnId] } });
    expect(state().pivot).toBeNull();
    expect(ids()).toEqual(["region", "city", "year", "amount", "note"]);
    expect(warnings().some((m) => m.includes(`pivot names the column "${columnId}"`))).toBe(true);
  });

  it.each([
    ["totalRowCount", { totalRowCount: 5 }],
    ['sortMode="server"', { sortMode: "server" }],
  ])("keeps the grid ungrouped under %s with the window warning", (_, extra) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state } = make(extra);
    expect(state().pivot).toBeNull();
    expect(state().viewIndex.every((entry) => entry >= 0)).toBe(true);
    expect(warnings().some((m) => m.includes("groupBy needs every row on the client"))).toBe(true);
  });

  it("keeps the grid ungrouped above 1,000,000 cells, warning with the cap", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const many = Array.from({ length: 5_001 }, (_, i) => ({ id: `r${i}`, region: `g${i}`, city: "", year: i % 200, amount: 1, note: "" }));
    const { state } = make({ data: many });
    expect(state().pivot).toBeNull();
    expect(state().groupLayout).toBeNull();
    expect(warnings().some((m) => m.includes("more than 1,000,000 cells"))).toBe(true);
  });

  it("survives a key whose generated id would throw, and counts it as omitted", () => {
    const { state, ids } = make({ data: [...rows, { id: "r5", region: "EU", city: "", year: "bad\uD800", amount: 9, note: "" }] });
    expect(ids()).toEqual(["region", id(2024), id(2025), id(null)]);
    expect(state().pivot?.omitted).toBe(1);
  });

  it("orders the keys by a sort on the pivot column", () => {
    const { state, ids } = make();
    state().actions.setSorts([{ columnId: "year", direction: "desc" }]);
    expect(ids()).toEqual(["region", id(2025), id(2024), id(null)]);
  });

  it("drops a key that a filter removes, and the active cell follows its column id", () => {
    const { state, ids } = make();
    state().actions.selectCellAt({ row: 1, col: 2 });
    expect(state().activeCell).toEqual({ row: 1, col: 2 });
    state().actions.setFilters([{ columnId: "year", operator: "equals", value: "2025" }]);
    expect(ids()).toEqual(["region", id(2025)]);
    expect(state().activeCell).toEqual({ row: 1, col: 1 });
  });

  it("restores the column order, pins, widths, and hidden state when the pivot turns off", () => {
    const { state, ids } = make({ defaultPivot: undefined });
    state().actions.setColumnHidden("note", true);
    state().actions.setColumnPin("amount", "start");
    state().actions.setColumnWidth("city", 222);
    const without = ids();
    state().actions.setPivot({ columnIds: ["year"] });
    expect(ids()).toEqual(["region", id(2024), id(2025), id(null)]);
    state().actions.setColumnWidth(id(2024), 150);
    state().actions.setPivot(undefined);
    expect(ids()).toEqual(without);
    expect(state().hiddenColumns).toEqual(["note"]);
    expect(state().columnWidths["city"]).toBe(222);
    expect(state().pivot).toBeNull();
  });

  it("keeps the pivot when the labels change or a layout action runs", () => {
    const { state, sync, ids } = make();
    const before = ids();
    sync({ labels: { pivot: { empty: "(none)" } } });
    expect(ids()).toEqual(before);
    expect(state().pivot?.columns.at(-1)?.header).toBe("(none)");
    state().actions.setColumnLayout({ widths: { city: 120 } });
    expect(ids()).toEqual(before);
  });
});

describe("pivot props", () => {
  it("applies a controlled pivot, and an equal value in a new object rebuilds nothing", () => {
    const { state, sync, ids } = make({ defaultPivot: undefined, pivot: { columnIds: ["year"] } });
    expect(ids()[1]).toBe(id(2024));
    const view = state().viewIndex;
    sync({ pivot: { columnIds: ["year"] } });
    expect(state().viewIndex).toBe(view);
    sync({ pivot: { columnIds: [] } });
    expect(state().pivot).toBeNull();
    expect(state().pivotControlled).toBe(true);
  });

  it("fires onPivotChange after the write, with undefined when it turns off, and a throwing consumer keeps the page reset", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: unknown[] = [];
    const onPageChange = vi.fn();
    const { state } = make({
      defaultPivot: undefined,
      pageSize: 1,
      page: 2,
      onPageChange,
      onPivotChange: (next: unknown) => {
        seen.push([next, state().pivot?.columnId ?? null]);
        throw new Error("consumer");
      },
    });
    state().actions.setPivot({ columnIds: ["year"] });
    state().actions.setPivot({ columnIds: ["year"] });
    state().actions.setPivot(undefined);
    expect(seen).toEqual([[{ columnIds: ["year"] }, "year"], [undefined, null]]);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("ignores the echo of an emitted pivot", () => {
    const { state, sync } = make({ defaultPivot: undefined, pivot: { columnIds: [] }, onPivotChange: (next: unknown) => (emitted = next) });
    let emitted: unknown;
    state().actions.setPivot({ columnIds: ["year"] });
    const view = state().viewIndex;
    sync({ pivot: emitted });
    expect(state().viewIndex).toBe(view);
    expect(state().pivot?.columnId).toBe("year");
  });

  it("counts the top-level pivot rows as page units under client pagination", () => {
    const { state } = make({ pageSize: 1, defaultExpanded: { mode: "expanded", ids: [] } });
    expect(pageUnitsOf(fullViewOf(state().viewIndex))).toBe(2);
    expect(state().viewIndex).toHaveLength(1);
  });
});
