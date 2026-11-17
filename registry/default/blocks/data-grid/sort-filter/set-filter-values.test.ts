import { describe, expect, it } from "vitest";
import { setFilterListBound, setFilterValuesOf } from "./set-filter-values";

const choiceColumn = { id: "c", options: { choices: ["a", "b", "c"] } };
const state = (extra: { filterMode?: "client" | "server"; fetchFilterValues?: unknown }) => ({ columns: [choiceColumn] as never, data: [{ c: "z" }], cellTypes: {}, filterMode: "client" as const, ...extra });

describe("setFilterListBound", () => {
  it("bounds a choices column at 64 on a client filter without fetchFilterValues", () => {
    expect(setFilterListBound({ filterMode: "client" }, choiceColumn)).toBe(64);
  });
  it("leaves the default bound when the server lists the values", () => {
    expect(setFilterListBound({ filterMode: "server" }, choiceColumn)).toBeUndefined();
    expect(setFilterListBound({ filterMode: "client", fetchFilterValues: () => ({ values: [] }) }, choiceColumn)).toBeUndefined();
  });
  it("leaves the default bound for a column without choices", () => {
    expect(setFilterListBound({ filterMode: "client" }, { id: "x" })).toBeUndefined();
  });
});

describe("setFilterValuesOf", () => {
  it("checks membership on a plain client filter", () => {
    expect(setFilterValuesOf(state({}))("c")?.has("a")).toBe(true);
  });
  it("checks nothing when fetchFilterValues lists the values", () => {
    expect(setFilterValuesOf(state({ fetchFilterValues: () => ({ values: [] }) }))("c")).toBeUndefined();
  });
});
