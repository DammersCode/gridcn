import { describe, expect, it } from "vitest";
import { barrelProblems } from "../scripts/verify-barrel-exports.mjs";

describe("barrelProblems", () => {
  it("accepts an undocumented export that the baseline lists", () => {
    expect(barrelProblems({ "data-grid": ["oldName"] }, { "data-grid": ["oldName"] })).toEqual([]);
  });

  it("fails an undocumented export that the baseline does not list", () => {
    expect(barrelProblems({ "data-grid": ["newName"] }, {})).toEqual([expect.stringMatching(/data-grid exports newName/)]);
  });

  it("fails a baseline name that the docs mention or the barrel no longer exports", () => {
    expect(barrelProblems({}, { "data-grid": ["documented"] })).toEqual([expect.stringMatching(/baseline lists data-grid documented/)]);
  });
});
