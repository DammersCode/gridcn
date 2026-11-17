import { describe, expect, it } from "vitest";
import { sampledRowIdsDiffer } from "./sync-props";

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `r${i}` }));
const byId = (row: unknown) => (row as { id: string }).id;

describe("sampledRowIdsDiffer", () => {
  it("catches a getRowId that changes only a middle id", () => {
    const data = rows(1000);
    expect(sampledRowIdsDiffer(data, byId, (row, i) => (i === 500 ? "other" : byId(row)))).toBe(true);
  });

  it("catches a getRowId that changes the whole middle of a large data set", () => {
    const data = rows(100_000);
    expect(sampledRowIdsDiffer(data, byId, (row, i) => (i > 100 && i < 99_000 ? "other" : byId(row)))).toBe(true);
  });

  it("skips lazy holes and reports equal ids as equal", () => {
    const data: unknown[] = [undefined, ...rows(50), undefined];
    expect(sampledRowIdsDiffer(data, byId, byId)).toBe(false);
  });
});
