import { describe, expect, it } from "vitest";
import { MAX_HIDDEN_CHECKED_ROWS } from "@/registry/default/blocks/data-grid/store/hidden-checked-rows";
import { MAX_PIVOT_COLUMNS } from "@/registry/default/blocks/data-grid/pivot-columns";
import { MAX_GROUP_LEVELS } from "@/registry/default/blocks/data-grid/store/group-state";
import { DEFAULT_MAX_LOADED_ROWS } from "@/registry/default/blocks/data-grid-server/fetch-hygiene";
import { MAX_GROUP_TEXT_LENGTH } from "@/registry/default/blocks/data-grid-server/read-groups-answer";
import { DEFAULT_LIMITS, resolveLimits } from "./limits";

describe("limits", () => {
  it("bounds a selection's id lists above what a grid sends: the remembered rows plus the loaded ones", () => {
    expect(DEFAULT_LIMITS.maxSelectionIds).toBe(MAX_HIDDEN_CHECKED_ROWS + 100_000);
    expect(DEFAULT_LIMITS.maxSelectionIds).toBeGreaterThanOrEqual(MAX_HIDDEN_CHECKED_ROWS + DEFAULT_MAX_LOADED_ROWS);
    expect(resolveLimits({ maxSelectionIds: 5 }).maxSelectionIds).toBe(5);
  });

  it("mirrors the grid's group and pivot caps", () => {
    expect(DEFAULT_LIMITS.maxPivotColumns).toBe(MAX_PIVOT_COLUMNS);
    expect(DEFAULT_LIMITS.maxGroupLevels).toBe(MAX_GROUP_LEVELS);
    expect(DEFAULT_LIMITS.maxGroupKeyLength).toBe(MAX_GROUP_TEXT_LENGTH);
  });
});
