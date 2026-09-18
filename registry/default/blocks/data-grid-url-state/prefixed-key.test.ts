import { describe, expect, it } from "vitest";
import { prefixedKey } from "./prefixed-key";

describe("prefixedKey", () => {
  it("returns the bare key when no prefix is given", () => {
    expect(prefixedKey(undefined, "sort")).toBe("sort");
  });

  it("joins prefix and key with an underscore", () => {
    expect(prefixedKey("orders", "sort")).toBe("orders_sort");
  });

  it("namespaces distinct keys the same way, keeping multi-grid params non-colliding", () => {
    expect(prefixedKey("a", "sort")).not.toBe(prefixedKey("b", "sort"));
  });
});
