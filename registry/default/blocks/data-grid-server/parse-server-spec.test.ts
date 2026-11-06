import { describe, expect, it } from "vitest";
import { ServerSpecError, parseServerSpec } from "./parse-server-spec";

const columns = ["name", "age", "status"];
const parse = (input: unknown, extra = {}) => parseServerSpec(input, { columns, ...extra });

describe("parseServerSpec", () => {
  it("returns a clean spec and drops unknown keys and filterIds", () => {
    const spec = parse({
      sorts: [{ columnId: "age", direction: "desc", extra: 1 }],
      filters: [{ filterId: "x", columnId: "name", operator: "contains", value: "a", evil: true }],
      searchText: "q",
      other: 1,
    });
    expect(spec).toEqual({ sorts: [{ columnId: "age", direction: "desc" }], filters: [{ columnId: "name", operator: "contains", value: "a" }], searchText: "q" });
  });

  it("reads a missing part as empty", () => {
    expect(parse({})).toEqual({ sorts: [], filters: [], searchText: "" });
  });

  it.each([null, [], "x", 3])("rejects a non-object body %j", (body) => {
    expect(() => parse(body)).toThrow(ServerSpecError);
  });

  it("rejects an unknown column in a sort and a filter, with the path", () => {
    expect(() => parse({ sorts: [{ columnId: "nope", direction: "asc" }] })).toThrow(/sorts\[0\]\.columnId/);
    expect(() => parse({ filters: [{ columnId: "nope", operator: "equals", value: "1" }] })).toThrow(/filters\[0\]\.columnId/);
  });

  it("honors per-column rules", () => {
    const rules = { name: { sortable: false, operators: ["equals"] }, age: { filterable: false }, status: { customOperators: { inRegion: "single" as const } } };
    expect(() => parse({ sorts: [{ columnId: "name", direction: "asc" }] }, { columns: rules })).toThrow(/cannot be sorted/);
    expect(() => parse({ filters: [{ columnId: "name", operator: "contains", value: "a" }] }, { columns: rules })).toThrow(/not allowed/);
    expect(() => parse({ filters: [{ columnId: "age", operator: "gt", value: "1" }] }, { columns: rules })).toThrow(/cannot be filtered/);
    expect(parse({ filters: [{ columnId: "status", operator: "inRegion", value: "eu" }] }, { columns: rules }).filters).toHaveLength(1);
  });

  it("checks the value shape of each operator", () => {
    expect(parse({ filters: [{ columnId: "name", operator: "empty", value: "ignored" }] }).filters).toEqual([{ columnId: "name", operator: "empty" }]);
    expect(parse({ filters: [{ columnId: "age", operator: "isBetween", value: ["1", "2"] }] }).filters).toHaveLength(1);
    expect(() => parse({ filters: [{ columnId: "age", operator: "isBetween", value: ["1"] }] })).toThrow(/two bounds/);
    expect(() => parse({ filters: [{ columnId: "age", operator: "gt", value: 5 }] })).toThrow(/must be a string/);
    expect(() => parse({ filters: [{ columnId: "age", operator: "isAnyOf", value: "a" }] })).toThrow(/must be an array/);
  });

  it("bounds depth, groups, rows, sorts, text, and lists", () => {
    const row = { columnId: "name", operator: "equals", value: "a" };
    const deep = { join: "and", filters: [{ join: "or", filters: [{ join: "and", filters: [row] }] }] };
    expect(() => parse({ filters: [deep] })).toThrow(/deeper/);
    expect(() => parse({ filters: Array.from({ length: 65 }, () => row) })).toThrow(/more than 64 filters/);
    expect(() => parse({ filters: Array.from({ length: 17 }, () => ({ join: "and", filters: [] })) })).toThrow(/more than 16 groups/);
    expect(() => parse({ sorts: Array.from({ length: 9 }, () => ({ columnId: "age", direction: "asc" })) })).toThrow(/more than 8/);
    expect(() => parse({ searchText: "x".repeat(201) })).toThrow(/longer than 200/);
    expect(() => parse({ filters: [{ columnId: "name", operator: "equals", value: "x".repeat(1001) }] })).toThrow(/longer than 1000/);
    expect(() => parse({ filters: [{ columnId: "name", operator: "isAnyOf", value: Array.from({ length: 1001 }, () => "a") }] })).toThrow(/more than 1000/);
    expect(parse({ filters: Array.from({ length: 65 }, () => row) }, { limits: { maxFilters: 100 } }).filters).toHaveLength(65);
  });

  it("does not read operators from the prototype chain", () => {
    const rules = { name: { customOperators: { inRegion: "single" as const } } };
    for (const operator of ["constructor", "__proto__", "toString"]) {
      expect(() => parse({ filters: [{ columnId: "name", operator, value: "x" }] }, { columns: rules })).toThrow(/not allowed/);
    }
  });

  it("rejects a join other than and/or", () => {
    expect(() => parse({ filters: [{ join: "xor", filters: [] }] })).toThrow(/join/);
  });
});
