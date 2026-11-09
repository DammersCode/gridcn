import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnyColumnDef } from "../store/types";
import { warnLegacyFilterKeys, withLogicalFilter } from "./legacy-filter-keys";

describe("warnLegacyFilterKeys", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names the old key and its replacement once per key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const column = { id: "a", header: "A", filterOperators: ["gt"], filterMatch: () => true } as unknown as AnyColumnDef;
    warnLegacyFilterKeys(column);
    warnLegacyFilterKeys(column);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("`filterOperators` moved to `filter.operators`");
    expect(warn.mock.calls[1]?.[0]).toContain("`filter.match`");
  });
});

describe("withLogicalFilter", () => {
  it("moves a flat key into filter when that member is absent", () => {
    const match = () => true;
    const column = { id: "a", header: "A", filterOperators: ["gt"], filterMatch: match, filter: { operators: ["lt"] } } as unknown as AnyColumnDef;
    const next = withLogicalFilter(column);
    expect(next.filter).toEqual({ operators: ["lt"], match });
    expect(withLogicalFilter(column)).toBe(next);
  });

  it("returns a column without flat keys by identity", () => {
    const column = { id: "a", header: "A", filter: { operators: ["gt"] } } as unknown as AnyColumnDef;
    expect(withLogicalFilter(column)).toBe(column);
  });
});
