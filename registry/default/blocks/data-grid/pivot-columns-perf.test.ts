import { describe, expect, it } from "vitest";
import { buildColumnGroupModel, computeHeaderRows } from "./columns/column-groups";
import { buildPivotColumns } from "./pivot-columns";
import type { ColumnDef } from "./types";
import { ciFactor } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

const KEYS = 50;
const CI_FACTOR = ciFactor(2);
const values = [
  { columnId: "a", reducer: "sum" },
  { columnId: "b", reducer: "avg" },
  { columnId: "c", reducer: "max" },
  { columnId: "d", reducer: "count" },
] as const;
const source: ColumnDef<unknown>[] = ["region", "year", "a", "b", "c", "d"].map((id) => ({ id, header: id, type: "number" }));
const labels = { empty: "(empty)", value: (reducer: string, column: string) => `${reducer} of ${column}`, columnName: (key: string, value: string) => `${key}, ${value}` };
const pivot = {
  columnId: "year",
  values,
  columns: Array.from({ length: KEYS }, (_, key) => values.map((_, valueIndex) => ({ path: [2000 + key], valueIndex }))).flat(),
  omitted: 0,
};

function fastest(fn: () => void, iterations = 5, warmup = 2): number {
  for (let i = 0; i < warmup; i++) fn();
  let best = Infinity;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function build() {
  const { columns, groups } = buildPivotColumns(pivot, source, labels);
  const visible = [{ id: "region" }, ...columns];
  return computeHeaderRows(visible, buildColumnGroupModel(groups, visible.map((c) => c.id)));
}

describe("buildPivotColumns perf", () => {
  it("builds 200 columns and the header rows of 50 groups within 2 ms", () => {
    expect(build()[0]).toHaveLength(KEYS);
    expect(fastest(build)).toBeLessThan(2 * CI_FACTOR);
  });
});
