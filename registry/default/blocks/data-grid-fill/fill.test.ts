import { describe, expect, it } from "vitest";
import { computeFillTarget, detectSeries, fillDirection, generateFill, rectRelativeTo } from "./fill";
import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";

const bounds = { rowCount: 100, colCount: 100 };

describe("computeFillTarget", () => {
  const source: GridRect = { x: 10, y: 10, width: 5, height: 5 };

  it("returns null for a cursor inside the source", () => {
    expect(
      computeFillTarget(source, { col: 12, row: 12 }, { allowedDirections: "orthogonal", ...bounds })
    ).toBeNull();
  });

  it("snaps down when the cursor is below", () => {
    expect(
      computeFillTarget(source, { col: 12, row: 20 }, { allowedDirections: "orthogonal", ...bounds })
    ).toEqual({ x: 10, y: 15, width: 5, height: 6 });
  });

  it("snaps up when the cursor is above", () => {
    expect(
      computeFillTarget(source, { col: 12, row: 5 }, { allowedDirections: "orthogonal", ...bounds })
    ).toEqual({ x: 10, y: 5, width: 5, height: 5 });
  });

  it("snaps right when the cursor is to the right", () => {
    expect(
      computeFillTarget(source, { col: 20, row: 12 }, { allowedDirections: "orthogonal", ...bounds })
    ).toEqual({ x: 15, y: 10, width: 6, height: 5 });
  });

  it("snaps left when the cursor is to the left", () => {
    expect(
      computeFillTarget(source, { col: 5, row: 12 }, { allowedDirections: "orthogonal", ...bounds })
    ).toEqual({ x: 5, y: 10, width: 5, height: 5 });
  });

  it("picks the closest axis on a diagonal cursor", () => {
    expect(
      computeFillTarget(source, { col: 5, row: 5 }, { allowedDirections: "orthogonal", ...bounds })
    ).toEqual({ x: 5, y: 10, width: 5, height: 5 });
  });

  it("clamps the strip to grid bounds, returning null when it clamps to nothing", () => {
    expect(
      computeFillTarget(source, { col: 12, row: 200 }, { allowedDirections: "orthogonal", rowCount: 12, colCount: 100 })
    ).toBeNull();
  });

  it("clamps the strip's far edge to grid bounds without discarding it", () => {
    expect(
      computeFillTarget(source, { col: 12, row: 200 }, { allowedDirections: "orthogonal", rowCount: 30, colCount: 100 })
    ).toEqual({ x: 10, y: 15, width: 5, height: 15 });
  });

  it("restricts to the vertical axis regardless of horizontal cursor position", () => {
    expect(
      computeFillTarget(source, { col: 50, row: 20 }, { allowedDirections: "vertical", ...bounds })
    ).toEqual({ x: 10, y: 15, width: 5, height: 6 });
  });

  it("restricts to the horizontal axis regardless of vertical cursor position", () => {
    expect(
      computeFillTarget(source, { col: 20, row: 50 }, { allowedDirections: "horizontal", ...bounds })
    ).toEqual({ x: 15, y: 10, width: 6, height: 5 });
  });

  it("returns null for 'vertical' when horizontally inside after forcing the axis", () => {
    expect(
      computeFillTarget(source, { col: 12, row: 12 }, { allowedDirections: "vertical", ...bounds })
    ).toBeNull();
  });

  it("combines source and cursor freely for 'any'", () => {
    expect(
      computeFillTarget(source, { col: 20, row: 20 }, { allowedDirections: "any", ...bounds })
    ).toEqual({ x: 10, y: 10, width: 11, height: 11 });
  });

  it("returns null for 'any' when the cursor is inside the source", () => {
    expect(
      computeFillTarget(source, { col: 12, row: 12 }, { allowedDirections: "any", ...bounds })
    ).toBeNull();
  });
});

