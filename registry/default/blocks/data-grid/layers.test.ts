import { describe, expect, it } from "vitest";
import { cellLayer, GRID_LAYER } from "./layers";

describe("cellLayer", () => {
  it("ranks pinned above active-unpinned and active-pinned above both", () => {
    expect(cellLayer(false, false)).toBe(GRID_LAYER.cell);
    expect(cellLayer(false, true)).toBe(GRID_LAYER.activeCell);
    expect(cellLayer(true, false)).toBe(GRID_LAYER.pinnedCell);
    expect(cellLayer(true, true)).toBe(GRID_LAYER.activePinnedCell);
  });

  it("never returns auto, so toggling active keeps the stacking mode of the cell", () => {
    for (const pinned of [false, true]) for (const active of [false, true]) expect(typeof cellLayer(pinned, active)).toBe("number");
  });
});
