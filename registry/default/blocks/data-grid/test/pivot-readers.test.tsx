import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildCsv, buildExportHeaders, buildExportRows, buildXlsx } from "@/registry/default/blocks/data-grid-io/export-grid";
import { listZip } from "@/registry/default/blocks/data-grid-io/xlsx-fixtures.test-helper";
import { planReplace } from "@/registry/default/blocks/data-grid-find-replace/plan-replace";
import { copyScopeCellIds, serializeCopyScope } from "../clipboard/use-grid-clipboard";
import type { GroupKey, ServerGroupLayout, ServerGroupSlot, ServerPivotLayout } from "../group-types";
import type { ServerAggregate } from "../server-spec";
import { computeSearchMatches } from "../store/compute";
import { createDataGridStore } from "../store/create-store";
import { pivotCellText } from "../store/pivot-view";
import type { InternalSyncProps } from "../store/types";
import type { ColumnDef } from "../types";
import { viewIndex } from "../types";

type Row = { id: string; region: string; year: number; amount: number };

const CI_FACTOR = process.env["CI"] ? 2 : 1;

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
];

const SUM: ServerAggregate = { columnId: "amount", reducer: "sum" };
const COUNT: ServerAggregate = { columnId: "amount", reducer: "count" };
const placeholder: Row = { id: "", region: "", year: 0, amount: 0 };

const held = (keys: readonly GroupKey[], values: readonly ServerAggregate[] = [SUM]): ServerPivotLayout => ({
  columnId: "year",
  values,
  columns: keys.flatMap((key) => values.map((_, valueIndex) => ({ path: [key], valueIndex }))),
  omitted: 0,
});

const slot = (viewRow: number, key: string, cells?: readonly number[]): ServerGroupSlot => ({
  viewRow,
  path: [{ columnId: "region", key }],
  count: 2,
  childCount: 0,
  ...(cells ? { pivotCells: Float64Array.from(cells) } : null),
});

function make(layout: ServerGroupLayout, extra: Record<string, unknown> = {}) {
  const onDataChange = vi.fn();
  const props = {
    data: layout.rows.map(() => placeholder),
    columns,
    getRowId: (_r: Row, i: number) => `slot-${i}`,
    groupBy: ["region"],
    groupLayout: layout,
    enableRowSelection: true,
    onDataChange,
    ...extra,
  } as unknown as InternalSyncProps;
  const store = createDataGridStore(props);
  return { store, state: () => store.getState(), onDataChange };
}

const twoRows = (pivot: ServerPivotLayout = held([2024, 2025])): ServerGroupLayout => ({ rows: [slot(0, "EU", [1234.567, Number.NaN]), slot(1, "US", [3, 0])], leafCount: 4, pivot });

const csvLines = async (blob: Blob) => (await blob.text()).replace(/^﻿/, "").split("\r\n");

describe("pivotCellText", () => {
  it("formats a pivot cell like a group aggregate, reads NaN as empty and 0 as 0, and gives the plain key for the groupBy column", () => {
    const { state } = make(twoRows());
    const [region, y2024, y2025] = state().visibleColumns;
    expect(pivotCellText(state(), 0, y2024)).toBe("1,234.57");
    expect(pivotCellText(state(), 0, y2025)).toBe("");
    expect(pivotCellText(state(), 1, y2025)).toBe("0");
    expect(pivotCellText(state(), 1, region)).toBe("US");
  });

  it("is undefined without pivot", () => {
    const { pivot: _dropped, ...layout } = twoRows();
    const { state } = make(layout);
    expect(pivotCellText(state(), 0, state().visibleColumns[0])).toBeUndefined();
  });

  it("follows the grid locale", () => {
    const { state } = make(twoRows(), { locale: "de-DE" });
    expect(pivotCellText(state(), 0, state().visibleColumns[1])).toBe("1.234,57");
  });
});

describe("copy", () => {
  it("writes the key and the pivot cell text of a rect, and a cut clears nothing", () => {
    const { state } = make(twoRows());
    const scope = { kind: "rect", rect: { x: 0, y: 0, width: 3, height: 2 } } as const;
    expect(serializeCopyScope(state(), scope)).toEqual([["EU", "1,234.57", ""], ["US", "3", "0"]]);
    expect(serializeCopyScope(state(), { kind: "columns", columns: [1] })).toEqual([["1,234.57"], ["3"]]);
    expect(copyScopeCellIds(state(), scope).rowIds).toEqual([]);
  });
});

