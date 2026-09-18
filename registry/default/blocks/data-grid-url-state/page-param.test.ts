import { describe, expect, it } from "vitest";
import { serializePage, parsePage, serializePageSize, parsePageSize, DEFAULT_URL_PAGE_SIZE } from "./page-param";

describe("serializePage / parsePage", () => {
  it("round-trips a page beyond the default", () => {
    expect(serializePage(3)).toBe("3");
    expect(parsePage(serializePage(3))).toBe(3);
  });

  it("serializes page 1 (the default) to an empty string, omitted from the URL", () => {
    expect(serializePage(1)).toBe("");
  });

  it("parses an empty/absent param as page 1", () => {
    expect(parsePage("")).toBe(1);
  });

  it("parses garbage as page 1 rather than throwing", () => {
    expect(parsePage("garbage")).toBe(1);
    expect(() => parsePage("!!!")).not.toThrow();
  });

  it("clamps a negative page to 1", () => {
    expect(parsePage("-5")).toBe(1);
  });

  it("clamps a fractional page to 1", () => {
    expect(parsePage("2.5")).toBe(1);
  });

  it("clamps page 0 to 1", () => {
    expect(parsePage("0")).toBe(1);
  });
});

describe("serializePageSize / parsePageSize", () => {
  it("round-trips a pageSize different from the default", () => {
    expect(serializePageSize(50, 25)).toBe("50");
    expect(parsePageSize(serializePageSize(50, 25), 25)).toBe(50);
  });

  it("serializes a pageSize matching the default to an empty string, omitted from the URL", () => {
    expect(serializePageSize(25, 25)).toBe("");
  });

  it("parses an empty/absent param as the default pageSize", () => {
    expect(parsePageSize("", 25)).toBe(25);
  });

  it("parses garbage as the default pageSize rather than throwing", () => {
    expect(parsePageSize("garbage", 25)).toBe(25);
    expect(() => parsePageSize("!!!", 25)).not.toThrow();
  });

  it("falls back to the default for a negative or fractional pageSize", () => {
    expect(parsePageSize("-10", 25)).toBe(25);
    expect(parsePageSize("10.5", 25)).toBe(25);
  });

  it("falls back to the default when the parsed value is outside allowedSizes", () => {
    expect(parsePageSize("999", 25, [10, 25, 50])).toBe(25);
  });

  it("accepts a parsed value that is inside allowedSizes", () => {
    expect(parsePageSize("50", 25, [10, 25, 50])).toBe(50);
  });

  it("exposes the module default as 25", () => {
    expect(DEFAULT_URL_PAGE_SIZE).toBe(25);
  });
});
