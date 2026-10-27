import { describe, expect, it } from "vitest";
import { parseLegacyJoin } from "./join-param";

describe("parseLegacyJoin", () => {
  it("reads 'or'", () => {
    expect(parseLegacyJoin("or")).toBe("or");
  });

  it("reads an empty, absent, or malformed param as 'and'", () => {
    expect(parseLegacyJoin("")).toBe("and");
    expect(parseLegacyJoin("banana")).toBe("and");
  });
});
