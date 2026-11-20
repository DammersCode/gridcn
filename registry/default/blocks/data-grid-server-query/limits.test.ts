import { describe, expect, it } from "vitest";
import { MAX_HIDDEN_CHECKED_ROWS } from "@/registry/default/blocks/data-grid/store/hidden-checked-rows";
import { DEFAULT_LIMITS, resolveLimits } from "./limits";

describe("limits", () => {
  it("bounds a selection's id lists at the grid's cap on remembered rows", () => {
    expect(DEFAULT_LIMITS.maxExcludedIds).toBe(MAX_HIDDEN_CHECKED_ROWS);
    expect(resolveLimits({ maxExcludedIds: 5 }).maxExcludedIds).toBe(5);
  });
});
