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
    const { ids, state } = make({ columns: columns.filter((c) => c.id !== "amount") });
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

  it("fires onPivotChange after the write, with { columnIds: [] } when it turns off, and a throwing consumer keeps the page reset", () => {
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
    expect(seen).toEqual([[{ columnIds: ["year"] }, "year"], [{ columnIds: [] }, null]]);
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

describe("pivot refresh after a write", () => {
  const frames: (() => void)[] = [];
  const runFrames = () => frames.splice(0).forEach((run) => run());
  const stubFrames = () => {
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
    vi.stubGlobal("cancelAnimationFrame", () => {});
  };
  afterEach(() => {
    frames.length = 0;
    vi.unstubAllGlobals();
  });

  it("refreshes the cells of a value write in place and keeps the view, the generated columns, and the visible columns", () => {
    const { state, cells } = make();
    const before = { view: state().viewIndex, generated: state().pivot!.columns, visible: state().visibleColumns, us: state().groupLayout!.rows[1] };
    state().actions.updateCells([{ rowId: "r0", columnId: "amount", value: 10 }], { source: "stream" });
    expect(cells()).toEqual([
      ["__group:region=EU", 10, 2, 5],
      ["__group:region=US", 3, 4, null],
    ]);
    expect(state().viewIndex).toBe(before.view);
    expect(state().pivot!.columns).toBe(before.generated);
    expect(state().visibleColumns).toBe(before.visible);
    expect(state().groupLayout!.rows[1]).toBe(before.us);
    expect(state().viewStale).toBe(false);
  });

  it("keeps the view settled under a sort on a value column", () => {
    const { state, cells } = make({ defaultSortState: [{ columnId: "amount", direction: "desc" }] });
    state().actions.updateCells([{ rowId: "r3", columnId: "amount", value: 40 }], { source: "stream" });
    expect(cells()[1]).toEqual(["__group:region=US", 3, 40, null]);
    expect(state().viewStale).toBe(false);
  });

  it("rebuilds on the next frame after a write to the pivot column, with a new key", () => {
    stubFrames();
    const { state, ids, cells } = make();
    state().actions.updateCells([{ rowId: "r4", columnId: "year", value: 2026 }], { source: "stream" });
    expect(state().viewStale).toBe(false);
    runFrames();
    expect(ids()).toEqual(["region", id(2024), id(2025), id(2026)]);
    expect(cells()[0]).toEqual(["__group:region=EU", 1, 2, 5]);
  });

  it("rebuilds on the next frame after a write to a groupBy column", () => {
    stubFrames();
    const { state, cells } = make();
    state().actions.updateCells([{ rowId: "r0", columnId: "region", value: "US" }], { source: "stream" });
    runFrames();
    expect(cells()).toEqual([
      ["__group:region=EU", null, 2, 5],
      ["__group:region=US", 4, 4, null],
    ]);
  });

  it("refreshes the cells and keeps the generated columns through a committed change, as undo and redo apply it", () => {
    const { state, cells } = make();
    const generated = state().pivot!.columns;
    const prev = state().data[1] as Row;
    state().actions.commitChange({ source: "history", ops: [{ type: "update", rowId: "r1", row: { ...prev, amount: 20 }, prev }] });
    expect(cells()[0]).toEqual(["__group:region=EU", 1, 20, 5]);
    expect(state().pivot!.columns).toBe(generated);
  });

  it("rebuilds the cells of a replaced row id at the next frame", () => {
    stubFrames();
    const { state, cells } = make();
    state().actions.replaceRowId("r1", { ...(state().data[1] as Row), id: "n1", amount: 7 });
    expect(cells()[0]).toEqual(["__group:region=EU", 1, 2, 5]);
    runFrames();
    expect(cells()[0]).toEqual(["__group:region=EU", 1, 7, 5]);
  });
});

describe("pivot refresh against a full build", () => {
  it("matches a fresh grid after random value writes, with averages of fractional values", () => {
    let seed = 9;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const avgColumns = columns.map((c) => (c.id === "amount" ? { ...c, aggregate: "avg" as const } : c));
    const data: Row[] = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, region: `g${i % 5}`, city: `c${i % 3}`, year: i % 7, amount: random() * 100 - 50, note: "" }));
    const live = make({ data, columns: avgColumns, groupBy: ["region", "city"], defaultExpanded: { mode: "expanded", ids: [] } });
    for (let step = 0; step < 40; step++) {
      const patches = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ rowId: `r${Math.floor(random() * 300)}`, columnId: "amount", value: random() < 0.1 ? null : random() * 100 - 50 }));
      live.state().actions.updateCells(patches, { source: "stream" });
      const fresh = make({ data: live.state().data, columns: avgColumns, groupBy: ["region", "city"], defaultExpanded: { mode: "expanded", ids: [] } });
      expect(live.cells(), `step ${step}`).toEqual(fresh.cells());
    }
  });
});

