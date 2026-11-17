import { describe, expect, it } from "vitest";
import { matchPast, nextHoleRow } from "./result-walk";

const view = { viewIndex: [0, 1, 2, 3, 4], data: ["a", "b", undefined, undefined, "e"] };

describe("nextHoleRow", () => {
  it("finds the next unloaded row forward and backward", () => {
    expect(nextHoleRow(view, 0, 1)).toBe(2);
    expect(nextHoleRow(view, 4, -1)).toBe(3);
  });
  it("returns -1 when no unloaded row lies in that direction", () => {
    expect(nextHoleRow(view, 3, 1)).toBe(-1);
    expect(nextHoleRow(view, 1, -1)).toBe(-1);
  });
});

describe("matchPast", () => {
  const matches = [{ row: 1 }, { row: 4 }, { row: 4 }, { row: 7 }];
  it("picks the first match after the origin going forward", () => {
    expect(matchPast(matches, 4, 1)).toBe(3);
    expect(matchPast(matches, -1, 1)).toBe(0);
  });
  it("picks the last match before the origin going backward", () => {
    expect(matchPast(matches, 4, -1)).toBe(0);
    expect(matchPast(matches, 1, -1)).toBe(-1);
  });
  it("skips rows without a visible match by moving past them", () => {
    expect(matchPast(matches, 7, 1)).toBe(-1);
  });
});
