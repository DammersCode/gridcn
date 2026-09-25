import { describe, expect, it } from "vitest";
import type { FilterSpec, SortSpec } from "../types";
import { buildViewIndex, type CellAccessor } from "./build-view-index";

/**
 * Dedicated unit perf test for the view-index pipeline: proves matches-filter + buildViewIndex
 * stay fast at 100k rows across the filter/sort combinations (join operator, isBetween,
 * multi-column sort), independent of any rendering — same discipline as
 * store-search-perf.test.tsx (warm up, N iterations, generous ceiling documented per-case) so a
 * regression here is a real algorithmic one, not UI noise.
 */

const ROW_COUNT = 100_000;

// Shared GitHub Actions runners are several × slower than a dev machine; the heavy ceilings
// guard the order of magnitude, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;

type Row = { id: string; name: string; email: string; age: number; score: number; joined: string };

function makeRows(count: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      name: i % 7 === 0 ? `needle ${i}` : `Person ${i}`,
      email: `person${i}@example.com`,
      age: 18 + (i % 60),
      score: i % 100,
      joined: `${2015 + (i % 10)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    });
  }
  return rows;
}

function accessorFor(rows: readonly Row[]): CellAccessor {
  return {
    getText(rowIndex, columnId) {
      const row = rows[rowIndex];
      if (!row) return "";
      const value = row[columnId as keyof Row];
      return value === undefined || value === null ? "" : String(value);
    },
  };
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

describe("view-index pipeline perf (100k rows)", () => {
  const rows = makeRows(ROW_COUNT);
  const accessor = accessorFor(rows);

  it("(a) single text filter (contains)", () => {
    const filters: FilterSpec[] = [{ columnId: "name", operator: "contains", value: "needle" }];
    const ms = measure(() => buildViewIndex(ROW_COUNT, accessor, { sorts: [], filters }), 10);
    console.log(`view-index (a) single text filter: ${ms.toFixed(2)}ms`);
    // Single filter pass is one O(n) `.filter` call plus per-row substring search — generous vs.
    // measured (~5-15ms locally); catches an accidental O(n^2) (e.g. a nested scan), not machine jitter.
    expect(ms).toBeLessThan(200);
  });

  it("(b) 3 filters with AND", () => {
    const filters: FilterSpec[] = [
      { columnId: "name", operator: "contains", value: "Person" },
      { columnId: "age", operator: "gte", value: "20" },
      { columnId: "score", operator: "lt", value: "90" },
    ];
    const ms = measure(() => buildViewIndex(ROW_COUNT, accessor, { sorts: [], filters }), 10);
    console.log(`view-index (b) 3 filters AND: ${ms.toFixed(2)}ms`);
    // AND narrows via sequential `.filter` re-scans of a shrinking array — still O(n) total work
    // bounded by 3x the single-filter pass; ceiling scales accordingly.
    expect(ms).toBeLessThan(400);
  });

  it("(c) 3 filters with OR", () => {
    const filters: FilterSpec[] = [
      { columnId: "name", operator: "contains", value: "needle" },
      { columnId: "age", operator: "lt", value: "20" },
      { columnId: "score", operator: "gte", value: "98" },
    ];
    const ms = measure(() => buildViewIndex(ROW_COUNT, accessor, { sorts: [], filters, joinOperator: "or" }), 10);
    console.log(`view-index (c) 3 filters OR: ${ms.toFixed(2)}ms`);
    // OR is a single O(n) pass with `.some` short-circuiting per row — should be comparable to (a),
    // not 3x like AND's re-scan chain; ceiling still generous for CI load.
    expect(ms).toBeLessThan(300);
  });

  it("(d) isBetween on number and date columns", () => {
    const filters: FilterSpec[] = [
      { columnId: "score", operator: "isBetween", value: ["20", "80"] },
      { columnId: "joined", operator: "isBetween", value: ["2017-01-01", "2022-12-31"] },
    ];
    const ms = measure(() => buildViewIndex(ROW_COUNT, accessor, { sorts: [], filters }), 10);
    console.log(`view-index (d) isBetween number+date: ${ms.toFixed(2)}ms`);
    // Two comparison filters, each doing two per-row bound comparisons (min/max) — roughly double
    // a single comparison filter's per-row cost; still one O(n) pass per filter.
    expect(ms).toBeLessThan(400);
  });

  it("(e) 3-column sort", () => {
    const sorts: SortSpec[] = [
      { columnId: "score", direction: "asc" },
      { columnId: "age", direction: "desc" },
      { columnId: "name", direction: "asc" },
    ];
    const ms = measure(() => buildViewIndex(ROW_COUNT, accessor, { sorts, filters: [] }), 5);
    console.log(`view-index (e) 3-column sort: ${ms.toFixed(2)}ms`);
    // O(n) key-decoration per sort column (3x) + one O(n log n) comparator-composed sort — the
    // dominant cost; an accidental per-comparison getText call (O(n log n) calls instead of O(n))
    // would blow well past this on 100k rows (observed 1112ms on a loaded CI runner).
    expect(ms).toBeLessThan(1000 * CI_FACTOR);
  }, 30_000);

  it("(f) filter + sort combined", () => {
    const filters: FilterSpec[] = [
      { columnId: "name", operator: "contains", value: "Person" },
      { columnId: "age", operator: "gte", value: "20" },
    ];
    const sorts: SortSpec[] = [
      { columnId: "score", direction: "asc" },
      { columnId: "age", direction: "desc" },
    ];
    const ms = measure(() => buildViewIndex(ROW_COUNT, accessor, { sorts, filters }), 5);
    console.log(`view-index (f) filter+sort combined: ${ms.toFixed(2)}ms`);
    // Filter narrows the array before sort operates on it, so the sort's O(n log n) runs on a
    // smaller n — combined cost should track close to (b)+(e), not their product.
    expect(ms).toBeLessThan(700 * CI_FACTOR);
  }, 30_000);
});
