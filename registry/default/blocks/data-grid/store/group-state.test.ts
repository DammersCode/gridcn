import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { aggregateValues } from "../aggregate";
import {
  COLLAPSED,
  EXPANDED,
  MAX_EXPANDED_IDS,
  expandedTest,
  groupIdOf,
  groupKeyOf,
  isGroupRowId,
  normalizeExpanded,
  normalizeGroupBy,
  sameExpanded,
  toggleExpanded,
} from "./group-state";

const columns = [
  { id: "a", header: "A", accessorKey: "a" },
  { id: "b", header: "B", accessorKey: "b", groupable: false },
  { id: "c", header: "C", accessorKey: "c" },
] as unknown as ColumnDef<unknown, unknown>[];

describe("group ids and keys", () => {
  it("builds one percent-encoded column=key segment per level", () => {
    expect(groupIdOf([{ columnId: "a b", key: "x/y" }, { columnId: "c", key: 3 }])).toBe("__group:a%20b=x%2Fy/c=3");
    expect(groupIdOf([{ columnId: "a", key: null }])).toBe("__group:a=");
    expect(isGroupRowId("__group:a=1")).toBe(true);
    expect(isGroupRowId("row-1")).toBe(false);
  });

  it("keeps primitives, merges the empty values, and keys anything else by its text", () => {
    expect([groupKeyOf(null), groupKeyOf(undefined), groupKeyOf("")]).toEqual([null, null, null]);
    expect([groupKeyOf("x"), groupKeyOf(2), groupKeyOf(false), groupKeyOf(0)]).toEqual(["x", 2, false, 0]);
    expect(groupKeyOf(Number.NaN)).toBe("NaN");
    expect(groupKeyOf(Object.create(null))).toBe("");
    expect(groupKeyOf({ toString: () => "obj" })).toBe("obj");
  });
});

describe("normalizeGroupBy", () => {
  it("drops unknown, ungroupable, and repeated columns and keeps the first four", () => {
    expect(normalizeGroupBy(["a", "x", "b", "a", "c"], columns)).toEqual(["a", "c"]);
    expect(normalizeGroupBy(undefined, columns)).toEqual([]);
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, header: id, accessorKey: id })) as never;
    expect(normalizeGroupBy(["a", "b", "c", "d", "e", "f"], many)).toEqual(["a", "b", "c", "d"]);
  });

  it("returns the request itself when nothing drops, and survives a hostile list", () => {
    const requested = ["a", "c"];
    expect(normalizeGroupBy(requested, columns)).toBe(requested);
    expect(normalizeGroupBy([1, null, "__proto__", "a"] as never, columns)).toEqual(["a"]);
  });
});

describe("expanded state", () => {
  it("reads a bad shape as collapsed and keeps unique string ids", () => {
    expect(normalizeExpanded(null)).toBe(COLLAPSED);
    expect(normalizeExpanded({ mode: "other", ids: "x" })).toBe(COLLAPSED);
    expect(normalizeExpanded({ mode: "expanded" })).toBe(EXPANDED);
    expect(normalizeExpanded({ mode: "collapsed", ids: ["a", 1, "a", "b"] })).toEqual({ mode: "collapsed", ids: ["a", "b"] });
  });

  it("cuts a list past 10,000 ids and reports it once", () => {
    const onCut = vi.fn();
    const ids = Array.from({ length: MAX_EXPANDED_IDS + 5 }, (_, i) => `g${i}`);
    expect(normalizeExpanded({ mode: "collapsed", ids }, onCut).ids).toHaveLength(MAX_EXPANDED_IDS);
    expect(onCut).toHaveBeenCalledTimes(1);
  });

  it("compares by content and toggles membership by mode", () => {
    expect(sameExpanded({ mode: "collapsed", ids: ["a", "b"] }, { mode: "collapsed", ids: ["b", "a"] })).toBe(true);
    expect(sameExpanded(COLLAPSED, EXPANDED)).toBe(false);
    const open = expandedTest({ mode: "collapsed", ids: ["a"] });
    expect([open("a"), open("b")]).toEqual([true, false]);
    const closed = expandedTest({ mode: "expanded", ids: ["a"] });
    expect([closed("a"), closed("b")]).toEqual([false, true]);
    expect(toggleExpanded(COLLAPSED, "a")).toEqual({ mode: "collapsed", ids: ["a"] });
    expect(toggleExpanded({ mode: "collapsed", ids: ["a"] }, "a")).toEqual(COLLAPSED);
    const full = { mode: "collapsed" as const, ids: Array.from({ length: MAX_EXPANDED_IDS }, (_, i) => `g${i}`) };
    expect(toggleExpanded(full, "new")).toBe(full);
  });
});

describe("aggregateValues", () => {
  it("counts values other than null, undefined, and the empty string", () => {
    expect(aggregateValues("count", [1, "", null, undefined, 0, "x"])).toBe(3);
    expect(aggregateValues("count", [])).toBe(0);
  });

  it("reduces finite numbers, skips numeric strings, and gives null when none is left", () => {
    expect(aggregateValues("sum", [1, "5", Number.NaN, 2])).toBe(3);
    expect(aggregateValues("avg", [2, 4])).toBe(3);
    expect(aggregateValues("min", [3, 1, 2])).toBe(1);
    expect(aggregateValues("max", [3, 1, 2])).toBe(3);
    expect(aggregateValues("sum", [])).toBeNull();
    expect(aggregateValues("avg", ["a"])).toBeNull();
  });

  it("passes every value and row to a function", () => {
    expect(aggregateValues((values, rows) => [values.length, rows.length], [1, null], [{}, {}])).toEqual([2, 2]);
  });
});