describe("streamed rows under a client pivot", () => {
  const extra = (id: string, region: string, year: number | null, amount: number): Row => ({ id, region, city: "Paris", year, amount, note: "" });

  it("places appended rows of known groups and keys in place, keeping the view and the generated columns", () => {
    const live = make();
    const before = { view: live.state().viewIndex, generated: live.state().pivot!.columns, visible: live.state().visibleColumns };
    const data = [...(live.state().data as Row[]), extra("s0", "US", 2024, 10), extra("s1", "EU", null, 0.5)];
    live.sync({ data });
    expect(live.state().viewIndex).toBe(before.view);
    expect(live.state().pivot!.columns).toBe(before.generated);
    expect(live.state().visibleColumns).toBe(before.visible);
    expect(live.cells()).toEqual(make({ data }).cells());
    expect(live.state().groupLayout!.rows.map((node) => node.count)).toEqual([4, 3]);
    expect(live.state().groupLayout!.leafCount).toBe(7);
  });

  it("rebuilds for an appended row with a new key or a new group", () => {
    const live = make();
    const view = live.state().viewIndex;
    live.sync({ data: [...(live.state().data as Row[]), extra("s0", "US", 2030, 1)] });
    expect(live.ids()).toContain(id(2030));
    live.sync({ data: [...(live.state().data as Row[]), extra("s1", "APAC", 2024, 1)] });
    expect(live.state().viewIndex).not.toBe(view);
    expect(live.cells().map((row) => row[0])).toEqual(["__group:region=APAC", "__group:region=EU", "__group:region=US"]);
  });

  it("skips an appended row that the filters drop", () => {
    const live = make({ defaultFilterState: [{ columnId: "city", operator: "equals", value: "Paris" }] });
    const before = live.cells();
    live.sync({ data: [...(live.state().data as Row[]), { ...extra("s0", "EU", 2024, 100), city: "Rome" }] });
    expect(live.cells()).toEqual(before);
  });
});

describe("client pivot refresh edge cases", () => {
  const frames: (() => void)[] = [];
  afterEach(() => {
    frames.length = 0;
    vi.unstubAllGlobals();
  });

  it.each(["defer", "frame"] as const)("rebuilds an appended row over a pending %s write to a groupBy column", (reorder) => {
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const live = make();
    live.state().actions.updateCells([{ rowId: "r0", columnId: "region", value: "US" }], { source: "stream", reorder });
    const data = [...(live.state().data as Row[]), { id: "s0", region: "EU", city: "", year: 2025, amount: 7, note: "" }];
    live.sync({ data });
    frames.splice(0).forEach((run) => run());
    expect(live.cells()).toEqual(make({ data }).cells());
  });

  it("shows a value write on another page under client pagination", () => {
    const live = make({ pageSize: 1 });
    live.state().actions.updateCells([{ rowId: "r3", columnId: "amount", value: 40 }], { source: "stream" });
    live.state().actions.setPage(2);
    expect(live.cells()).toEqual([["__group:region=US", 3, 40, null]]);
  });
});

