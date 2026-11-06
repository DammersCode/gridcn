import { describe, expect, it } from "vitest";
import { resolveFilterMode, resolveSortMode } from "./compute";

describe("sort and filter mode defaults", () => {
  it("default to client without totalRowCount", () => {
    expect(resolveSortMode({})).toBe("client");
    expect(resolveFilterMode({})).toBe("client");
  });

  it("default to server while totalRowCount is set, a number or null", () => {
    for (const totalRowCount of [0, 100, null]) {
      expect(resolveSortMode({ totalRowCount })).toBe("server");
      expect(resolveFilterMode({ totalRowCount })).toBe("server");
    }
  });

  it("let an explicit mode win in both directions", () => {
    expect(resolveSortMode({ totalRowCount: 5, sortMode: "client" })).toBe("client");
    expect(resolveFilterMode({ totalRowCount: 5, filterMode: "client" })).toBe("client");
    expect(resolveSortMode({ sortMode: "server" })).toBe("server");
  });
});
