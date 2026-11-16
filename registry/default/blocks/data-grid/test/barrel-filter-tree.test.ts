import { describe, expect, it } from "vitest";
import { isFilterGroup, type FilterNode } from "../data-grid";

describe("barrel isFilterGroup", () => {
  it("isFilterGroup narrows a group and rejects a filter row", () => {
    const group: FilterNode = { join: "and", filters: [] } as unknown as FilterNode;
    const row: FilterNode = { columnId: "name", operator: "contains", value: "a" } as unknown as FilterNode;
    expect(isFilterGroup(group)).toBe(true);
    expect(isFilterGroup(row)).toBe(false);
  });
});
