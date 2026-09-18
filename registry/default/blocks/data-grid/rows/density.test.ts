import { describe, expect, it } from "vitest";
import { resolveRowHeight } from "./density";

describe("resolveRowHeight", () => {
  it("returns the density preset height when no explicit rowHeight is given", () => {
    expect(resolveRowHeight("compact", undefined)).toBe(28);
    expect(resolveRowHeight("default", undefined)).toBe(36);
    expect(resolveRowHeight("comfortable", undefined)).toBe(44);
  });

  it("defaults to 'default' density when density is undefined", () => {
    expect(resolveRowHeight(undefined, undefined)).toBe(36);
  });

  it("an explicit rowHeight always wins over density", () => {
    expect(resolveRowHeight("compact", 100)).toBe(100);
    expect(resolveRowHeight(undefined, 0)).toBe(0);
  });
});
