import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "../store/create-store";
import type { AnyColumnDef, InternalSyncProps } from "../store/types";
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

describe("legacy filter key warning per grid", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns once for each grid that reads a flat filter key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const columns = [{ id: "a", header: "A", accessorKey: "a", filterOperators: ["gt"] }];
    const create = () => createDataGridStore({ data: [], columns, getRowId: () => "x" } as unknown as InternalSyncProps);
    create();
    create();
    expect(warn.mock.calls.filter(([message]) => String(message).includes("moved to"))).toHaveLength(2);
  });
});
