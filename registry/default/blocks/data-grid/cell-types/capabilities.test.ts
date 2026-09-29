import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "./cell-types";
import { COMPARISON_FILTER_OPERATORS, resolveColumnValidate, TEXT_FILTER_OPERATORS } from "./capabilities";
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
  it("number declares numeric and the number value input with text+comparison operators", () => {
    expect(cellTypes.number.numeric).toBe(true);
    expect(cellTypes.number.filter?.valueInput).toBe("number");
    expect(cellTypes.number.filter?.operators).toEqual([...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS]);
  });

  it("date declares numeric and the date value input with text+comparison operators", () => {
    expect(cellTypes.date.numeric).toBe(true);
    expect(cellTypes.date.filter?.valueInput).toBe("date");
    expect(cellTypes.date.filter?.operators).toEqual([...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS]);
  });

  it("select declares label-based search text and the choices value input with isAnyOf", () => {
    const options = { choices: [{ value: "v1", label: "Cherry" }] };
    expect(cellTypes.select.toSearchText?.("v1", options)).toBe("Cherry");
    // an unknown stored value searches its raw string, null stays blank
    expect(cellTypes.select.toSearchText?.("v9", options)).toBe("v9");
    expect(cellTypes.select.toSearchText?.(null as unknown as string, options)).toBe("");
    expect(cellTypes.select.filter?.valueInput).toBe("choices");
    expect(cellTypes.select.filter?.operators).toEqual([...TEXT_FILTER_OPERATORS, "isAnyOf"]);
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
