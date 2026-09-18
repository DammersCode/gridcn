import { describe, expect, it } from "vitest";
import { serializeJoinOperator, parseJoinOperator } from "./join-param";

describe("serializeJoinOperator / parseJoinOperator", () => {
  it("round-trips 'or'", () => {
    expect(serializeJoinOperator("or")).toBe("or");
    expect(parseJoinOperator(serializeJoinOperator("or"))).toBe("or");
  });

  it("serializes the default 'and' to an empty string (omitted from the URL)", () => {
    expect(serializeJoinOperator("and")).toBe("");
  });

  it("parses an empty/absent param as 'and'", () => {
    expect(parseJoinOperator("")).toBe("and");
  });

  it("parses garbage as 'and' rather than throwing", () => {
    expect(parseJoinOperator("banana")).toBe("and");
    expect(() => parseJoinOperator("!!!")).not.toThrow();
  });
});
