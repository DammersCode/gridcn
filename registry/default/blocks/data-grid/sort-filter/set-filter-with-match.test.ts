import { describe, expect, it, vi } from "vitest";
import { cellTypes } from "../cell-types/cell-types";
import { computeViewIndex } from "../store/compute";
import type { AnyColumnDef } from "../store/types";
import type { CellType, FilterSpec } from "../types";

type Row = { city: unknown };
const data: Row[] = [{ city: "Bonn" }, { city: "Köln" }, { city: "Berlin" }];

function viewCities(column: AnyColumnDef, filter: FilterSpec, types: Record<string, CellType> = cellTypes as unknown as Record<string, CellType>): unknown[] {
  return computeViewIndex(data, [column], [], [filter], undefined, types).map((row) => data[row]!.city);
}

const anyOf: FilterSpec = { columnId: "city", operator: "isAnyOf", value: ["bonn", "Berlin"] };

describe("isAnyOf and isNoneOf on a column with filter.match", () => {
  it.each([undefined, "text", "select"])("evaluate with the built-in set match on a %s column", (type) => {
    const match = vi.fn(() => false);
    const column = { id: "city", header: "City", accessorKey: "city", type, filter: { match } } as AnyColumnDef;

    expect(viewCities(column, anyOf)).toEqual(["Bonn", "Berlin"]);
    expect(viewCities(column, { ...anyOf, operator: "isNoneOf" })).toEqual(["Köln"]);
    expect(match).not.toHaveBeenCalled();
  });

  it("still run filter.match for the other built-in operators", () => {
    const match = vi.fn((value: unknown) => value === "Köln");
    const column = { id: "city", header: "City", accessorKey: "city", filter: { match } } as AnyColumnDef;

    expect(viewCities(column, { columnId: "city", operator: "contains", value: "o" })).toEqual(["Köln"]);
  });

  it("reach filter.match when the same filter lists them in operators", () => {
    const match = vi.fn((value: unknown, filter: FilterSpec) => Array.isArray(filter.value) && value === "Köln");
    const column = { id: "city", header: "City", accessorKey: "city", filter: { match, operators: ["isAnyOf"] } } as AnyColumnDef;

    expect(viewCities(column, anyOf)).toEqual(["Köln"]);
  });

  it("reach a cell type's filter.match when that cell type lists them", () => {
    const match = vi.fn((value: unknown) => value === "Köln");
    const city: CellType = { ...(cellTypes.text as unknown as CellType), filter: { match, operators: ["isAnyOf", "isNoneOf"] } };
    const column = { id: "city", header: "City", accessorKey: "city", type: "city" } as AnyColumnDef;

    expect(viewCities(column, anyOf, { ...cellTypes, city } as Record<string, CellType>)).toEqual(["Köln"]);
  });
});
