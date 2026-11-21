import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupKey, ServerGroupLayout, ServerGroupSlot, ServerPivotLayout } from "../group-types";
import { MAX_PIVOT_COLUMNS, pivotColumnId, pivotSorts } from "../pivot-columns";
import type { ServerAggregate } from "../server-spec";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import type { InternalSyncProps } from "./types";

type Row = { id: string; region: string; year: number; amount: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
  { id: "note", header: "Note", accessorKey: "id" },
];

const SUM: ServerAggregate = { columnId: "amount", reducer: "sum" };
const placeholder: Row = { id: "", region: "", year: 0, amount: 0 };

const held = (keys: readonly GroupKey[], values: readonly ServerAggregate[] = [SUM], omitted = 0): ServerPivotLayout => ({
  columnId: "year",
  values,
  columns: keys.flatMap((key) => values.map((_, valueIndex) => ({ path: [key], valueIndex }))),
  omitted,
});

const slot = (viewRow: number, key: string, cells: readonly number[]): ServerGroupSlot => ({
  viewRow,
  path: [{ columnId: "region", key }],
  count: 2,
  childCount: 0,
  pivotCells: Float64Array.from(cells),
});

const layoutOf = (pivot: ServerPivotLayout | undefined): ServerGroupLayout => ({ rows: [slot(0, "EU", [1, Number.NaN]), slot(1, "US", [3, 4])], leafCount: 4, ...(pivot ? { pivot } : null) });

function make(extra: Record<string, unknown> = {}) {
  const base = { data: [placeholder, placeholder], columns, getRowId: (_r: Row, i: number) => `slot-${i}`, groupBy: ["region"], groupLayout: layoutOf(held([2024, 2025])), ...extra } as unknown as InternalSyncProps;
  const store = createDataGridStore(base);
  const state = () => store.getState();
  const sync = (next: Record<string, unknown>) => {
    const props = { ...base, ...next } as InternalSyncProps;
    getInternalActions(store)._syncConfig(props);
    getInternalActions(store)._syncProps(props);
  };
  return { store, state, sync, ids: () => state().visibleColumns.map((column) => column.id) };
}

const id2024 = pivotColumnId("year", 2024, SUM);
const id2025 = pivotColumnId("year", 2025, SUM);

afterEach(() => vi.restoreAllMocks());

