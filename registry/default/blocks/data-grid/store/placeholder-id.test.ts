import { describe, expect, it } from "vitest";
import { holeRowId, isPlaceholderRowId } from "./compute";

describe("isPlaceholderRowId", () => {
  it("recognizes the placeholder of a hole and nothing else", () => {
    expect(isPlaceholderRowId(holeRowId(7))).toBe(true);
    expect(isPlaceholderRowId("__lazy-unloaded-x")).toBe(false);
    expect(isPlaceholderRowId("r7")).toBe(false);
    expect(isPlaceholderRowId("__other")).toBe(false);
  });
});
