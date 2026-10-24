import { describe, expect, it } from "vitest";
import { createTextMatcher, findSearchMatches, type CellAccessor } from ".";

const rows = [{ a: "Foo" }, { a: "foo" }, { a: "foobar" }, { a: "a foo" }];
const accessor: CellAccessor = { getText: (row, columnId) => (rows[row] as Record<string, string>)[columnId] ?? "" };

function matchedRows(search: string, options?: { matchCase?: boolean; wholeCell?: boolean }): number[] {
  return findSearchMatches(rows.length, accessor, search, ["a"], undefined, options).map((m) => m.row);
}

describe("findSearchMatches search options", () => {
  it("matchCase keeps only cells with the same casing", () => {
    expect(matchedRows("foo", { matchCase: true })).toEqual([1, 2, 3]);
    expect(matchedRows("Foo", { matchCase: true })).toEqual([0]);
  });

  it("wholeCell keeps only cells equal to the needle", () => {
    expect(matchedRows("foo", { wholeCell: true })).toEqual([0, 1]);
  });

  it("matchCase and wholeCell combine", () => {
    expect(matchedRows("foo", { matchCase: true, wholeCell: true })).toEqual([1]);
  });

  it("defaults stay a case-insensitive substring match", () => {
    expect(matchedRows("FOO")).toEqual([0, 1, 2, 3]);
  });
});

describe("createTextMatcher", () => {
  it("returns null for a blank search", () => {
    expect(createTextMatcher("   ")).toBeNull();
  });

  it("trims the search text like the quick search does", () => {
    expect(createTextMatcher("  foo ")!("a foo")).toBe(true);
  });
});
