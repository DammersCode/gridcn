import { beforeAll, describe, expect, it } from "vitest";
import type { AnyColumnDef } from "../store";
import type { CellType } from "../types";
import { computeAutosizeWidths, type AutosizeState } from "./autosize-columns";

// jsdom has no real canvas 2d context; stub `measureText` with a char-count-based width
// (7px/char) so the width arithmetic below still exercises the real engine logic.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
    if (contextId !== "2d") return null;
    return {
      set font(_value: string) {},
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
  }) as typeof HTMLCanvasElement.prototype.getContext;
});

const PX = 7; // stubbed canvas: 7px per char

function makeCellType(partial: Partial<CellType>): CellType {
  return {
    Cell: () => null,
    Editor: () => null,
    toText: (v: unknown) => String(v),
    fromText: (t: unknown) => t,
    clearValue: () => "",
    isEmpty: (v: unknown) => v === "" || v === null || v === undefined,
    ...partial,
  } as CellType;
}

const TEXT = makeCellType({});

type Row = { a: unknown; b?: unknown; v?: unknown };

function makeState(overrides: Partial<AutosizeState> = {}): AutosizeState {
  const columns: AnyColumnDef[] = [
    { id: "a", header: "Alpha", accessorKey: "a" },
    { id: "b", header: "Beta", accessorKey: "b" },
  ];
  const data: Row[] = [{ a: "1", b: "2" }, { a: "3", b: "4" }, { a: "5", b: "6" }];
  return {
    columns,
    visibleColumns: columns,
    hiddenColumns: [],
    columnWidths: {},
    viewIndex: data.map((_, i) => i),
    data,
    cellTypes: { text: TEXT },
    sortState: [],
    enableColumnResize: true,
    hasHeaderMenu: false,
    ...overrides,
  };
}

// header "Alpha"/"Beta" = 5 chars = 35px; the default state's cell values are single chars (7px)
const DEFAULT_WIDTH = 35 + 20;

