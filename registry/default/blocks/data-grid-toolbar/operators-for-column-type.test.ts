import { describe, expect, it } from "vitest";
import { emptyValueFor, operatorHasValue, operatorLabel, operatorsForColumnType } from "./operators-for-column-type";
import { DEFAULT_LABELS, type FilterOperator } from "@/registry/default/blocks/data-grid/data-grid";

describe("operatorsForColumnType", () => {
  it("offers text and set operators for text columns, and text operators only for checkbox and url", () => {
    expect(operatorsForColumnType("text")).toEqual([
      "contains",
      "notContains",
      "equals",
      "notEquals",
      "startsWith",
      "endsWith",
      "empty",
      "notEmpty",
      "isAnyOf",
      "isNoneOf",
    ]);
    expect(operatorsForColumnType(undefined)).not.toContain("gt");
    expect(operatorsForColumnType("select")).not.toContain("gt");
    expect(operatorsForColumnType("select")).toEqual(expect.arrayContaining(["isAnyOf", "isNoneOf"]));
    expect(operatorsForColumnType("checkbox")).not.toContain("lte");
    expect(operatorsForColumnType("checkbox")).not.toContain("isAnyOf");
    expect(operatorsForColumnType("url")).not.toContain("isNoneOf");
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
      "isAnyOf",
      "isNoneOf",
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

describe("emptyValueFor", () => {
  it("gives each operator family its empty value shape", () => {
    expect(emptyValueFor("isAnyOf")).toEqual([]);
    expect(emptyValueFor("isNoneOf")).toEqual([]);
    expect(emptyValueFor("isBetween")).toEqual(["", ""]);
    expect(emptyValueFor("contains")).toBe("");
    expect(emptyValueFor(undefined)).toBe("");
  });
});
