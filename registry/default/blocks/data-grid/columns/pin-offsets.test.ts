import { describe, expect, it } from "vitest";
import { pinRightOffsets } from "./pin-offsets";

describe("pinRightOffsets", () => {
  it("is all zeros when no column is pinned right", () => {
    expect(pinRightOffsets([100, 100, 100], [undefined, "left", undefined])).toEqual([0, 0, 0]);
  });

  it("accumulates inset-inline-end offsets right-to-left for pinned-right columns", () => {
    // columns 1 and 2 (from the right) are pinned right; column 0 sits before both
    expect(pinRightOffsets([100, 80, 60], [undefined, "right", "right"])).toEqual([140, 60, 0]);
  });
});