describe("visible columns under pivot", () => {
  it("are the groupBy column and the generated columns, in held order", () => {
    const { ids, state } = make();
    expect(ids()).toEqual(["region", id2024, id2025]);
    expect(state().pivot?.columns.map((column) => column.header)).toEqual(["2024", "2025"]);
  });

  it("hold at most 200 generated columns and count the rest as omitted", () => {
    const keys = Array.from({ length: MAX_PIVOT_COLUMNS + 5 }, (_, i) => i);
    const { ids, state } = make({ groupLayout: layoutOf(held(keys, [SUM], 7)) });
    expect(ids()).toHaveLength(MAX_PIVOT_COLUMNS + 1);
    expect(state().pivot?.omitted).toBe(12);
  });

  it("keep one identity per held set across landings", () => {
    const pivot = held([2024, 2025]);
    const { state, sync } = make({ groupLayout: layoutOf(pivot) });
    const before = state().visibleColumns;
    sync({ groupLayout: layoutOf(pivot) });
    expect(state().visibleColumns).toBe(before);
    sync({ groupLayout: layoutOf(held([2024, 2025])) });
    expect(state().visibleColumns[1]).not.toBe(before[1]);
  });

  it("keep the generated columns when a landing changes only the omitted count", () => {
    const pivot = held([2024, 2025]);
    const { state, sync } = make({ groupLayout: layoutOf(pivot) });
    const before = { visible: state().visibleColumns, generated: state().pivot!.columns };
    sync({ groupLayout: layoutOf({ ...pivot, omitted: 3 }) });
    expect(state().pivot?.omitted).toBe(3);
    expect(state().pivot?.columns).toBe(before.generated);
    expect(state().visibleColumns).toBe(before.visible);
  });

  it("are the source columns without pivot, and source order, pins, and hidden state survive pivot on and off", () => {
    const { state, sync, ids } = make({ groupLayout: layoutOf(undefined) });
    expect(state().pivot).toBeNull();
    state().actions.setColumnHidden("note", true);
    state().actions.setColumnPin("amount", "start");
    const without = ids();
    expect(without).toEqual(["amount", "region", "year"]);
    sync({ groupLayout: layoutOf(held([2024])) });
    expect(ids()).toEqual(["region", pivotColumnId("year", 2024, SUM)]);
    expect(state().columnLayout.order.some((id) => id.startsWith("__pivot"))).toBe(false);
    sync({ groupLayout: layoutOf(undefined) });
    expect(ids()).toEqual(without);
    expect(state().hiddenColumns).toEqual(["note"]);
  });

  it("put a pinned groupBy column first: a start pin stays, an end pin drops while pivot is on", () => {
    expect(make({ columns: columns.map((c) => (c.id === "region" ? { ...c, pin: "start" as const } : c)) }).state().visibleColumns[0]).toMatchObject({ id: "region", pin: "start" });
    const { state, sync } = make({ columns: columns.map((c) => (c.id === "region" ? { ...c, pin: "end" as const } : c)) });
    expect(state().visibleColumns[0]).toMatchObject({ id: "region", pin: undefined });
    sync({ groupLayout: layoutOf(undefined) });
    expect(state().visibleColumns.at(-1)).toMatchObject({ id: "region", pin: "end" });
  });

  it("keep the groupBy column when the user hid it", () => {
    const { state, sync, ids } = make({ groupLayout: layoutOf(undefined) });
    state().actions.setColumnHidden("region", true);
    sync({ groupLayout: layoutOf(held([2024])) });
    expect(ids()[0]).toBe("region");
  });

  it("rebuild the generated headers when the labels change", () => {
    const { state, sync } = make({ groupLayout: layoutOf(held([null])) });
    expect(state().visibleColumns[1]?.header).toBe("(empty)");
    sync({ labels: { pivot: { empty: "None" } } });
    expect(state().visibleColumns[1]?.header).toBe("None");
  });
});

describe("the prefix guard", () => {
  const prefixed = [...columns, { id: "__pivot:mine", header: "Mine", accessorKey: "id" }] as ColumnDef<Row, unknown>[];

  it("drops a consumer column with a generated prefix under pivot, with one dev error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, sync } = make({ columns: prefixed, groupBy: ["__pivot:mine"] });
    expect(state().visibleColumns.map((column) => column.id)).toEqual([id2024, id2025]);
    sync({ columns: prefixed, groupBy: ["__pivot:mine"], groupLayout: layoutOf(held([2026])) });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("__pivot:mine");
  });

  it("keeps such a column without pivot", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state } = make({ columns: prefixed, groupLayout: layoutOf(undefined) });
    expect(state().visibleColumns.map((column) => column.id)).toContain("__pivot:mine");
    expect(error).not.toHaveBeenCalled();
  });
});

