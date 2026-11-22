import { describe, expect, it } from "vitest";
import { IS_CI, budget, ciFactor } from "./perf-budget.test-helper";

describe("perf budget", () => {
  it("detects CI only for the string true", () => {
    expect(IS_CI).toBe(process.env["CI"] === "true");
  });

  it("scales only on CI", () => {
    expect(ciFactor(3, true)).toBe(3);
    expect(ciFactor(3, false)).toBe(1);
  });

  it("holds the floor while the reference is fast", () => {
    expect(budget({ floor: 50, cap: 200, k: 3, reference: 5, ci: false })).toBe(50);
  });

  it("follows k times the reference between floor and cap", () => {
    expect(budget({ floor: 50, cap: 200, k: 3, reference: 40, ci: false })).toBe(120);
  });

  it("stops at the cap when the reference is slow", () => {
    expect(budget({ floor: 50, cap: 200, k: 3, reference: 1_000, ci: false })).toBe(200);
  });

  it("widens floor and cap on CI and leaves the reference term as measured", () => {
    expect(budget({ floor: 50, cap: 200, k: 3, reference: 5, ci: true })).toBe(100);
    expect(budget({ floor: 50, cap: 200, k: 3, reference: 120, ci: true })).toBe(360);
    expect(budget({ floor: 50, cap: 200, k: 3, reference: 1_000, ci: true })).toBe(400);
    expect(budget({ floor: 50, cap: 200, ci: true, ciFactor: 3 })).toBe(150);
  });
});
