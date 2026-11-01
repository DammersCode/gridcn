import { describe, expect, it } from "vitest";
import { checkParity, extractOptionNames, renderParityPage } from "../scripts/verify-parity.mjs";

const modes = [
  { id: "L", label: "Local array", description: "All rows in memory." },
  { id: "PS", label: "Server pagination", description: "One page per request.", evidencePattern: "version" },
];

const supported = { status: "supported", evidence: ["package.json"] };
const unrelated = { status: "supported", evidence: ["tsconfig.json"] };

function matrix(overrides: Record<string, unknown> = {}) {
  return {
    modes: structuredClone(modes),
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

  it("fails on evidence that does not mention the mode", () => {
    const problems = check(matrix({ cells: { L: supported, PS: unrelated } }));
    expect(problems).toEqual(["sort: cell PS evidence tsconfig.json does not mention the mode (version)"]);
  });

  it("skips the mode evidence check for a mode-neutral row", () => {
    expect(check(matrix({ modeNeutral: true, cells: { L: supported, PS: unrelated } }))).toEqual([]);
  });

  it("fails on a duplicate feature id", () => {
    const m = matrix();
    m.features.push(m.features[0]!);
    expect(check(m)).toEqual(["sort: duplicate feature id"]);
  });

  it("fails on a mode without a description", () => {
    const m = matrix();
    delete (m.modes[0] as { description?: string }).description;
    expect(check(m)).toEqual(["mode L has no description"]);
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
    expect(page).toContain('<th scope="row"');
    expect(page).toContain(">Sort</th>");
    expect(page).toContain('<ParityCell status="supported" />');
    expect(page).toContain('<ParityCell status="gap" note={"');
    expect(page).toContain('title={"Local array"}');
    expect(page).toContain('<ParityLegend statuses={["supported","gap"]} />');
  });

  it("escapes hostile names so the generated MDX stays valid", () => {
    const hostile = matrix({ feature: "Sort {x} <y>" });
    hostile.modes[0]!.label = String.raw`Local "array" \ path`;
    const page = renderParityPage(hostile);
    expect(page).toContain(`title={${JSON.stringify(hostile.modes[0]!.label)}}`);
    expect(page).toContain('{"{"}x{"}"}');
    expect(page).toContain("### Sort");
    expect(page).not.toContain("{x}");
    expect(page).not.toContain("Sort {x}");
  });

  it("escapes braces and angle brackets in notes but not inside code spans", () => {
    const page = renderParityPage(matrix({ note: "uses {a} and `{b}`", cells: { L: supported, PS: { status: "gap", track: "A", note: "rows < offset" } } }));
    expect(page).toContain('- uses {"{"}a{"}"} and `{b}`');
    expect(page).toContain('Gap: rows {"<"} offset');
  });

  it("leaves a code span in a feature name intact in the row header and heading", () => {
    const page = renderParityPage(matrix({ feature: "Pager `<DataGridPager>` {x}" }));
    expect(page).toContain("Pager `<DataGridPager>` {\"{\"}x{\"}\"}");
    expect(page).toContain("### Pager `<DataGridPager>`");
  });

  it("keeps backticks out of the tooltip note", () => {
    const page = renderParityPage(matrix({ cells: { L: supported, PS: { status: "gap", track: "A", note: "ignores `total`" } } }));
    expect(page).toContain('note={"ignores total"}');
  });
});

describe("extractOptionNames", () => {
  it("reads top-level fields and ignores braces inside comments", () => {
    const source = [
      "export type Opts<T = unknown> = {",
      "  /** closes with } and opens { */",
      "  a?: number;",
      "  b: (x: { y: 1 }) => void;",
      "  // c: skipped",
      "};",
    ].join(String.fromCharCode(10));
    expect(extractOptionNames(source, "Opts")).toEqual(["a", "b"]);
  });

  it("throws when the type is missing", () => {
    expect(() => extractOptionNames("export type X = {};", "Opts")).toThrow("Opts");
  });
});
