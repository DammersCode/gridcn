import { describe, expect, it } from "vitest";
import { operatorHasValue, operatorLabel, operatorsForColumnType } from "./operators-for-column-type";
import { DEFAULT_LABELS, type FilterOperator } from "@/registry/default/blocks/data-grid/data-grid";

describe("operatorsForColumnType", () => {
  it("offers only text operators for text-like columns", () => {
    expect(operatorsForColumnType("text")).toEqual([
      "contains",
      "notContains",
      "equals",
      "notEquals",
      "startsWith",
      "endsWith",
      "empty",
      "notEmpty",
    ]);
    expect(operatorsForColumnType(undefined)).not.toContain("gt");
    expect(operatorsForColumnType("select")).not.toContain("gt");
    expect(operatorsForColumnType("checkbox")).not.toContain("lte");
  });

  it("adds gt/gte/lt/lte only for number and date columns", () => {
    const numberOps = operatorsForColumnType("number");
    expect(numberOps).toEqual(expect.arrayContaining(["gt", "gte", "lt", "lte"]));
    const dateOps = operatorsForColumnType("date");
    expect(dateOps).toEqual(expect.arrayContaining(["gt", "gte", "lt", "lte"]));
  });
});

describe("operatorLabel", () => {
  it("returns a human-readable label for every FilterOperator", () => {
    const all: FilterOperator[] = [
      "contains",
      "notContains",
      "equals",
      "notEquals",
      "startsWith",
      "endsWith",
      "empty",
      "notEmpty",
      "gt",
      "gte",
      "lt",
      "lte",
    ];
    for (const op of all) {
      expect(typeof operatorLabel(op, DEFAULT_LABELS.filterOperators)).toBe("string");
      expect(operatorLabel(op, DEFAULT_LABELS.filterOperators).length).toBeGreaterThan(0);
    }
  });
});

describe("operatorHasValue", () => {
  it("is false only for empty/notEmpty", () => {
    expect(operatorHasValue("empty")).toBe(false);
    expect(operatorHasValue("notEmpty")).toBe(false);
    expect(operatorHasValue("contains")).toBe(true);
    expect(operatorHasValue("gt")).toBe(true);
  });
});
