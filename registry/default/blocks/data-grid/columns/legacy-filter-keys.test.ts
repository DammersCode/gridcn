import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnyColumnDef } from "../store/types";
import { warnLegacyFilterKeys } from "./legacy-filter-keys";

describe("warnLegacyFilterKeys", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names the old key and its replacement once per key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const column = { id: "a", header: "A", filterOperators: ["gt"], filterMatch: () => true } as unknown as AnyColumnDef;
    warnLegacyFilterKeys(column);
    warnLegacyFilterKeys(column);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("`filterOperators` has no effect; use `filter.operators`");
    expect(warn.mock.calls[1]?.[0]).toContain("`filter.match`");
  });
});
