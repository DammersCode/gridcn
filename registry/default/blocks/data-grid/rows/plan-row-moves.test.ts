import { describe, expect, it } from "vitest";
import { applyChange, invertChange } from "../interaction/history";
import type { DataOp } from "../types";
import { planBlockMove, planShiftMove, type RowMovePlan } from "./plan-row-moves";

const CI_FACTOR = process.env["CI"] ? 2 : 1;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);
const getId = (row: string) => row;

function permute(order: readonly string[], newIndexOf: ArrayLike<number>): string[] {
  const out = new Array<string>(order.length);
  for (let i = 0; i < order.length; i++) out[newIndexOf[i]!] = order[i]!;
  return out;
}

function movesOf(order: string[], plan: RowMovePlan): DataOp<string>[] {
  return plan.sources.map((from, i) => ({ type: "move", rowId: order[from]!, row: order[from]!, from, to: plan.targets[i]! }));
}

function lcg(seed: number) {
  let state = seed;
  return (max: number) => (state = (state * 1103515245 + 12345) & 0x7fffffff) % max;
}

function expectRoundTrip(order: string[], plan: RowMovePlan) {
  const change = { ops: movesOf(order, plan), source: "row-operation" } as const;
  const next = applyChange(order, change, getId);
  expect(next).toEqual(permute(order, plan.newIndexOf));
  expect(applyChange(next, invertChange(change), getId)).toEqual(order);
}

describe("planBlockMove", () => {
  it("lands the block contiguous in its current order at the final index", () => {
    const plan = planBlockMove(8, [1, 3, 6], 4)!;
    expect(permute(ids(8), plan.newIndexOf)).toEqual(["r0", "r2", "r4", "r5", "r1", "r3", "r6", "r7"]);
    expect(plan.sources).toEqual([1, 3, 6]);
    expect(plan.targets).toEqual([4, 5, 6]);
  });

  it("dedupes and sorts the input", () => {
    const plan = planBlockMove(5, [3, 1, 3, 1], 0)!;
    expect(plan.sources).toEqual([1, 3]);
    expect(permute(ids(5), plan.newIndexOf)).toEqual(["r1", "r3", "r0", "r2", "r4"]);
  });

  it("returns null for no-ops and invalid input", () => {
    expect(planBlockMove(5, [], 0)).toBeNull();
    expect(planBlockMove(5, [1, 2], 1)).toBeNull();
    expect(planBlockMove(5, [0], 5)).toBeNull();
    expect(planBlockMove(5, [3, 4], 4)).toBeNull();
    expect(planBlockMove(5, [-1], 2)).toBeNull();
    expect(planBlockMove(5, [5], 2)).toBeNull();
    expect(planBlockMove(5, [1.5], 2)).toBeNull();
    expect(planBlockMove(5, [1], 1.5)).toBeNull();
  });

  it("keeps the block contiguous when the target overlaps the own selection", () => {
    const plan = planBlockMove(6, [1, 2, 3], 2)!;
    expect(permute(ids(6), plan.newIndexOf)).toEqual(["r0", "r4", "r1", "r2", "r3", "r5"]);
  });

  it("applies and inverts through applyChange for random batches", () => {
    const rand = lcg(7);
    for (let round = 0; round < 200; round++) {
      const n = 2 + rand(14);
      const picked = Array.from({ length: 1 + rand(n) }, () => rand(n));
      const plan = planBlockMove(n, picked, rand(n - new Set(picked).size + 1));
      if (plan) expectRoundTrip(ids(n), plan);
    }
  });

  it("plans 1,000 rows of 100,000 inside the budget", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i * 50);
    const start = performance.now();
    const plan = planBlockMove(100_000, rows, 40_000)!;
    const ms = performance.now() - start;
    expect(plan.sources).toHaveLength(1000);
    expect(ms).toBeLessThan(20 * CI_FACTOR);
  });
});

describe("planShiftMove", () => {
  it("shifts every row by delta and keeps the gaps", () => {
    const plan = planShiftMove(8, [1, 3, 5], 1)!;
    expect(plan.targets).toEqual([2, 4, 6]);
    expect(permute(ids(8), plan.newIndexOf)).toEqual(["r0", "r2", "r1", "r4", "r3", "r6", "r5", "r7"]);
  });

  it("no-ops for the whole batch at an edge", () => {
    expect(planShiftMove(5, [0, 3], -1)).toBeNull();
    expect(planShiftMove(5, [1, 4], 1)).toBeNull();
    expect(planShiftMove(5, [1], 0)).toBeNull();
    expect(planShiftMove(5, [], 1)).toBeNull();
    expect(planShiftMove(5, [1], 0.5)).toBeNull();
  });

  it("applies and inverts through applyChange for random batches", () => {
    const rand = lcg(11);
    for (let round = 0; round < 200; round++) {
      const n = 2 + rand(14);
      const picked = Array.from({ length: 1 + rand(n) }, () => rand(n));
      const plan = planShiftMove(n, picked, rand(2) === 0 ? -1 : 1);
      if (plan) expectRoundTrip(ids(n), plan);
    }
  });
});
