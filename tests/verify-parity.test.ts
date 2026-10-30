import { describe, expect, it } from "vitest";
import { checkParity, renderParityPage } from "../scripts/verify-parity.mjs";

const modes = [
  { id: "L", label: "Local array" },
  { id: "PS", label: "Server pagination" },
];

const supported = { status: "supported", evidence: ["package.json"] };

function matrix(overrides: Record<string, unknown> = {}) {
  return {
    modes,
    features: [
      {
        id: "sort",
        feature: "Sort",
        options: ["sortState"],
        cells: { L: supported, PS: { status: "gap", track: "A", note: "client sort only" } },
        ...overrides,
      },
    ],
  };
}

const check = (m: unknown, optionNames = ["sortState"]) => checkParity(m, { optionNames, root: "." });

describe("checkParity", () => {
  it("accepts a complete matrix", () => {
    expect(check(matrix())).toEqual([]);
  });

  it("fails on an empty cell", () => {
    const problems = check(matrix({ cells: { L: supported } }));
    expect(problems).toEqual(["sort: cell PS is empty"]);
  });

  it("fails on a cell for an unknown mode", () => {
    const problems = check(matrix({ cells: { L: supported, PS: supported, XX: supported } }));
    expect(problems).toEqual(["sort: cell XX names no mode"]);
  });

  it("fails on a gap without a tracking id", () => {
    const problems = check(matrix({ cells: { L: supported, PS: { status: "gap", note: "x" } } }));
    expect(problems).toEqual(["sort: gap cell PS has no tracking id"]);
  });

  it("fails on a gap without a note", () => {
    const problems = check(matrix({ cells: { L: supported, PS: { status: "gap", track: "A" } } }));
    expect(problems).toEqual(["sort: gap cell PS has no note"]);
  });

  it("fails on a supported cell without evidence", () => {
    const problems = check(matrix({ cells: { L: { status: "supported", evidence: [] }, PS: supported } }));
    expect(problems).toEqual(["sort: supported cell L has no evidence"]);
  });

  it("fails on a missing evidence path and ignores the anchor", () => {
    const anchored = { status: "supported", evidence: ["package.json#scripts", "nope/missing.ts"] };
    const problems = check(matrix({ cells: { L: anchored, PS: supported } }));
    expect(problems).toEqual(["sort: cell L evidence path does not exist: nope/missing.ts"]);
  });

  it("fails on an n/a cell without a reason", () => {
    const problems = check(matrix({ cells: { L: supported, PS: { status: "n/a" } } }));
    expect(problems).toEqual(["sort: n/a cell PS has no reason"]);
  });

  it("fails on an unverified cell without a note", () => {
    const problems = check(matrix({ cells: { L: supported, PS: { status: "unverified" } } }));
    expect(problems).toEqual(["sort: unverified cell PS has no note"]);
  });

  it("fails on an unknown status", () => {
    const problems = check(matrix({ cells: { L: supported, PS: { status: "maybe" } } }));
    expect(problems).toEqual(["sort: cell PS has unknown status maybe"]);
  });

  it("fails on a public option that appears in no row", () => {
    const problems = check(matrix(), ["sortState", "filterState"]);
    expect(problems).toEqual(["public option filterState appears in no matrix row"]);
  });

  it("fails on a row option that is not a public option", () => {
    const problems = check(matrix({ options: ["sortState", "ghost"] }));
    expect(problems).toEqual(["sort: option ghost is not a public option"]);
  });
});

describe("renderParityPage", () => {
  it("is deterministic and shows each status", () => {
    const page = renderParityPage(matrix());
    expect(page).toBe(renderParityPage(matrix()));
    expect(page).toContain("| Sort |");
    expect(page).toContain("Gap");
    expect(page).toContain("Supported");
  });
});
