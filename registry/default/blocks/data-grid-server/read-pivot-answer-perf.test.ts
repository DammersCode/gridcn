import { describe, expect, it } from "vitest";
import { MAX_PIVOT_DESCRIPTORS, readPivotAnswer } from "./read-pivot-answer";
import { ciFactor } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

const GROUPS = 200;
const COLUMNS = 200;
const CI_FACTOR = ciFactor(2);
const options = { columnId: "year", values: [{ columnId: "amount", reducer: "sum" }] } as const;
const noWarn = () => undefined;

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

describe("readPivotAnswer perf", () => {
  it("reads and maps 200 groups x 200 cells within 3 ms", () => {
    const pivotColumns = Array.from({ length: COLUMNS }, (_, i) => ({ path: [2000 + i], valueIndex: 0 }));
    const groups = Array.from({ length: GROUPS }, (_, g) => ({ pivotCells: Array.from({ length: COLUMNS }, (_, c) => (c % 7 === 0 ? null : g * c)) }));
    const answer = { groups, pivotColumns };
    const held = readPivotAnswer(answer, GROUPS, options, noWarn).columns;
    expect(fastest(() => readPivotAnswer(answer, GROUPS, { ...options, held }, noWarn))).toBeLessThan(3 * CI_FACTOR);
  });

  it("rejects 5,001 descriptors within 0.1 ms", () => {
    const answer = { groups: [], pivotColumns: Array.from({ length: MAX_PIVOT_DESCRIPTORS + 1 }, (_, i) => ({ path: [i], valueIndex: 0 })) };
    expect(() => readPivotAnswer(answer, 0, options, noWarn)).toThrow(TypeError);
    const time = fastest(() => {
      try {
        readPivotAnswer(answer, 0, options, noWarn);
      } catch {
        // The rejection is the measured path.
      }
    });
    expect(time).toBeLessThan(0.1 * CI_FACTOR);
  });
});
