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

describe("text columns order digit runs by value", () => {
  const types = [undefined, "text", "longText", "url"] as const;
  const sortedValues = async (type: (typeof types)[number], values: string[]) => {
    const { computeViewIndex } = await import("../store/compute");
    const { cellTypes } = await import("../cell-types/cell-types");
    const columns = [{ id: "v", header: "V", accessorKey: "v", ...(type ? { type } : {}) }] as never;
    const data = values.map((v) => ({ v }));
    const view = computeViewIndex(data, columns, [{ columnId: "v", direction: "asc" }], [], undefined, cellTypes as never);
    return view.map((i) => data[i]!.v);
  };

  it.each(types)("a %s column orders item2 before item10 and ignores case", async (type) => {
    expect(await sortedValues(type, ["item10", "Item2", "item1"])).toEqual(["item1", "Item2", "item10"]);
  });

  it.each(types)("a %s column takes the keyed path at 300 rows with the same order", async (type) => {
    const filler = Array.from({ length: 297 }, (_, i) => `zz${String(i).padStart(3, "0")}`);
    const ordered = await sortedValues(type, ["item10", "Item2", "item1", ...filler]);
    expect(ordered.slice(0, 3)).toEqual(["item1", "Item2", "item10"]);
  });
});
