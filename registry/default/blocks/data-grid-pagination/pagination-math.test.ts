import { describe, expect, it } from "vitest";
import { clampPage, pageCount, pageRange, pageWindow } from "./pagination-math";

describe("pageCount", () => {
  it("rounds up to cover a partial last page", () => {
    expect(pageCount(101, 25)).toBe(5);
    expect(pageCount(100, 25)).toBe(4);
  });

  it("is always at least 1, even for an empty dataset", () => {
    expect(pageCount(0, 25)).toBe(1);
  });

  it("treats a non-positive pageSize as a single page", () => {
    expect(pageCount(100, 0)).toBe(1);
    expect(pageCount(100, -5)).toBe(1);
  });
});

describe("clampPage", () => {
  it("clamps below 1 up to 1", () => {
    expect(clampPage(0, 100, 25)).toBe(1);
    expect(clampPage(-3, 100, 25)).toBe(1);
  });

  it("clamps above pageCount down to pageCount", () => {
    expect(clampPage(99, 100, 25)).toBe(4);
  });

  it("floors a fractional page", () => {
    expect(clampPage(2.9, 100, 25)).toBe(2);
  });

  it("passes through an in-range page unchanged", () => {
    expect(clampPage(3, 100, 25)).toBe(3);
  });

  it("clamps to the new, smaller pageCount when pageSize grows (the page-size-change scenario)", () => {
    // page 4 of 25-per-page (100 rows, 4 pages) -> switch to 50-per-page (2 pages) -> clamp to 2.
    expect(clampPage(4, 100, 50)).toBe(2);
  });
});

describe("pageRange", () => {
  it("computes the half-open row range for a middle page", () => {
    expect(pageRange(2, 25, 100)).toEqual({ start: 25, end: 50 });
  });

  it("clamps the end of a partial last page to total", () => {
    expect(pageRange(5, 25, 101)).toEqual({ start: 100, end: 101 });
  });

  it("returns an empty range past the end of the data", () => {
    expect(pageRange(10, 25, 101)).toEqual({ start: 101, end: 101 });
  });
});

describe("pageWindow", () => {
  it("centers the window on the current page in the middle of a long list", () => {
    expect(pageWindow(7, 20, 5)).toEqual([5, 6, 7, 8, 9]);
  });

  it("clamps the window to the start when the page is near page 1", () => {
    expect(pageWindow(1, 20, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(2, 20, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("clamps the window to the end when the page is near the last page", () => {
    expect(pageWindow(20, 20, 5)).toEqual([16, 17, 18, 19, 20]);
    expect(pageWindow(19, 20, 5)).toEqual([16, 17, 18, 19, 20]);
  });

  it("shows every page when the page count is smaller than the window size", () => {
    expect(pageWindow(1, 3, 5)).toEqual([1, 2, 3]);
  });

  it("returns an empty array for zero total pages", () => {
    expect(pageWindow(1, 0, 5)).toEqual([]);
  });
});