describe("detectSeries", () => {
  it("detects an arithmetic progression and extrapolates forward", () => {
    const series = detectSeries(["2", "4", "6"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(3)).toBe("8");
    expect(series!.extrapolate(4)).toBe("10");
  });

  it("extrapolates backwards for negative indices (upward/leftward fill)", () => {
    const series = detectSeries(["4", "6"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(-1)).toBe("2");
    expect(series!.extrapolate(-2)).toBe("0");
  });

  it("preserves zero-padding width", () => {
    const series = detectSeries(["001", "002"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(2)).toBe("003");
  });

  it("detects prefix+number sequences", () => {
    const series = detectSeries(["Item 9", "Item 10"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(2)).toBe("Item 11");
  });

  it("returns null for a single value (copy, not a series)", () => {
    expect(detectSeries(["5"])).toBeNull();
  });

  it("returns null for a non-arithmetic mixed column", () => {
    expect(detectSeries(["a", "3", "banana"])).toBeNull();
  });

  it("returns null when the delta is inconsistent", () => {
    expect(detectSeries(["1", "2", "4"])).toBeNull();
  });

  it("detects a descending arithmetic progression", () => {
    const series = detectSeries(["12", "10"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(2)).toBe("8");
    expect(series!.extrapolate(3)).toBe("6");
  });

  it("detects a decimal arithmetic progression without floating-point noise", () => {
    const series = detectSeries(["0.1", "0.2"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(2)).toBe("0.3");
  });

  it("detects a negative-number arithmetic progression", () => {
    const series = detectSeries(["-5", "-3"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(2)).toBe("-1");
    expect(series!.extrapolate(-1)).toBe("-7");
  });

  it("does not invent zero-padding for plain unpadded integers of equal width", () => {
    const series = detectSeries(["10", "12"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(-1)).toBe("8");
    expect(series!.extrapolate(2)).toBe("14");
  });

  it("does not invent zero-padding for mixed-width plain integers", () => {
    const series = detectSeries(["9", "10"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(2)).toBe("11");
  });

  it("rejects padded numerics of inconsistent width (falls through to prefix/suffix, which also fails on the delta)", () => {
    expect(detectSeries(["01", "5", "003"])).toBeNull();
  });

  it("rejects a padded-numeric series with an inconsistent delta", () => {
    expect(detectSeries(["01", "02", "04"])).toBeNull();
  });

  it("extrapolates a padded-numeric series past zero, prefixing the sign before the padded digits", () => {
    const series = detectSeries(["03", "02"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(4)).toBe("-01");
  });

  it("returns null when a prefix/suffix number series has an inconsistent prefix", () => {
    expect(detectSeries(["Item 1", "Row 2"])).toBeNull();
  });

  it("returns null when a prefix/suffix number series has an inconsistent delta", () => {
    expect(detectSeries(["Item 1", "Item 2", "Item 4"])).toBeNull();
  });

  it("extrapolates a prefix/suffix series to a negative number without padding", () => {
    const series = detectSeries(["Item 1", "Item 2"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(-3)).toBe("Item -2");
  });

  it("extrapolates a zero-padded prefix/suffix series preserving width", () => {
    const series = detectSeries(["Item 08", "Item 09"]);
    expect(series).not.toBeNull();
    expect(series!.extrapolate(2)).toBe("Item 10");
  });
});

describe("generateFill", () => {
  it("extends an arithmetic series downward", () => {
    const source = [["2"], ["4"], ["6"]];
    const target: GridRect = { x: 0, y: 3, width: 1, height: 2 };
    expect(generateFill(source, target, "down")).toEqual([["8"], ["10"]]);
  });

  it("extrapolates backwards for an upward fill", () => {
    const source = [["4"], ["6"]];
    const target: GridRect = { x: 0, y: -2, width: 1, height: 2 };
    expect(generateFill(source, target, "up")).toEqual([["0"], ["2"]]);
  });

  it("preserves zero-padding when filling down", () => {
    const source = [["001"], ["002"]];
    const target: GridRect = { x: 0, y: 2, width: 1, height: 1 };
    expect(generateFill(source, target, "down")).toEqual([["003"]]);
  });

  it("extends prefix+number series rightward", () => {
    const source = [["Item 9", "Item 10"]];
    const target: GridRect = { x: 2, y: 0, width: 1, height: 1 };
    expect(generateFill(source, target, "right")).toEqual([["Item 11"]]);
  });

  it("falls back to tiling for a mixed (non-series) column", () => {
    const source = [["a"], ["3"], ["banana"]];
    const target: GridRect = { x: 0, y: 3, width: 1, height: 3 };
    expect(generateFill(source, target, "down")).toEqual([["a"], ["3"], ["banana"]]);
  });

  it("tiles downward with wraparound beyond one full source height", () => {
    const source = [["x"], ["y"]];
    const target: GridRect = { x: 0, y: 2, width: 1, height: 3 };
    expect(generateFill(source, target, "down")).toEqual([["x"], ["y"], ["x"]]);
  });

  it("tiles upward from the bottom of the source", () => {
    const source = [["a"], ["b"]];
    const target: GridRect = { x: 0, y: -1, width: 1, height: 1 };
    // one row above a 2-row source wraps to the bottom row ("b")
    expect(generateFill(source, target, "up")).toEqual([["b"]]);
  });

  it("forceCopy tiles even when a series is detectable", () => {
    const source = [["2"], ["4"], ["6"]];
    const target: GridRect = { x: 0, y: 3, width: 1, height: 3 };
    expect(generateFill(source, target, "down", { forceCopy: true })).toEqual([["2"], ["4"], ["6"]]);
  });

  it("detects a series per column independently for vertical fills", () => {
    const source = [
      ["2", "a"],
      ["4", "3"],
    ];
    const target: GridRect = { x: 0, y: 2, width: 2, height: 1 };
    // column 0 is a series (2,4 -> 6); column 1 has no series so it tiles (wraps to row 0: "a")
    expect(generateFill(source, target, "down")).toEqual([["6", "a"]]);
  });

  it("extends a descending series downward without inventing zero-padding", () => {
    const source = [["12"], ["10"]];
    const target: GridRect = { x: 0, y: 2, width: 1, height: 2 };
    expect(generateFill(source, target, "down")).toEqual([["8"], ["6"]]);
  });

  it("extends a decimal series downward without floating-point noise", () => {
    const source = [["0.1"], ["0.2"]];
    const target: GridRect = { x: 0, y: 2, width: 1, height: 1 };
    expect(generateFill(source, target, "down")).toEqual([["0.3"]]);
  });

  it("extends a negative-number series downward", () => {
    const source = [["-5"], ["-3"]];
    const target: GridRect = { x: 0, y: 2, width: 1, height: 1 };
    expect(generateFill(source, target, "down")).toEqual([["-1"]]);
  });

  it("detects a series per row independently for horizontal fills", () => {
    const source = [
      ["2", "4"],
      ["x", "y"],
    ];
    const target: GridRect = { x: 2, y: 0, width: 1, height: 2 };
    expect(generateFill(source, target, "right")).toEqual([["6"], ["x"]]);
  });

  it("forceCopy tiles a horizontal fill even when a series is detectable", () => {
    const source = [["2", "4"]];
    const target: GridRect = { x: 2, y: 0, width: 2, height: 1 };
    expect(generateFill(source, target, "right", { forceCopy: true })).toEqual([["2", "4"]]);
  });

  it("returns an empty grid for an empty source (no rows)", () => {
    const target: GridRect = { x: 0, y: 0, width: 0, height: 0 };
    expect(generateFill([], target, "down")).toEqual([]);
  });

  it("uses a custom detect over the built-in one", () => {
    // the built-in detectSeries does not detect dates; a custom detector (e.g. ISO dates) can.
    // the year rollover keeps the built-in prefix+number detector honest (prefixes differ, day
    // delta is not arithmetic), so the no-detect assertion below really is a tiling fallback.
    const detect = (values: readonly string[]) => {
      if (values.length < 2) return null;
      const d0 = Date.parse(values[0]!);
      const d1 = Date.parse(values[1]!);
      if (Number.isNaN(d0) || Number.isNaN(d1)) return null;
      const step = d1 - d0;
      if (values.some((v) => Number.isNaN(Date.parse(v)))) return null;
      for (let i = 2; i < values.length; i++) {
        if (Date.parse(values[i]!) - Date.parse(values[i - 1]!) !== step) return null;
      }
      return {
        extrapolate: (index: number) =>
          new Date(d0 + step * index).toISOString().slice(0, 10),
      };
    };
    const source = [["2026-12-31"], ["2027-01-01"]];
    const target: GridRect = { x: 0, y: 2, width: 1, height: 2 };
    expect(generateFill(source, target, "down", { detect })).toEqual([["2027-01-02"], ["2027-01-03"]]);
    // without the custom detector the same input tiles (built-in finds no series)
    expect(generateFill(source, target, "down")).toEqual([["2026-12-31"], ["2027-01-01"]]);
  });

  it("forceCopy tiles even when a custom detect would extrapolate", () => {
    const detect = () => ({ extrapolate: (i: number) => `x${i}` });
    const source = [["a"], ["b"]];
    const target: GridRect = { x: 0, y: 2, width: 1, height: 2 };
    expect(generateFill(source, target, "down", { detect, forceCopy: true })).toEqual([["a"], ["b"]]);
  });
});

describe("fillDirection", () => {
  const source: GridRect = { x: 1, y: 0, width: 1, height: 2 };

  it("resolves down when the strip sits below the source", () => {
    expect(fillDirection(source, { x: 1, y: 2, width: 1, height: 3 })).toBe("down");
  });

  it("resolves up when the strip sits above the source", () => {
    expect(fillDirection(source, { x: 1, y: -1, width: 1, height: 1 })).toBe("up");
  });

  it("resolves right when the strip sits to the right", () => {
    expect(fillDirection({ x: 0, y: 0, width: 1, height: 1 }, { x: 1, y: 0, width: 2, height: 1 })).toBe("right");
  });

  it("resolves left when the strip sits to the left", () => {
    expect(fillDirection({ x: 3, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 3, height: 1 })).toBe("left");
  });
});

describe("rectRelativeTo", () => {
  it("re-expresses a rect relative to an origin's top-left", () => {
    expect(rectRelativeTo({ x: 5, y: 5, width: 2, height: 3 }, { x: 2, y: 2, width: 1, height: 1 })).toEqual({
      x: 3,
      y: 3,
      width: 2,
      height: 3,
    });
  });

  it("produces negative offsets for a strip above/left of the origin", () => {
    expect(rectRelativeTo({ x: 0, y: -2, width: 1, height: 2 }, { x: 0, y: 0, width: 1, height: 2 })).toEqual({
      x: 0,
      y: -2,
      width: 1,
      height: 2,
    });
  });
});
