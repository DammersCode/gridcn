import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { computeRowEditsBatch } from "./commit";
import type { DataGridStoreState } from "./types";

const ROW_COUNT = 100_000;
const WRITE_COUNT = 200_000;

// Shared GitHub Actions runners are several × slower than a dev machine; the ceiling guards the
// order of magnitude, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;

type WideRow = { [key: string]: number | string | undefined } & { id: string };

type Write = { viewRow: number; columnId: string; value: unknown };

function makeState(columns: readonly ColumnDef<WideRow, unknown>[], rows: WideRow[]): DataGridStoreState {
  return {
    data: rows,
    columns,
    visibleColumns: columns,
    viewIndex: rows.map((_, i) => i),
    getRowId: (row: WideRow) => row.id,
    cellTypes: cellTypes as unknown as DataGridStoreState["cellTypes"],
  } as unknown as DataGridStoreState;
}

function makeWideRows(count: number): WideRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}` }));
}

function makeMutatingColumns(count: number): readonly ColumnDef<WideRow, unknown>[] {
  return Array.from({ length: count }, (_, column) => ({
    id: `c${column}`,
    header: `C${column}`,
    accessorKey: `c${column}`,
    type: "number",
  }));
}

function makeMutatingWrites(columnCount: number): Write[] {
  const writes: Write[] = [];
  for (let write = 0; write < WRITE_COUNT; write++) {
    writes.push({
      viewRow: write % ROW_COUNT,
      columnId: `c${write % columnCount}`,
      value: write + 1,
    });
  }
  return writes;
}

function makeMutatingRows(columnCount: number): WideRow[] {
  return Array.from({ length: ROW_COUNT }, (_, row) => {
    const entry: WideRow = { id: `row-${row}` };
    for (let column = 0; column < columnCount; column++) {
      entry[`c${column}`] = row;
    }
    return entry;
  });
}

describe("computeRowEditsBatch perf (100k rows)", () => {
  it("keeps a 200k-write mutating batch below the allocation-heavy ceiling", () => {
    const columnCount = 20;
    const columns = makeMutatingColumns(columnCount);
    const rows = makeMutatingRows(columnCount);
    const writes = makeMutatingWrites(columnCount);
    const s = makeState(columns, rows);

    const warmup = computeRowEditsBatch(s, writes);
    void warmup;

    const iterations = 3;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      computeRowEditsBatch(s, writes);
    }
    const ms = (performance.now() - start) / iterations;
    console.log(`commit batch 100k rows / 200k mutating writes / 20 columns: ${ms.toFixed(2)}ms`);
    // Allocation-bound (one new row object per accepted write); ~5× the ~370ms local mean (×CI_FACTOR on CI).
    expect(ms).toBeLessThan(2000 * CI_FACTOR);
    // Warmup + 3 measured iterations of a 100k-row / 200k-write batch exceeds the default 5s
    // timeout on a slow CI runner (the assertion is a per-iteration mean, not a total), so give
    // it the same generous wall budget as the no-op test below.
  }, 30_000);

  it("keeps 200k no-op writes column-count independent (Map lookup, not a per-write .find)", () => {
    const makeFixtures = (columnCount: number) => {
      const columns = Array.from({ length: columnCount }, (_, column) => ({
        id: `l${column}`,
        header: `L${column}`,
        accessorKey: `l${column}`,
      }));
      const rows = makeWideRows(ROW_COUNT);
      const writes: Write[] = Array.from({ length: WRITE_COUNT }, (_, write) => ({
        viewRow: write % ROW_COUNT,
        columnId: `l${columnCount - 1}`,
        value: undefined,
      }));
      return { s: makeState(columns, rows), writes };
    };

    const narrow = makeFixtures(20);
    const wide = makeFixtures(200);

    expect(computeRowEditsBatch(narrow.s, narrow.writes)).toBeNull();
    expect(computeRowEditsBatch(wide.s, wide.writes)).toBeNull();

    const iterations = 5;
    const narrowStart = performance.now();
    for (let i = 0; i < iterations; i++) computeRowEditsBatch(narrow.s, narrow.writes);
    const narrowMs = (performance.now() - narrowStart) / iterations;

    const wideStart = performance.now();
    for (let i = 0; i < iterations; i++) computeRowEditsBatch(wide.s, wide.writes);
    const wideMs = (performance.now() - wideStart) / iterations;

    console.log(
      `commit no-op 100k rows / 200k writes: 20 cols ${narrowMs.toFixed(2)}ms, 200 cols ${wideMs.toFixed(2)}ms`,
    );
    // One Map hit per write: cost scales with write count, not column count. A per-write `.find`
    // across 200 columns is ~10× the 20-column cost; comparing both on the same machine is
    // machine-independent, so a slow CI runner can't trip it (the Plan 001 regression guard).
    expect(wideMs).toBeLessThan(narrowMs * 3);
  }, 30_000);
});