describe("export and print", () => {
  it("exports the pivot rows with `key / value` headers when a key holds two values", async () => {
    const { state } = make(twoRows(held([2024], [SUM, COUNT])));
    const [sumHeader, countHeader] = state().pivot!.columns.map((column) => column.header as string);
    const lines = await csvLines(buildCsv(state()));
    expect(lines[0]).toBe(`Region,2024 / ${sumHeader},2024 / ${countHeader}`);
    expect(lines.slice(1)).toEqual(['EU,"1,234.57",', "US,3,0"]);
  });

  it("neutralizes formula-like pivot keys and group keys in CSV", async () => {
    const { state } = make({ rows: [slot(0, "=cmd|' /C calc'!A0", [1])], leafCount: 2, pivot: held(["=HYPERLINK(1)"]) });
    const lines = await csvLines(buildCsv(state()));
    expect(lines[0]).toBe("Region,'=HYPERLINK(1)");
    expect(lines[1]).toBe("'=cmd|' /C calc'!A0,1");
  });

  it("writes a formula-like pivot key as an XLSX string cell and a pivot cell as a number", async () => {
    const { state } = make({ rows: [slot(0, "=cmd()", [1234.5])], leafCount: 2, pivot: held(["=SUM(A1)"]) });
    const entries = listZip(new Uint8Array(await (await buildXlsx(state())).arrayBuffer()));
    const xml = entries.map((entry) => new TextDecoder().decode(entry.data)).join(" ");
    expect(xml).not.toMatch(/<f[ >]/);
    expect(xml).toContain("=SUM(A1)");
    expect(xml).toContain("=cmd()");
    expect(xml).toMatch(/<c r="B2"[^>]*><v>1234.5<\/v><\/c>/);
  });

  it("prints the display rows and skips a pivot row whose cells did not land", () => {
    const { state } = make({ rows: [slot(0, "EU", [5]), slot(1, "US")], leafCount: 4, pivot: held([2024]) });
    expect(buildExportRows(state(), "view", { text: "display" })).toEqual([["EU", "5"]]);
    expect(buildExportHeaders(state())).toEqual(["Region", "2024"]);
  });

  it("checks no pivot row, so a checked-rows export is empty", () => {
    const { state } = make(twoRows());
    state().actions.setRowCheckedAt(viewIndex(0), true);
    expect(state().selection.rows.length).toBe(0);
    expect(buildExportRows(state(), "checked-rows")).toEqual([]);
  });
});

describe("find and replace", () => {
  it("finds pivot cells by their shown text, and replace plans no write", () => {
    const { state } = make(twoRows());
    state().actions.setSearch("1,234.57");
    expect(state().searchMatches).toEqual([{ row: 0, columnId: state().visibleColumns[1]!.id }]);
    const plan = planReplace(state(), "3", "9");
    expect(plan.patches).toEqual([]);
  });

  it("scans 1,000 × 200 pivot cells within 100 ms", () => {
    const keys = Array.from({ length: 200 }, (_, i) => 2000 + i);
    const rows = Array.from({ length: 1_000 }, (_, row) => slot(row, `g${row}`, keys.map((_, col) => (row === 999 && col === 199 ? 987_654.25 : row * 7 + col))));
    const { state } = make({ rows, leafCount: 2_000, pivot: held(keys) });
    const s = state();
    expect(s.visibleColumns).toHaveLength(201);
    let best = Infinity;
    let found: ReturnType<typeof computeSearchMatches> | undefined;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      found = computeSearchMatches(s.data, s.columns, s.viewIndex, s.visibleColumns, "987,654.25", s.cellTypes, s.searchOptions, s.locale);
      best = Math.min(best, performance.now() - start);
    }
    expect(found!.searchMatches).toEqual([{ row: 999, columnId: s.visibleColumns[200]!.id }]);
    expect(best).toBeLessThan(100 * CI_FACTOR);
  });
});

describe("writes", () => {
  it("refuse edit start, commit, and bulk writes on a pivot row", () => {
    const { state, onDataChange } = make(twoRows());
    const generated = state().visibleColumns[1]!.id;
    state().actions.startEditingAt({ col: 1, row: 0 });
    expect(state().editing).toBeNull();
    state().actions.commitCellValueAt({ col: 1, row: 0 }, 9);
    state().actions.commitCellValueAt({ col: 0, row: 0 }, "XX");
    state().actions.applyCellUpdates([{ viewRowIndex: 0, columnId: generated, value: 9 }, { viewRowIndex: 1, columnId: "region", value: "XX" }], "paste");
    expect(onDataChange).not.toHaveBeenCalled();
    expect(state().data.every((row) => row === placeholder)).toBe(true);
  });
});

describe("autosize", () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = ((contextId: string) =>
      contextId === "2d" ? { set font(_value: string) {}, measureText: (text: string) => ({ width: text.length * 7 }) } : null) as typeof HTMLCanvasElement.prototype.getContext;
  });

  it("measures the pivot cell text, not only the header", () => {
    const { store, state } = make({ rows: [slot(0, "EU", [123_456_789.25])], leafCount: 2, pivot: held([2024]) });
    store.setState({ measureFonts: () => ({ cellFont: "14px sans", headerFont: "14px sans", cellPadding: 16, hasHeaderMenu: false, hasHeaderFilter: false, window: null }) });
    const widths = state().actions.autosizeColumns();
    const generated = state().visibleColumns[1]!.id;
    expect(widths[generated]).toBeGreaterThanOrEqual("123,456,789.25".length * 7);
  });
});
