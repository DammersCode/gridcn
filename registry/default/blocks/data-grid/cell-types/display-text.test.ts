import { describe, expect, it } from "vitest";
import { displayText, exportText } from "./display-text";

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

describe("exportText", () => {
  it("returns the cell type's toText", () => {
    expect(exportText({ toText: (v: string) => `t:${v}` }, "x")).toBe("t:x");
  });

  it("falls back to the safe text of the value when toText throws", () => {
    const cellType = { toText: () => { throw new Error("hostile"); } };
    expect(exportText(cellType, 5)).toBe("5");
    expect(exportText(cellType, Object.create(null))).toBe("");
  });

  it("coerces a non-string toText result safely", () => {
    expect(exportText({ toText: () => Object.create(null) as string }, "x")).toBe("");
  });
});
