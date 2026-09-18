import { describe, expect, it } from "vitest";
import { distributeFlexWidths, resolveColumnWidth } from "./resolve-column-width";

describe("resolveColumnWidth", () => {
  it("uses the live override when present", () => {
    expect(resolveColumnWidth({ id: "a", header: "A", width: 100 }, 150)).toBe(150);
  });

  it("falls back to the def width, then 150", () => {
    expect(resolveColumnWidth({ id: "a", header: "A", width: 100 }, undefined)).toBe(100);
    expect(resolveColumnWidth({ id: "a", header: "A" }, undefined)).toBe(150);
  });

  it("clamps to min/max", () => {
    expect(resolveColumnWidth({ id: "a", header: "A", width: 10, minWidth: 50 }, undefined)).toBe(50);
    expect(resolveColumnWidth({ id: "a", header: "A", width: 500, maxWidth: 200 }, undefined)).toBe(200);
  });
});

describe("distributeFlexWidths", () => {
  it("passes through unchanged (same reference) when no column has flex", () => {
    const base = [100, 100];
    const result = distributeFlexWidths(base, [undefined, undefined], [Infinity, Infinity], 400);
    expect(result).toBe(base);
  });

  it("passes through unchanged when leftover is negative or zero", () => {
    const base = [100, 100];
    expect(distributeFlexWidths(base, [1, undefined], [Infinity, Infinity], 200)).toBe(base);
    expect(distributeFlexWidths(base, [1, undefined], [Infinity, Infinity], 150)).toBe(base);
  });

  it("splits leftover proportionally to flex", () => {
    // base 100+100=200, available 400 -> 200 leftover, flex 1:2 -> +66/+134 (largest-remainder rounded)
    const result = distributeFlexWidths([100, 100], [1, 2], [Infinity, Infinity], 400);
    expect(result[0]! + result[1]!).toBe(400);
    expect(result[1]).toBeGreaterThan(result[0]!);
    expect(result[0]).toBeCloseTo(167, 0);
    expect(result[1]).toBeCloseTo(233, 0);
  });

  it("clamps at maxWidth and redistributes the clipped excess to remaining flex columns", () => {
    // base 100+100+100=300, available 600 -> 300 leftover, equal flex 1:1:1 -> naive +100 each,
    // but column 0 caps at 120 (+20), so its unused +80 redistributes evenly to columns 1 and 2.
    const result = distributeFlexWidths([100, 100, 100], [1, 1, 1], [120, Infinity, Infinity], 600);
    expect(result[0]).toBe(120);
    expect(result[0]! + result[1]! + result[2]!).toBe(600);
    expect(result[1]).toBe(result[2]);
  });

  it("never shrinks a column below its base width", () => {
    const result = distributeFlexWidths([100, 100], [1, undefined], [Infinity, Infinity], 350);
    expect(result[1]).toBe(100);
    expect(result[0]).toBeGreaterThanOrEqual(100);
  });

  it("rounds so the sum matches available exactly", () => {
    // 100+100+100=300 base, 301 available -> 1px leftover split three ways, largest-remainder must land exactly.
    const result = distributeFlexWidths([100, 100, 100], [1, 1, 1], [Infinity, Infinity, Infinity], 301);
    expect(result.reduce((a, b) => a + b, 0)).toBe(301);
  });

  it("a single flex column takes all the leftover", () => {
    const result = distributeFlexWidths([100, 100], [undefined, 1], [Infinity, Infinity], 500);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(400);
  });

  it("ignores zero/undefined flex columns during distribution", () => {
    const result = distributeFlexWidths([100, 100, 100], [0, undefined, 1], [Infinity, Infinity, Infinity], 500);
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(100);
    expect(result[2]).toBe(300);
  });
});
