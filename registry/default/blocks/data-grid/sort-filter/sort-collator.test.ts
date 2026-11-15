import { afterEach, describe, expect, it, vi } from "vitest";
import { sortCollator, withSortLocale } from "./sort-collator";

afterEach(() => vi.restoreAllMocks());

describe("withSortLocale", () => {
  it("returns what the synchronous callback returns and restores the previous locale", () => {
    expect(withSortLocale("sv", () => sortCollator().resolvedOptions().locale)).toBe("sv");
    expect(sortCollator().resolvedOptions().locale).toBe("en-US");
  });

  it("warns once in development when the callback returns a promise", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await withSortLocale("sv", async () => 1);
    await withSortLocale("sv", async () => 2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("synchronous");
  });
});
