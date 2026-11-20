import { describe, expect, it } from "vitest";
import type { ServerGroupLayout } from "./group-types";
import { buildPivotColumns, MAX_PIVOT_COLUMNS, pivotColumnId, pivotGroupId } from "./pivot-columns";
import type { ColumnDef } from "./types";

type Row = { region: string; year: number; amount: number; units: number };
type Pivot = NonNullable<ServerGroupLayout["pivot"]>;

const source: ColumnDef<Row>[] = [
  { id: "region", header: "Region" },
  { id: "year", header: "Year", type: "number" },
  { id: "amount", header: "Amount", type: "currency", options: { currency: "EUR" } },
  { id: "units", header: "Units", type: "number" },
];
const labels = { empty: "(empty)", value: (reducer: string, column: string) => `${reducer} of ${column}` };

const pivot = (values: Pivot["values"], keys: readonly (string | number | null)[]): Pivot => ({
  columnId: "year",
  values,
  columns: keys.flatMap((key) => values.map((_, valueIndex) => ({ path: [key], valueIndex }))),
  omitted: 0,
});

describe("pivotColumnId", () => {
  it("derives the id from the pivot column, the key text, and the value", () => {
    expect(pivotColumnId("year", 2025, { columnId: "amount", reducer: "sum" })).toBe("__pivot:year=2025|amount=sum");
  });

  it("gives 1 and \"1\" one id, and null and \"\" one id", () => {
    const value = { columnId: "amount", reducer: "sum" } as const;
    expect(pivotColumnId("year", 1, value)).toBe(pivotColumnId("year", "1", value));
    expect(pivotColumnId("year", null, value)).toBe(pivotColumnId("year", "", value));
  });

  it("percent-encodes every separator so no key forges another id", () => {
    const forged = pivotColumnId("year", "a|amount=sum", { columnId: "x", reducer: "count" });
    expect(forged).toBe("__pivot:year=a%7Camount%3Dsum|x=count");
    expect(forged).not.toBe(pivotColumnId("year", "a", { columnId: "amount", reducer: "sum" }));
    expect(pivotGroupId("y=r", "a/b")).toBe("__pivotgroup:y%3Dr=a%2Fb");
  });

  it("throws a TypeError for a lone surrogate", () => {
    expect(() => pivotColumnId("year", "\uD800", { columnId: "amount", reducer: "sum" })).toThrow(TypeError);
  });
});

describe("buildPivotColumns", () => {
  it("builds one read-only fixed column per held id, in held order", () => {
    const { columns, groups } = buildPivotColumns(pivot([{ columnId: "amount", reducer: "sum" }], [2024, 2025]), source, labels);
    expect(groups).toEqual([]);
    expect(columns.map((c) => [c.id, c.header, c.pivotIndex])).toEqual([
      ["__pivot:year=2024|amount=sum", "2024", 0],
      ["__pivot:year=2025|amount=sum", "2025", 1],
    ]);
    expect(columns[0]).toMatchObject({ readOnly: true, sortable: false, filterable: false, reorderable: false, pinnable: false, groupable: false, aggregate: "sum", type: "currency", options: { currency: "EUR" } });
  });

  it("uses the number cell type for a count and the empty label for the empty key", () => {
    const { columns } = buildPivotColumns(pivot([{ columnId: "region", reducer: "count" }], [null]), source, labels);
    expect(columns[0]).toMatchObject({ header: "(empty)", type: "number", aggregate: "count" });
    expect(columns[0]).not.toHaveProperty("options");
  });

  it("adds one header group per key over its value columns with 2 or more values", () => {
    const values = [{ columnId: "amount", reducer: "sum" }, { columnId: "units", reducer: "avg" }] as const;
    const { columns, groups } = buildPivotColumns(pivot(values, [2024, null]), source, labels);
    expect(columns.map((c) => c.header)).toEqual(["sum of Amount", "avg of Units", "sum of Amount", "avg of Units"]);
    expect(groups).toEqual([
      { id: "__pivotgroup:year=2024", header: "2024", headerText: "2024", children: [columns[0]!.id, columns[1]!.id] },
      { id: "__pivotgroup:year=", header: "(empty)", headerText: "(empty)", children: [columns[2]!.id, columns[3]!.id] },
    ]);
  });

  it("keeps at most 200 columns", () => {
    const keys = Array.from({ length: MAX_PIVOT_COLUMNS + 5 }, (_, i) => i);
    expect(buildPivotColumns(pivot([{ columnId: "amount", reducer: "sum" }], keys), source, labels).columns).toHaveLength(MAX_PIVOT_COLUMNS);
  });

  it("returns equal output for the same held set", () => {
    const held = pivot([{ columnId: "amount", reducer: "sum" }], [1, 2]);
    expect(buildPivotColumns(held, source, labels)).toEqual(buildPivotColumns(held, source, labels));
  });
});
