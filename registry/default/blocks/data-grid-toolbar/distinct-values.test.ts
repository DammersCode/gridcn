import { describe, expect, it } from "vitest";
import { cellTypes, type AnyColumnDef, type FilterNode, type FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { DISTINCT_VALUES_CAP, distinctColumnValues, type DistinctValuesInput } from "./distinct-values";

type Row = { city?: unknown; age?: unknown; status?: unknown; day?: unknown };

const columns: AnyColumnDef[] = [
  { id: "city", accessorKey: "city", header: "City" },
  { id: "age", accessorKey: "age", header: "Age", type: "number" },
  { id: "status", accessorKey: "status", header: "Status", type: "select", options: { choices: [{ value: "a", label: "Active" }, { value: "i", label: "Inactive" }] } },
  { id: "day", accessorKey: "day", header: "Day", type: "date", options: { displayFormat: { year: "numeric", month: "long", day: "numeric" }, locale: "en-US" } },
] as AnyColumnDef[];

function input(data: readonly unknown[], filterState: FilterNode[] = []): DistinctValuesInput {
  return { data, columns, cellTypes: cellTypes as DistinctValuesInput["cellTypes"], filterState };
}

const summary = (r: ReturnType<typeof distinctColumnValues>) => r.values.map((v) => [v.key, v.label, v.count]);

describe("distinctColumnValues", () => {
  it("merges values that differ only by case and sums the counts", () => {
    const data: Row[] = [{ city: "Berlin" }, { city: "berlin" }, { city: "Bonn" }, { city: "BERLIN" }];
    const result = distinctColumnValues(input(data), "city");
    expect(summary(result)).toEqual([["berlin", "Berlin", 3], ["bonn", "Bonn", 1]]);
    expect(result.capped).toBe(false);
  });

  it("keeps the first-seen original text of each key", () => {
    const data: Row[] = [{ city: "berlin" }, { city: "Berlin" }, { city: "BONN" }];
    expect(distinctColumnValues(input(data), "city").values.map((v) => [v.key, v.text])).toEqual([["berlin", "berlin"], ["bonn", "BONN"]]);
  });

  it("counts null, undefined and empty text as one blank entry with an empty key", () => {
    const data: Row[] = [{ city: null }, { city: undefined }, { city: "" }, {}, { city: "Bonn" }];
    const result = distinctColumnValues(input(data), "city");
    expect(summary(result)).toEqual([["", "", 4], ["bonn", "Bonn", 1]]);
  });

  it("applies the other filters and ignores the column's own set filter", () => {
    const data: Row[] = [
      { city: "Berlin", age: 10 },
      { city: "Bonn", age: 20 },
      { city: "Koeln", age: 30 },
    ];
    const filters: FilterSpec[] = [
      { columnId: "age", operator: "gte", value: "20" },
      { columnId: "city", operator: "isAnyOf", value: ["berlin"] },
    ];
    expect(summary(distinctColumnValues(input(data, filters), "city")).map((r) => r[0])).toEqual(["bonn", "koeln"]);
    const none: FilterSpec[] = [{ columnId: "city", operator: "isNoneOf", value: ["bonn"] }];
    expect(distinctColumnValues(input(data, none), "city").values).toHaveLength(3);
  });

  it("keeps a condition filter on the same column active", () => {
    const data: Row[] = [{ city: "Berlin" }, { city: "Bonn" }, { city: "Koeln" }];
    const filters: FilterSpec[] = [
      { columnId: "city", operator: "startsWith", value: "b" },
      { columnId: "city", operator: "isAnyOf", value: ["koeln"] },
    ];
    expect(distinctColumnValues(input(data, filters), "city").values.map((v) => v.key)).toEqual(["berlin", "bonn"]);
  });

  it("counts only rows that pass an or group, with no or-bypass", () => {
    const data: Row[] = [{ city: "Berlin", age: 10 }, { city: "Bonn", age: 99 }, { city: "Koeln", age: 5 }];
    const group: FilterNode = { join: "or", filters: [{ columnId: "age", operator: "gt", value: "50" }, { columnId: "city", operator: "equals", value: "Koeln" }] };
    expect(distinctColumnValues(input(data, [group]), "city").values.map((v) => v.key)).toEqual(["bonn", "koeln"]);
  });

  it("counts a set row of the column inside a group as an other filter", () => {
    const data: Row[] = [{ city: "Berlin" }, { city: "Bonn" }, { city: "Koeln" }];
    const group: FilterNode = { join: "or", filters: [{ columnId: "city", operator: "isAnyOf", value: ["koeln"] }, { columnId: "city", operator: "isAnyOf", value: ["bonn"] }] };
    expect(distinctColumnValues(input(data, [group]), "city").values.map((v) => v.key)).toEqual(["bonn", "koeln"]);
  });

  it("stops adding keys at the cap and reports it", () => {
    const data: Row[] = Array.from({ length: DISTINCT_VALUES_CAP + 5 }, (_, i) => ({ city: `c${i}` }));
    data.push({ city: "c0" });
    const result = distinctColumnValues(input(data), "city");
    expect(result.capped).toBe(true);
    expect(result.values).toHaveLength(DISTINCT_VALUES_CAP);
    expect(result.values.find((v) => v.key === "c0")?.count).toBe(2);
  });

  it("reports holes only when the data has unloaded rows", () => {
    expect(distinctColumnValues(input([{ city: "Bonn" }, undefined]), "city").hasHoles).toBe(true);
    expect(distinctColumnValues(input([{ city: "Bonn" }]), "city").hasHoles).toBe(false);
  });

  it("skips lazy holes instead of counting them as blanks", () => {
    const data: unknown[] = [{ city: "Bonn" }, undefined, { city: "" }];
    expect(summary(distinctColumnValues(input(data), "city"))).toEqual([["", "", 1], ["bonn", "Bonn", 1]]);
  });

  it("labels select values with the choice label and keeps the stored value as key", () => {
    const data: Row[] = [{ status: "i" }, { status: "a" }, { status: "a" }];
    expect(summary(distinctColumnValues(input(data), "status"))).toEqual([["a", "Active", 2], ["i", "Inactive", 1]]);
  });

  it("labels date values with the display format", () => {
    const data: Row[] = [{ day: "2026-03-02" }, { day: "2026-01-15" }];
    expect(summary(distinctColumnValues(input(data), "day"))).toEqual([
      ["2026-01-15", "January 15, 2026", 1],
      ["2026-03-02", "March 2, 2026", 1],
    ]);
  });

  it("sorts numbers numerically through the cell type", () => {
    const data: Row[] = [{ age: 10 }, { age: 9 }, { age: 100 }];
    expect(distinctColumnValues(input(data), "age").values.map((v) => v.key)).toEqual(["9", "10", "100"]);
  });

  it("survives null-prototype and throwing values", () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    const throwing = { toString() { throw new Error("boom"); } };
    const data: Row[] = [{ city: hostile }, { city: throwing }, { city: "Bonn" }];
    const result = distinctColumnValues(input(data), "city");
    expect(summary(result)).toEqual([["", "", 2], ["bonn", "Bonn", 1]]);
  });
});
