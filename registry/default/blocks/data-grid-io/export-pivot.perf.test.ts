import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { ServerGroupSlot } from "@/registry/default/blocks/data-grid/group-types";
import { createDataGridStore } from "@/registry/default/blocks/data-grid/store/create-store";
import type { InternalSyncProps } from "@/registry/default/blocks/data-grid/store/types";
import { heldYears, nestedPivotStore } from "@/registry/default/blocks/data-grid/test/nested-pivot.test-helper";
import { buildExportRows } from "./export-grid";

const ROWS = 10_000;
const COLS = 200;
/** Pivot cells read a typed array instead of an accessor, so building the pivot rows stays within this many same-run flat row builds. */
const BUDGET_FLAT_EXPORTS = 1.5;

/** Fastest of 5 interleaved runs after one warmup of each, alternating which side runs first. */
function fastestPair(a: () => void, b: () => void): [number, number] {
  a();
  b();
  const best: [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const time = (run: () => void, side: 0 | 1) => {
    const start = performance.now();
    run();
    best[side] = Math.min(best[side], performance.now() - start);
  };
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) {
      time(a, 0);
      time(b, 1);
    } else {
      time(b, 1);
      time(a, 0);
    }
  }
  return best;
}

describe("export of a 10,000 x 200 pivot", () => {
  it("builds its rows within 1.5 same-run row builds of a flat grid of the same size", async ({ annotate }) => {
    const years = Array.from({ length: COLS }, (_, i) => 1800 + i);
    const slots: ServerGroupSlot[] = [];
    for (let row = 0; row < ROWS; row++) {
      const outer = row % 10 === 0;
      const keys = outer ? [`r${row}`] : [`r${row - (row % 10)}`, `c${row}`];
      slots.push({ viewRow: row, path: keys.map((key, level) => ({ columnId: ["region", "country"][level]!, key })), count: 1, childCount: outer ? 9 : 0, pivotCells: Float64Array.from(years, (_, col) => row * 0.5 + col) });
    }
    const pivot = nestedPivotStore({ rows: slots, leafCount: ROWS * 2, pivot: heldYears(years) }, ["region", "country"]).getState();
    expect(pivot.visibleColumns).toHaveLength(COLS + 1);

    type Flat = Record<string, number>;
    const columns: ColumnDef<Flat, unknown>[] = Array.from({ length: COLS + 1 }, (_, col) => ({ id: `c${col}`, header: `C${col}`, accessorKey: `c${col}`, type: "number" }));
    const data = Array.from({ length: ROWS }, (_, row) => Object.fromEntries(columns.map((_, col) => [`c${col}`, row * 0.5 + col])) as Flat);
    const flat = createDataGridStore({ defaultData: data, columns, getRowId: (_r: Flat, i: number) => `r${i}` } as unknown as InternalSyncProps).getState();

    let pivotRows = 0;
    const [pivotMs, flatMs] = fastestPair(
      () => void (pivotRows = buildExportRows(pivot, "view").length),
      () => void buildExportRows(flat, "view"),
    );
    await annotate(`pivot rows ${pivotMs.toFixed(0)} ms, flat rows ${flatMs.toFixed(0)} ms`);
    expect(pivotRows).toBe(ROWS);
    expect(pivotMs).toBeLessThan(BUDGET_FLAT_EXPORTS * flatMs);
  }, 60_000);
});