describe("widths of generated columns", () => {
  it("resize and reset without a layout event, and the layout never holds them", () => {
    const onColumnLayoutChange = vi.fn();
    const { state } = make({ onColumnLayoutChange });
    state().actions.setColumnWidth(id2024, 180);
    expect(state().columnWidths[id2024]).toBe(180);
    state().actions.setColumnWidth("region", 150);
    expect(state().columnWidths).toMatchObject({ [id2024]: 180, region: 150 });
    expect(Object.keys(state().columnLayout.widths)).toEqual(["region"]);
    expect(onColumnLayoutChange.mock.calls.flatMap(([layout]) => Object.keys(layout.widths))).not.toContain(id2024);
    state().actions.resetColumnWidth(id2024);
    expect(state().columnWidths[id2024]).toBeUndefined();
  });

  it("drop when the held set loses their column or pivot turns off", () => {
    const { state, sync } = make();
    state().actions.setColumnWidth(id2024, 180);
    state().actions.setColumnWidth(id2025, 190);
    state().actions.setColumnWidth("region", 150);
    sync({ groupLayout: layoutOf(held([2025])) });
    expect(state().columnWidths).toEqual({ [id2025]: 190, region: 150 });
    sync({ groupLayout: layoutOf(undefined) });
    expect(state().columnWidths).toEqual({ region: 150 });
  });

  it("autosize for the session, with no unknown-column warning and no layout event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onColumnLayoutChange = vi.fn();
    const { store, state } = make({ onColumnLayoutChange });
    getInternalActions(store)._registerMeasureFonts(() => ({ cellFont: "14px Arial", headerFont: "14px Arial", window: { start: 0, end: 2 }, hasHeaderMenu: false, hasHeaderFilter: false }));
    const measured = state().actions.autosizeColumns({ columnIds: [id2024] });
    expect(measured[id2024]).toBeGreaterThan(0);
    expect(state().columnWidths[id2024]).toBe(measured[id2024]);
    state().actions.autosizeColumns();
    expect(state().columnWidths[id2025]).toBeGreaterThan(0);
    expect(warn).not.toHaveBeenCalled();
    expect(onColumnLayoutChange.mock.calls.flatMap(([layout]) => Object.keys(layout.widths)).some((id) => id.startsWith("__pivot"))).toBe(false);
  });

  it("keep the generated column identity across a source layout commit", () => {
    const { state } = make();
    const generated = state().visibleColumns[1];
    state().actions.setColumnWidth("region", 150);
    state().actions.setColumnPin("region", "start");
    expect(state().visibleColumns[1]).toBe(generated);
  });

  it("follow a live resize preview and its cancel", () => {
    const { state } = make();
    state().actions.previewColumnWidth(id2025, 220);
    expect(state().columnWidths[id2025]).toBe(220);
    state().actions.cancelColumnResize(id2025, 220);
    expect(state().columnWidths[id2025]).toBeUndefined();
  });
});

describe("source-column actions that meet a generated id", () => {
  it("quick-search and column order neither throw nor move a source column", () => {
    const { state, sync } = make();
    expect(() => sync({ searchText: "EU" })).not.toThrow();
    const order = state().columnOrder;
    expect(state().actions.canSetColumnOrder("region", id2024, "after").ok).toBe(false);
    state().actions.setColumnOrder("region", id2024, "after");
    expect(state().columnOrder).toBe(order);
    state().actions.setColumnHidden(id2024, true);
    state().actions.setColumnPin(id2024, "start");
    expect(state().visibleColumns[1]?.id).toBe(id2024);
    expect(state().columnLayout.order.some((id) => id.startsWith("__pivot"))).toBe(false);
  });
});

describe("checks under pivot", () => {
  it("selectAllMatching() does nothing and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state } = make({ enableRowSelection: true, totalRowCount: 4, checkedRowsLifetime: "across-filters" });
    expect(state().actions.selectAllMatching()).toEqual({ ok: false, reason: "disabled" });
    state().actions.selectAllMatching();
    expect(warn.mock.calls.filter(([message]) => String(message).includes("selectAllMatching"))).toHaveLength(1);
    expect(state().allMatching).toBe(false);
  });

  it("the header select-all checks no pivot row", () => {
    const { state } = make({ enableRowSelection: true });
    state().actions.setAllRowsChecked(true);
    expect(state().selection.rows.length).toBe(0);
  });
});

describe("group toggles under pivot", () => {
  it("toggleGroup on a pivot row does nothing", () => {
    const onExpandedChange = vi.fn();
    const { state } = make({ onExpandedChange });
    const before = state().expanded;
    state().actions.toggleGroup("__group:region=EU");
    expect(state().expanded).toBe(before);
    expect(onExpandedChange).not.toHaveBeenCalled();
  });
});

describe("pivotSorts", () => {
  it("keeps only the groupBy and pivot column entries, and the same array when nothing drops", () => {
    const sorts = [
      { columnId: "amount", direction: "desc" as const },
      { columnId: "region", direction: "asc" as const },
      { columnId: "year", direction: "desc" as const },
    ];
    expect(pivotSorts(sorts, ["region"], ["year"])).toEqual(sorts.slice(1));
    const kept = sorts.slice(1);
    expect(pivotSorts(kept, ["region"], ["year"])).toBe(kept);
  });
});
