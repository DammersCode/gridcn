import { describe, expect, it } from "vitest";
import { sameLabels } from "./provider";

describe("sameLabels", () => {
  it("treats a re-created literal as unchanged", () => {
    expect(sameLabels({ grid: { a: "x", b: { c: "y" } } }, { grid: { a: "x", b: { c: "y" } } })).toBe(true);
  });

  it("sees a changed string, a missing key, and a different function", () => {
    expect(sameLabels({ a: "x" }, { a: "z" })).toBe(false);
    expect(sameLabels({ a: "x" }, { a: "x", b: "y" })).toBe(false);
    expect(sameLabels({ a: () => "x" }, { a: () => "x" })).toBe(false);
    const fn = () => "x";
    expect(sameLabels({ a: fn }, { a: fn })).toBe(true);
  });

  it("handles undefined", () => {
    expect(sameLabels(undefined, undefined)).toBe(true);
    expect(sameLabels(undefined, {})).toBe(false);
  });
});
