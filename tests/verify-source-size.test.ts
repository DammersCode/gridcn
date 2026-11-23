import { describe, expect, it } from "vitest";
import { CEILING_SLACK, lowerBaseline, sizeProblems } from "../scripts/verify-source-size.mjs";

const src = "registry/default/blocks/x/big.ts";
const test = "registry/default/blocks/x/big.test.ts";

describe("sizeProblems", () => {
  it("accepts files within budget and listed files at their ceiling", () => {
    expect(sizeProblems([{ path: src, lines: 800 }, { path: test, lines: 1500 }], {})).toEqual([]);
    expect(sizeProblems([{ path: src, lines: 900 }], { [src]: 900 })).toEqual([]);
  });

  it("fails on a new oversize source file and a new oversize test file", () => {
    expect(sizeProblems([{ path: src, lines: 801 }], {})).toHaveLength(1);
    expect(sizeProblems([{ path: test, lines: 1501 }], {})).toHaveLength(1);
  });

  it("holds files under test/ to the test budget", () => {
    expect(sizeProblems([{ path: "registry/default/blocks/x/test/a.tsx", lines: 1200 }], {})).toEqual([]);
  });

  it("fails when a listed file grows past its ceiling", () => {
    expect(sizeProblems([{ path: src, lines: 901 }], { [src]: 900 })).toHaveLength(1);
  });

  it("fails when a listed file sits more than CEILING_SLACK lines under its ceiling, so the ceiling follows a shrink", () => {
    expect(sizeProblems([{ path: src, lines: 1000 - CEILING_SLACK }], { [src]: 1000 })).toEqual([]);
    expect(sizeProblems([{ path: src, lines: 999 - CEILING_SLACK }], { [src]: 1000 })).toEqual([expect.stringContaining("run --write")]);
  });

  it("fails on stale entries: file under budget or missing", () => {
    expect(sizeProblems([{ path: src, lines: 700 }], { [src]: 900 })).toHaveLength(1);
    expect(sizeProblems([], { [src]: 900 })).toHaveLength(1);
  });
});

describe("lowerBaseline", () => {
  it("lowers ceilings, drops stale entries, and never raises or adds", () => {
    const files = [
      { path: src, lines: 850 },
      { path: test, lines: 1000 },
      { path: "registry/default/blocks/x/new.ts", lines: 2000 },
    ];
    expect(lowerBaseline(files, { [src]: 900, [test]: 1600 })).toEqual({ [src]: 850 });
    expect(lowerBaseline([{ path: src, lines: 950 }], { [src]: 900 })).toEqual({ [src]: 900 });
  });
});