describe("a function seed of the pivot", () => {
  it("starts without the pivot and applies the seed once after mount", async () => {
    const { applyFunctionSeeds } = await import("./function-seed");
    const seed = vi.fn(() => ({ columnIds: ["year"] }));
    const init = { data: rows.map((row) => ({ ...row })), columns, getRowId: (row: Row) => row.id, groupBy: ["region"], defaultPivot: seed } as unknown as InternalSyncProps;
    const store = createDataGridStore(init);
    expect(store.getState().pivot).toBeNull();
    applyFunctionSeeds(store, init);
    applyFunctionSeeds(store, init);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(store.getState().pivot?.columnId).toBe("year");
  });
});

describe("client pivot fix round", () => {
  const frames: (() => void)[] = [];
  const runFrames = () => frames.splice(0).forEach((run) => run());
  afterEach(() => {
    frames.length = 0;
    vi.unstubAllGlobals();
  });
  const stubFrames = () => {
    vi.stubGlobal("requestAnimationFrame", (run: () => void) => frames.push(run));
    vi.stubGlobal("cancelAnimationFrame", () => {});
  };

  it("keeps the old cells until the next-frame rebuild when one push writes a value and a groupBy column of the same row", () => {
    stubFrames();
    const live = make();
    const before = live.cells();
    live.state().actions.updateRows([{ rowId: "r0", changes: { amount: 10, region: "US" } }], { source: "stream" });
    expect(live.cells()).toEqual(before);
    runFrames();
    expect(live.cells()).toEqual(make({ data: live.state().data }).cells());
  });

  it("keeps the old cells until the next-frame rebuild for a value write to a filtered column", () => {
    stubFrames();
    const live = make({ defaultFilterState: [{ columnId: "amount", operator: "lt", value: "100" }] });
    const before = live.cells();
    live.state().actions.updateCells([{ rowId: "r1", columnId: "amount", value: 500 }], { source: "stream" });
    expect(live.cells()).toEqual(before);
    runFrames();
    expect(live.cells()[0]).toEqual(["__group:region=EU", 1, null, 5]);
  });

  it("schedules no rebuild for a stream write after the writes are disposed", () => {
    stubFrames();
    const live = make();
    getInternalActions(live.store)._disposeWrites();
    live.state().actions.updateCells([{ rowId: "r0", columnId: "region", value: "US" }], { source: "stream" });
    expect(frames).toHaveLength(0);
  });

  it("emits { columnIds: [] } for off, and a controlled round trip with late parent renders stays consistent", () => {
    const emitted: unknown[] = [];
    const live = make({ defaultPivot: undefined, pivot: { columnIds: [] }, onPivotChange: (next: unknown) => emitted.push(next) });
    live.state().actions.setPivot({ columnIds: ["year"] });
    live.state().actions.setPivot({ columnIds: [] });
    live.state().actions.setPivot({ columnIds: ["city"] });
    live.state().actions.setPivot(undefined);
    expect(emitted).toEqual([{ columnIds: ["year"] }, { columnIds: [] }, { columnIds: ["city"] }, { columnIds: [] }]);
    const view = live.state().viewIndex;
    for (const pivot of emitted) {
      live.sync({ pivot });
      expect(live.state().pivot).toBeNull();
      expect(live.state().viewIndex).toBe(view);
    }
  });

  it("refreshes every swapped row of replaceRowIds and rebuilds at the next frame for a key change", () => {
    stubFrames();
    const live = make();
    const data = live.state().data as Row[];
    live.state().actions.replaceRowIds([
      { oldId: "r0", row: { ...data[0]!, id: "n0", amount: 11 } },
      { oldId: "r3", row: { ...data[3]!, id: "n3", amount: 44 } },
      { oldId: "r1", row: { ...data[1]!, id: "n1", year: 2024 } },
    ]);
    runFrames();
    expect(live.cells()).toEqual(make({ data: live.state().data }).cells());
    expect(live.state().viewStale).toBe(false);
  });
});