describe("computeAutosizeWidths", () => {
  it("sizes to the widest sampled cell, including values far outside the mounted window", () => {
    const rows: Row[] = Array.from({ length: 100 }, () => ({ a: "1", b: "2" }));
    rows[90] = { a: "L".repeat(100), b: "2" };
    const widths = computeAutosizeWidths(makeState({ viewIndex: rows.map((_, i) => i), data: rows }), { cellFont: "f", headerFont: "f" }, null, { sampleRows: 10 });
    // stride 10 hits row 90: 100 chars * 7px + 20px padding
    expect(widths["a"]).toBe(100 * PX + 20);
  });

  it("always includes the mounted window's rows in the sample", () => {
    const rows: Row[] = Array.from({ length: 1000 }, () => ({ a: "1", b: "2" }));
    const state = { viewIndex: rows.map((_, i) => i), data: rows };
    const fonts = { cellFont: "f", headerFont: "f" };
    // stride 100 samples rows 0, 100, ...; row 955 is only in via the window
    const without = computeAutosizeWidths(makeState(state), fonts, null, { sampleRows: 10 });
    expect(without["a"]).toBe(DEFAULT_WIDTH);
    rows[955] = { a: "L".repeat(80), b: "2" };
    const withWindow = computeAutosizeWidths(makeState(state), fonts, { start: 950, end: 960 }, { sampleRows: 10 });
    expect(withWindow["a"]).toBe(80 * PX + 20);
  });

  it.each([[1999], [1500], [1001], [2999], [10999]])("samples evenly through the tail and includes the last row (count %i)", (count) => {
    const sampleRows = 1000;
    const touched: number[] = [];
    const rows = new Proxy([] as Row[], {
      get(_target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) {
          touched.push(Number(key));
          return { a: "1", b: "2" };
        }
        return undefined;
      },
    });
    computeAutosizeWidths(makeState({ viewIndex: Array.from({ length: count }, (_, i) => i), data: rows }), { cellFont: "f", headerFont: "f" }, null, { sampleRows });
    const sorted = [...new Set(touched)].sort((x, y) => x - y);
    expect(sorted.at(-1)).toBe(count - 1);
    const maxGap = Math.max(...sorted.slice(1).map((row, i) => row - sorted[i]!));
    expect(maxGap).toBeLessThanOrEqual(Math.ceil(count / sampleRows));
  });

  it("adds the sort-indicator and header-menu trigger allowances to the header width", () => {
    const widths = computeAutosizeWidths(
      makeState({ sortState: [{ columnId: "a", direction: "asc" }], hasHeaderMenu: true }),
      { cellFont: "f", headerFont: "f" },
      null,
    );
    // a: "Alpha" 35px header + 30px sorted affordance + 18px menu trigger; b: "Beta" 28px header + trigger
    expect(widths["a"]).toBe(35 + 30 + 18 + 20);
    expect(widths["b"]).toBe(28 + 18 + 20);
  });

  it("skips the header text when includeHeader is false", () => {
    const state = makeState();
    (state.columns[0] as { header: string }).header = "H".repeat(11); // 77px header
    (state.data[0] as { a: unknown }).a = "0123456789"; // 70px cell
    expect(computeAutosizeWidths(state, { cellFont: "f", headerFont: "f" }, null, { includeHeader: false })["a"]).toBe(70 + 20);
    expect(computeAutosizeWidths(state, { cellFont: "f", headerFont: "f" }, null, { includeHeader: true })["a"]).toBe(77 + 20);
  });

  it("clamps to the column's min/max", () => {
    const state = makeState({
      columns: [
        { id: "a", header: "Alpha", accessorKey: "a", maxWidth: 100 },
        { id: "b", header: "Beta", accessorKey: "b", minWidth: 500 },
      ] as AnyColumnDef[],
      visibleColumns: [
        { id: "a", header: "Alpha", accessorKey: "a", maxWidth: 100 },
        { id: "b", header: "Beta", accessorKey: "b", minWidth: 500 },
      ] as AnyColumnDef[],
      data: [{ a: "L".repeat(50), b: "2" }],
    });
    const widths = computeAutosizeWidths(state, { cellFont: "f", headerFont: "f" }, null);
    expect(widths["a"]).toBe(100);
    expect(widths["b"]).toBe(500);
  });

  it("targets only the requested columns; hidden, non-resizable, and unknown ids are skipped", () => {
    const state = makeState({
      columns: [
        { id: "a", header: "Alpha", accessorKey: "a" },
        { id: "b", header: "Beta", accessorKey: "b" },
        { id: "c", header: "Gamma", accessorKey: "c", resizable: false },
      ] as AnyColumnDef[],
      visibleColumns: [
        { id: "a", header: "Alpha", accessorKey: "a" },
        { id: "c", header: "Gamma", accessorKey: "c", resizable: false },
      ] as AnyColumnDef[],
      hiddenColumns: ["b"],
    });
    const widths = computeAutosizeWidths(state, { cellFont: "f", headerFont: "f" }, null, { columnIds: ["a", "b", "c", "missing"] });
    expect(Object.keys(widths)).toEqual(["a"]);
  });

  it("skips lazy holes (undefined data rows) without reading them", () => {
    const state = makeState({
      data: [{ a: "L".repeat(40), b: "2" }, undefined, { a: "3", b: "4" }] as Row[],
      viewIndex: [0, 1, 2],
    });
    expect(computeAutosizeWidths(state, { cellFont: "f", headerFont: "f" }, null)["a"]).toBe(40 * PX + 20);
  });

  it("measures the cell type's display text, not the raw value", () => {
    const money = makeCellType({ toDisplayText: (v: unknown) => "#".repeat(20) + String(v) });
    const state = makeState({
      columns: [{ id: "m", header: "Money", accessorKey: "v", type: "money" }] as AnyColumnDef[],
      visibleColumns: [{ id: "m", header: "Money", accessorKey: "v", type: "money" }] as AnyColumnDef[],
      cellTypes: { text: TEXT, money },
      data: [{ v: 1 }],
    });
    // display text = 20 '#' + "1" = 21 chars
    expect(computeAutosizeWidths(state, { cellFont: "f", headerFont: "f" }, null)["m"]).toBe(21 * PX + 20);
  });

  it("cuts sample texts to 1000 chars before measuring", () => {
    const state = makeState({ data: [{ a: "L".repeat(2000), b: "2" }] });
    expect(computeAutosizeWidths(state, { cellFont: "f", headerFont: "f" }, null)["a"]).toBe(1000 * PX + 20);
  });

  it("clamps sampleRows into [1, 10000]", () => {
    const rows: Row[] = Array.from({ length: 20_000 }, () => ({ a: "1", b: "2" }));
    rows[19_997] = { a: "L".repeat(80), b: "2" };
    const state = { viewIndex: rows.map((_, i) => i), data: rows };
    const fonts = { cellFont: "f", headerFont: "f" };
    // 50000 clamps to 10000 → every second row → row 19997 (odd) never sampled
    expect(computeAutosizeWidths(makeState(state), fonts, null, { sampleRows: 50_000 })["a"]).toBe(DEFAULT_WIDTH);
    // sampleRows 0/undefined clamp to at least 1: only rows 0 and 9 + window rows are sampled
    const small: Row[] = Array.from({ length: 10 }, () => ({ a: "1", b: "2" }));
    small[5] = { a: "L".repeat(80), b: "2" };
    const smallState = { viewIndex: small.map((_, i) => i), data: small };
    expect(computeAutosizeWidths(makeState(smallState), fonts, null, { sampleRows: 0 })["a"]).toBe(DEFAULT_WIDTH);
  });

  it("returns {} when nothing is measurable", () => {
    expect(computeAutosizeWidths(makeState({ enableColumnResize: false }), { cellFont: "f", headerFont: "f" }, null)).toEqual({});
    expect(
      computeAutosizeWidths(
        makeState({ columns: [] as AnyColumnDef[], visibleColumns: [] as AnyColumnDef[] }),
        { cellFont: "f", headerFont: "f" },
        null,
      ),
    ).toEqual({});
  });

  it("measures the header even with an empty view", () => {
    expect(computeAutosizeWidths(makeState({ data: [], viewIndex: [] }), { cellFont: "f", headerFont: "f" }, null)["a"]).toBe(DEFAULT_WIDTH);
  });
});
