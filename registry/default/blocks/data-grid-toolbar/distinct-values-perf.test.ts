import { describe, expect, it } from "vitest";
import { cellTypes, type AnyColumnDef, type FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { distinctColumnValues, type DistinctValuesInput } from "./distinct-values";

// Shared GitHub Actions runners are several x slower than a dev machine; the ceiling guards an
// algorithmic regression, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;

const ROWS = 100_000;
const RUNS = 5;

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
  return { data, columns, cellTypes: cellTypes as DistinctValuesInput["cellTypes"], filterState: filters, joinOperator: "and" };
}

function medianMs(input: DistinctValuesInput): number {
  distinctColumnValues(input, "city");
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    distinctColumnValues(input, "city");
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[RUNS >> 1]!;
}

describe("distinctColumnValues perf", () => {
  it.each([
    [10, 200],
    [1_000, 200],
    [10_000, 200],
    [100_000, 600],
  ])("counts %i distinct values over 100k rows with two other filters within %i ms", (cardinality, budgetMs) => {
    const input = makeInput(cardinality);
    const elapsed = medianMs(input);
    expect(distinctColumnValues(input, "city").values.length).toBeLessThanOrEqual(cardinality);
    expect(elapsed).toBeLessThan(budgetMs * CI_FACTOR);
  });
});
