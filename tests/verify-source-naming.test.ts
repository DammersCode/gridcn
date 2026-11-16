import { describe, expect, it } from "vitest";
import { namingProblems } from "../scripts/verify-source-naming.mjs";

const B = "registry/default/blocks/x";
const file = (path: string, text = "") => ({ path: `${B}/${path}`, text });
const pair = (dir: string, a: string, b = "other.ts") => [file(`${dir}/${a}`), file(`${dir}/${b}`)];

describe("namingProblems", () => {
  it("accepts kebab-case names, topic infixes, and the test suffixes", () => {
    const names = ["a-b.ts", "a.tsx", "a.test.ts", "a.browser.test.tsx", "a.type-test.ts", "a.test-helper.ts", "a.perf.test.ts", "a.property.test.tsx", "a.bench.ts", "a-b.cursor.test.tsx", "a.refresh.browser.test.tsx"];
    expect(namingProblems(names.map((n) => file(n)))).toEqual([]);
  });

  it("fails on camelCase, snake_case, and unknown suffixes", () => {
    for (const bad of ["aB.ts", "a_b.ts", "A.tsx", "a.spec.ts", "a.helper.ts", "a.b.ts"]) {
      expect(namingProblems([file(bad)]), bad).toHaveLength(1);
    }
  });

  it("fails when a use-* file exports no hook", () => {
    expect(namingProblems([file("use-a.ts", "export function a() {}")])).toHaveLength(1);
    expect(namingProblems([file("use-a.ts", "export function useA() {}")])).toEqual([]);
    expect(namingProblems([file("use-a.ts", "export const useA = () => 1;")])).toEqual([]);
    expect(namingProblems([file("use-a.ts", "export { useA } from './x';")])).toEqual([]);
  });

  it("fails on a single-file folder", () => {
    expect(namingProblems([file("sub/a.ts")])).toHaveLength(1);
    expect(namingProblems(pair("sub", "a.ts"))).toEqual([]);
  });

  it("allows two folder levels and fails on a third", () => {
    expect(namingProblems(pair("a/b", "a.ts"))).toEqual([]);
    expect(namingProblems(pair("a/b/c", "a.ts"))).toHaveLength(1);
  });
});
