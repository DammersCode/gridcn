import { describe, expect, it } from "vitest";
import { cellTypes, type AnyColumnDef, type FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { distinctColumnValues, type DistinctValuesInput } from "./distinct-values";
import { bestMs as fastestMs, budget } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

const ROWS = 100_000;
const MAX_RUNS = 9;

const columns = [
  { id: "city", accessorKey: "city", header: "City" },
  { id: "age", accessorKey: "age", header: "Age", type: "number" },
  { id: "status", accessorKey: "status", header: "Status" },
] as AnyColumnDef[];

const filters: FilterSpec[] = [
  { columnId: "age", operator: "gte", value: "10" },
  { columnId: "status", operator: "notEquals", value: "closed" },
  { columnId: "city", operator: "isAnyOf", value: ["ignored"] },
];

function makeInput(cardinality: number): DistinctValuesInput {
  const data = Array.from({ length: ROWS }, (_, i) => ({
    city: `City ${(i * 7919) % cardinality}`,
    age: i % 100,
    status: i % 5 === 0 ? "closed" : "open",
  }));
  return { data, columns, cellTypes: cellTypes as DistinctValuesInput["cellTypes"], filterState: filters };
}

type PlainRow = { city: string; age: number; status: string };

/** The same filter and count mix without the library code. */
function plainCount(data: readonly PlainRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of data) {
    if (row.age < 10 || row.status === "closed") continue;
    counts.set(row.city, (counts.get(row.city) ?? 0) + 1);
  }
  return counts;
}

/** Best of up to {@link MAX_RUNS} runs after a warmup, stopping at the first run within `budgetMs`: load only slows single runs. */
function bestMs(input: DistinctValuesInput, budgetMs: number): number {
  distinctColumnValues(input, "city");
  let best = Infinity;
  for (let i = 0; i < MAX_RUNS && best >= budgetMs; i++) {
    const start = performance.now();
    distinctColumnValues(input, "city");
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("distinctColumnValues perf", () => {
  // Columns: cardinality, idle floor in ms (about 5x the idle run, wide enough for coverage), k times the same-run plain count.
  it.each([
    [10, 60, 50],
    [1_000, 60, 40],
    [10_000, 150, 60],
    [100_000, 1200, 200],
  ])("counts %i distinct values over 100k rows with two other filters within %i ms", (cardinality, budgetMs, k) => {
    const input = makeInput(cardinality);
    const referenceMs = fastestMs(() => plainCount(input.data as PlainRow[]));
    const limit = budget({ floor: budgetMs, cap: budgetMs * 3, k, reference: referenceMs });
    const elapsed = bestMs(input, limit);
    expect(distinctColumnValues(input, "city").values.length).toBeLessThanOrEqual(cardinality);
    expect(elapsed).toBeLessThan(limit);
  });
});
