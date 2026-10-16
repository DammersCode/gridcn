import { describe, expect, it } from "vitest";
import { toSafeText } from "./safe-text";
import { textCellType } from "./text";
import { urlCellType } from "./url";

function deepArray(depth: number): unknown {
  let value: unknown = "x";
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

describe("toSafeText", () => {
  it("converts nullish to an empty string and everything else with String()", () => {
    expect(toSafeText(null)).toBe("");
    expect(toSafeText(undefined)).toBe("");
    expect(toSafeText(12)).toBe("12");
    expect(toSafeText("a")).toBe("a");
  });

  it("returns an empty string for a null-prototype object", () => {
    expect(toSafeText(Object.create(null))).toBe("");
  });

  it("returns an empty string for a 1e5-deep nested array", () => {
    expect(toSafeText(deepArray(1e5))).toBe("");
  });

  it("is used by the text and url cell types", () => {
    const hostile = Object.create(null);
    expect(textCellType.toText(hostile)).toBe("");
    expect(urlCellType.toText(hostile)).toBe("");
    expect(urlCellType.href?.(hostile)).toBeNull();
  });
});
