import { describe, expect, it } from "vitest";
import { predictReorderTarget } from "../rows/use-row-reorder";

describe("predictReorderTarget", () => {
  it("dragging down onto the bottom half lands at the hovered row's slot", () => {
    expect(predictReorderTarget(0, 3, "after")).toBe(3);
    expect(predictReorderTarget(5, 9, "after")).toBe(9);
  });

  it("dragging down onto the top half lands one slot earlier", () => {
    expect(predictReorderTarget(0, 3, "before")).toBe(2);
    expect(predictReorderTarget(5, 9, "before")).toBe(8);
  });

  it("dragging up onto the top half lands at the hovered row's slot", () => {
    expect(predictReorderTarget(5, 1, "before")).toBe(1);
    expect(predictReorderTarget(9, 0, "before")).toBe(0);
  });

  it("dragging up onto the bottom half lands one slot later", () => {
    expect(predictReorderTarget(5, 1, "after")).toBe(2);
    expect(predictReorderTarget(9, 0, "after")).toBe(1);
  });

  it("is a no-op over its own row or the adjacent slot", () => {
    expect(predictReorderTarget(3, 3, "before")).toBe(3);
    expect(predictReorderTarget(3, 3, "after")).toBe(3);
    // hovering the row just below while dragging down (top half) or just above while dragging up
    // both predict the origin slot - nothing has crossed a boundary yet
    expect(predictReorderTarget(3, 4, "before")).toBe(3);
    expect(predictReorderTarget(3, 2, "after")).toBe(3);
  });
});
