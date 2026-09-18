import { describe, expect, it } from "vitest";
import { displayText } from "./display-text";

describe("displayText", () => {
  it("uses toDisplayText when the cell type defines one", () => {
    const cellType = { toText: (v: string) => v, toDisplayText: (v: string) => `[${v}]` };
    expect(displayText(cellType, "x")).toBe("[x]");
  });

  it("falls back to toText when toDisplayText is absent", () => {
    const cellType = { toText: (v: string) => `plain:${v}` };
    expect(displayText(cellType, "x")).toBe("plain:x");
  });
});
