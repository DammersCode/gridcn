import { StrictMode, createElement, type ReactNode } from "react";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefixedKey, useWarnSharedPrefix } from "./prefixed-key";

afterEach(cleanup);

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

describe("useWarnSharedPrefix", () => {
  const sharedWarnings = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => String(c[0]).includes("give each grid its own prefix"));

  it("warns once when a second mounted instance uses the same prefix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useWarnSharedPrefix("useDataGridUrlState", "orders"));
    expect(sharedWarnings(warn)).toHaveLength(0);
    const second = renderHook(() => useWarnSharedPrefix("useDataGridUrlState", "orders"));
    second.rerender();
    expect(sharedWarnings(warn)).toHaveLength(1);
    warn.mockRestore();
  });

  it("stays quiet for distinct prefixes and for the two hook kinds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useWarnSharedPrefix("useDataGridUrlState", "a"));
    renderHook(() => useWarnSharedPrefix("useDataGridUrlState", "b"));
    renderHook(() => useWarnSharedPrefix("useDataGridUrlPagination", "a"));
    expect(sharedWarnings(warn)).toHaveLength(0);
    warn.mockRestore();
  });

  it("does not warn for a single instance under StrictMode, or after the first one unmounts", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const strict = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const first = renderHook(() => useWarnSharedPrefix("useDataGridUrlState", "solo"), { wrapper: strict });
    first.unmount();
    renderHook(() => useWarnSharedPrefix("useDataGridUrlState", "solo"));
    expect(sharedWarnings(warn)).toHaveLength(0);
    warn.mockRestore();
  });
});
