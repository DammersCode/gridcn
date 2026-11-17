import { describe, expect, it } from "vitest";
import { parseGroupBy, serializeGroupBy } from "./group-param";

describe("group param", () => {
  it("round trips ids with reserved characters", () => {
    const ids = ["region", "a,b", "c:d", "é"];
    expect(parseGroupBy(serializeGroupBy(ids))).toEqual(ids);
  });

  it("writes nothing for no group", () => {
    expect(serializeGroupBy([])).toBe("");
    expect(parseGroupBy("")).toEqual([]);
  });

  it("drops empty, undecodable, and repeated segments", () => {
    expect(parseGroupBy("a,,%E0%A4%A,a")).toEqual(["a"]);
  });

  it("reads at most four raw segments", () => {
    expect(parseGroupBy("a,b,c,d,e,f")).toEqual(["a", "b", "c", "d"]);
    expect(parseGroupBy(",".repeat(5_000_000))).toEqual([]);
  });

  it("keeps prototype-like ids as plain strings", () => {
    expect(parseGroupBy("__proto__,constructor")).toEqual(["__proto__", "constructor"]);
  });
});
