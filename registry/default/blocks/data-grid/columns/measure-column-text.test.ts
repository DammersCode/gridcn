import { beforeAll, describe, expect, it } from "vitest";
import { measureColumnAutosizeWidth, measureTextWidths } from "./measure-column-text";

// jsdom has no real canvas 2d context (would need the native `canvas` package); stub `measureText`
// with a simple char-count-based width so the width comparisons below still exercise real logic.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = ((contextId: string) => {
    if (contextId !== "2d") return null;
    return {
      set font(_value: string) {},
      measureText: (text: string) => ({ width: text.length * 7 }),
    };
  }) as typeof HTMLCanvasElement.prototype.getContext;
});

describe("measureTextWidths", () => {
  it("returns the widest of several strings", () => {
    const short = measureTextWidths(["a"], "14px Arial");
    const long = measureTextWidths(["a much much longer string of text"], "14px Arial");
    const widest = measureTextWidths(["a", "a much much longer string of text", "mid"], "14px Arial");
    expect(widest).toBeCloseTo(long, 5);
    expect(widest).toBeGreaterThan(short);
  });

  it("returns 0 for an empty list", () => {
    expect(measureTextWidths([], "14px Arial")).toBe(0);
  });
});

describe("measureColumnAutosizeWidth", () => {
  it("grows with longer content and includes header text in the measurement", () => {
    const narrow = measureColumnAutosizeWidth({ headerText: "ID", cellTexts: ["1", "2"], font: "14px Arial" });
    const wide = measureColumnAutosizeWidth({
      headerText: "ID",
      cellTexts: ["a very long cell value indeed", "2"],
      font: "14px Arial",
    });
    expect(wide).toBeGreaterThan(narrow);
  });

  it("uses the header text width when it's the widest content", () => {
    const withLongHeader = measureColumnAutosizeWidth({
      headerText: "A Very Long Header Label",
      cellTexts: ["1", "2"],
      font: "14px Arial",
    });
    const withShortHeader = measureColumnAutosizeWidth({ headerText: "ID", cellTexts: ["1", "2"], font: "14px Arial" });
    expect(withLongHeader).toBeGreaterThan(withShortHeader);
  });

  it("clamps to minWidth and maxWidth", () => {
    const clampedMin = measureColumnAutosizeWidth({ headerText: "x", cellTexts: [], font: "14px Arial", minWidth: 200 });
    expect(clampedMin).toBe(200);
    const clampedMax = measureColumnAutosizeWidth({
      headerText: "a very long header indeed to overflow",
      cellTexts: [],
      font: "14px Arial",
      maxWidth: 50,
    });
    expect(clampedMax).toBe(50);
  });
});
