import { describe, expect, it } from "vitest";
import { cellTypes, type AnyColumnDef, type FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { distinctColumnValues, type DistinctValuesInput } from "./distinct-values";

// Shared GitHub Actions runners are several x slower than a dev machine; the ceiling guards an
// algorithmic regression, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;

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
  it.each([
    [10, 200],
    [1_000, 200],
    [10_000, 200],
    [100_000, 600],
  ])("counts %i distinct values over 100k rows with two other filters within %i ms", (cardinality, budgetMs) => {
    const input = makeInput(cardinality);
    const elapsed = bestMs(input, budgetMs * CI_FACTOR);
    expect(distinctColumnValues(input, "city").values.length).toBeLessThanOrEqual(cardinality);
    expect(elapsed).toBeLessThan(budgetMs * CI_FACTOR);
  });
});
