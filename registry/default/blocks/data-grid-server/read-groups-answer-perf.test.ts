import { describe, expect, it } from "vitest";
import { readGroupsAnswer } from "./read-groups-answer";

const GROUPS = 100_000;
const range = { start: 0, end: GROUPS };
const options = { topLevel: true, aggregates: [{ columnId: "qty", reducer: "sum" as const }, { columnId: "name", reducer: "min" as const }, { columnId: "at", reducer: "max" as const }] };
const answerOf = (aggregates: (i: number) => Record<string, unknown>) => ({
  groups: Array.from({ length: GROUPS }, (_, i) => ({ key: `g${i}`, childCount: 1, totalRowCount: 1, aggregates: aggregates(i) })),
  groupCount: GROUPS,
  totalRowCount: GROUPS,
});

function bestOf(answer: unknown): number {
  let best = Infinity;
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    readGroupsAnswer(answer, range, options, () => {});
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

describe("readGroupsAnswer perf", () => {
  it("reads 100,000 groups of string aggregates within twice the time of number aggregates", () => {
    const numbers = answerOf((i) => ({ qty: i, name: i, at: i }));
    const strings = answerOf((i) => ({ qty: `1234567890123456${i}.89`, name: `name ${i}`, at: "2024-03-10T07:00:00.000Z" }));
    const numberTime = bestOf(numbers);
    expect(bestOf(strings)).toBeLessThan(numberTime * 2 + 5);
  });
});
