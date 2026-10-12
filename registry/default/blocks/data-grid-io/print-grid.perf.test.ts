import { describe, expect, it } from "vitest";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { buildExportRows, exportDataIndices } from "./export-grid";

/**
 * Dedicated unit perf test for the print row pipeline: proves the display-text row build
 * (getCellValue + display text per cell) stays under 1 s at 10,000 rows x 20 columns — the
 * algorithmic cost of one print pass, measured without the DOM (print stubbed). The DOM table
 * build inside printGrid is linear createElement work and stays out of the budget: jsdom's node
 * cost is not representative of a browser's. Same discipline as view-index-perf.test.ts: warm
 * up, best-of-N, a CI factor for shared runners.
 */

const ROW_COUNT = 10_000;
const COL_COUNT = 20;

// Shared GitHub Actions runners are several × slower than a dev machine; the ceiling guards the
// order of magnitude, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;
const BUDGET_MS = 1_000 * CI_FACTOR;

type Row = Record<string, unknown>;

function makeState(): DataGridStoreState {
  const data: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => {
    const row: Row = { id: String(i) };
    for (let c = 0; c < COL_COUNT; c++) row[`c${c}`] = `value ${i}-${c}`;
    return row;
  });
  const toText = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  return {
    data,
    visibleColumns: Array.from({ length: COL_COUNT }, (_, c) => ({ id: `c${c}`, header: `C${c}`, accessorKey: `c${c}`, type: "text" })),
    viewIndex: data.map((_, i) => i),
    cellTypes: {
      text: {
        Cell: () => null,
        Editor: () => null,
        toText,
        fromText: (t: unknown) => t,
        clearValue: () => "",
        isEmpty: (v: unknown) => v === "" || v === null || v === undefined,
      },
    },
  } as unknown as DataGridStoreState;
}

/** Warms up `fn` then times `iterations` runs, returning the fastest run in ms. */
function measure(fn: () => void, iterations: number, warmup = 3): number {
  for (let i = 0; i < warmup; i++) fn();
  // Best-of-N, not the mean: parallel test workers stall single runs, an algorithmic regression slows every run.
  let fastest = Infinity;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

describe("print row pipeline performance", () => {
  it(`builds display-text rows for ${ROW_COUNT} rows x ${COL_COUNT} columns in under ${BUDGET_MS} ms`, () => {
    const state = makeState();

    const elapsed = measure(
      () => {
        const indices = exportDataIndices(state, "view");
        const rows = buildExportRows(state, "view", { text: "display", maxRows: ROW_COUNT });
        expect(indices.length).toBe(ROW_COUNT);
        expect(rows.length).toBe(ROW_COUNT);
        expect(rows[0]!.length).toBe(COL_COUNT);
      },
      5,
    );

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
