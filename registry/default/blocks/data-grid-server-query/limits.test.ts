import { describe, expect, it } from "vitest";
import { MAX_HIDDEN_CHECKED_ROWS } from "@/registry/default/blocks/data-grid/store/hidden-checked-rows";
import { DEFAULT_MAX_LOADED_ROWS } from "@/registry/default/blocks/data-grid-server/fetch-hygiene";
import { DEFAULT_LIMITS, resolveLimits } from "./limits";

describe("limits", () => {
  it("bounds a selection's id lists above what a grid sends: the remembered rows plus the loaded ones", () => {
    expect(DEFAULT_LIMITS.maxSelectionIds).toBe(MAX_HIDDEN_CHECKED_ROWS + 100_000);
    expect(DEFAULT_LIMITS.maxSelectionIds).toBeGreaterThanOrEqual(MAX_HIDDEN_CHECKED_ROWS + DEFAULT_MAX_LOADED_ROWS);
    expect(resolveLimits({ maxSelectionIds: 5 }).maxSelectionIds).toBe(5);
  });
});
