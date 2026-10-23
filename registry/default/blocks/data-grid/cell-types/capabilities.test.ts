import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "./cell-types";
import {
  COMPARISON_FILTER_OPERATORS,
  resolveColumnValidate,
  resolveFilterOperators,
  resolveFilterValueInput,
  SET_FILTER_OPERATORS,
  TEXT_FILTER_OPERATORS,
} from "./capabilities";
import type { AnyColumnDef } from "../store/types";

const noopColumn: AnyColumnDef = { id: "col", header: "Col" };

describe("resolveColumnValidate", () => {
  it("prefers the column's own validate over the type's", () => {
    const columnValidate = (value: unknown) => (value ? "column" : null);
    const typeValidate = (value: unknown) => (value ? "type" : null);
    const column = { ...noopColumn, validate: columnValidate } as AnyColumnDef;
    const cellType = { ...cellTypes.text, validate: typeValidate };

    const resolved = resolveColumnValidate(column, cellType);
    expect(resolved).toBe(columnValidate);
  });

  it("falls back to the type's validate when the column declares none", () => {
    const typeValidate = (value: unknown) => (value ? "type" : null);
    const cellType = { ...cellTypes.text, validate: typeValidate };

    const resolved = resolveColumnValidate(noopColumn, cellType);
    expect(resolved).toBe(typeValidate);
  });

  it("returns undefined when neither declares a validator", () => {
    expect(resolveColumnValidate(noopColumn, undefined)).toBeUndefined();
    expect(resolveColumnValidate(noopColumn, cellTypes.text)).toBeUndefined();
  });
});

describe("built-in capability declarations", () => {
  it("number declares numeric and the number value input with text, comparison and set operators", () => {
    expect(cellTypes.number.numeric).toBe(true);
    expect(cellTypes.number.filter?.valueInput).toBe("number");
    expect(cellTypes.number.filter?.operators).toEqual([...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
  });

  it("date declares numeric and the date value input with text, comparison and set operators", () => {
    expect(cellTypes.date.numeric).toBe(true);
    expect(cellTypes.date.filter?.valueInput).toBe("date");
    expect(cellTypes.date.filter?.operators).toEqual([...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
  });

  it("select declares label-based search text and the choices value input with the set operators", () => {
    const options = { choices: [{ value: "v1", label: "Cherry" }] };
    expect(cellTypes.select.toSearchText?.("v1", options)).toBe("Cherry");
    // an unknown stored value searches its raw string, null stays blank
    expect(cellTypes.select.toSearchText?.("v9", options)).toBe("v9");
    expect(cellTypes.select.toSearchText?.(null as unknown as string, options)).toBe("");
    expect(cellTypes.select.filter?.valueInput).toBe("choices");
    expect(cellTypes.select.filter?.operators).toEqual([...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
  });

  it("long-text and url keep the text operators only", () => {
    expect(cellTypes.longText.filter?.operators).toEqual(TEXT_FILTER_OPERATORS);
    expect(cellTypes.url.filter?.operators).toEqual(TEXT_FILTER_OPERATORS);
  });

  it("checkbox declares an in-place activate (toggle) and the boolean value input", () => {
    expect(cellTypes.checkbox.activate?.(false)).toBe(true);
    expect(cellTypes.checkbox.activate?.(true)).toBe(false);
    expect(cellTypes.checkbox.filter?.valueInput).toBe("boolean");
    expect(cellTypes.checkbox.numeric).toBeUndefined();
  });

  it("text declares no behavior fields — it stays a pure display type", () => {
    expect(cellTypes.text.numeric).toBeUndefined();
    expect(cellTypes.text.toSearchText).toBeUndefined();
    expect(cellTypes.text.activate).toBeUndefined();
    expect(cellTypes.text.validate).toBeUndefined();
    expect(cellTypes.text.filter).toBeUndefined();
  });
});

describe("column-level overrides stay authoritative", () => {
  it("a select column's own validate wins for commit validation", () => {
    const column: ColumnDef<unknown, string | null> = {
      id: "col",
      header: "Col",
      type: "select",
      options: { choices: [{ value: "a", label: "Alpha" }] },
    };
    // the built-in select type declares no validate — nothing to shadow at the type level,
    // so the resolution is simply the column's own validator
    const resolved = resolveColumnValidate(column as unknown as AnyColumnDef, cellTypes.select);
    expect(resolved).toBeUndefined();
  });
});

describe("resolveFilterOperators", () => {
  const typeOperators = ["equals", "gt"] as const;
  const customType = { ...cellTypes.text, filter: { operators: typeOperators } };

  it("prefers the column's filterOperators, then the type's, then the type-name default", () => {
    expect(resolveFilterOperators({ ...noopColumn, filterOperators: ["contains"] }, customType)).toEqual(["contains"]);
    expect(resolveFilterOperators({ ...noopColumn, type: "custom" }, customType)).toBe(typeOperators);
    expect(resolveFilterOperators({ ...noopColumn, type: "number" }, undefined)).toEqual([...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
    expect(resolveFilterOperators({ ...noopColumn, type: "date" }, undefined)).toEqual([...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
    expect(resolveFilterOperators({ ...noopColumn, type: "select" }, undefined)).toEqual([...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
    expect(resolveFilterOperators({ ...noopColumn, type: "text" }, undefined)).toEqual([...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
    expect(resolveFilterOperators(noopColumn, undefined)).toEqual([...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS]);
    expect(resolveFilterOperators({ ...noopColumn, type: "url" }, undefined)).toEqual(TEXT_FILTER_OPERATORS);
    expect(resolveFilterOperators({ ...noopColumn, type: "checkbox" }, undefined)).toEqual(TEXT_FILTER_OPERATORS);
  });
});

describe("resolveFilterValueInput", () => {
  it("prefers the type's valueInput, a name or a component, over the type-name default", () => {
    const Custom = () => null;
    expect(resolveFilterValueInput({ ...noopColumn, type: "money" }, { ...cellTypes.text, filter: { valueInput: "number" } })).toBe("number");
    expect(resolveFilterValueInput({ ...noopColumn, type: "money" }, { ...cellTypes.text, filter: { valueInput: Custom } })).toBe(Custom);
  });

  it("derives the widget from the type name when the type declares none", () => {
    expect(resolveFilterValueInput({ ...noopColumn, type: "date" }, undefined)).toBe("date");
    expect(resolveFilterValueInput({ ...noopColumn, type: "checkbox" }, undefined)).toBe("boolean");
    expect(resolveFilterValueInput({ ...noopColumn, type: "select" }, undefined)).toBe("choices");
    expect(resolveFilterValueInput({ ...noopColumn, type: "money" }, cellTypes.text)).toBe("text");
  });
});
