import { describe, expect, it } from "vitest";
import { adoptOwner, isUnresolved, MAX_LOOKUP_TEXT, readLookup, recallOption, rememberOption, sanitizeOptions } from "../lookup-model";

describe("readLookup", () => {
  it("reads a pair, a bare key, and nothing", () => {
    expect(readLookup({ value: "c1", label: "Acme" })).toEqual({ value: "c1", label: "Acme" });
    expect(readLookup("c1")).toEqual({ value: "c1", label: "c1" });
    expect(readLookup(7)).toEqual({ value: "7", label: "7" });
    expect(readLookup(null)).toBeNull();
    expect(readLookup({})).toBeNull();
    expect(readLookup(true)).toBeNull();
  });

  it("falls back to the key for a missing label and bounds long text", () => {
    expect(readLookup({ value: "c1", label: "" })).toEqual({ value: "c1", label: "c1" });
    expect(readLookup({ value: "x".repeat(10_000), label: "y".repeat(10_000) })?.label).toHaveLength(MAX_LOOKUP_TEXT);
  });

  it("survives a null-prototype object", () => {
    expect(readLookup(Object.create(null))).toBeNull();
  });

  it("marks an id-only value as unresolved", () => {
    expect(isUnresolved("c1")).toBe(true);
    expect(isUnresolved({ value: "c1", label: "Acme" })).toBe(false);
    expect(isUnresolved(null)).toBe(false);
    expect(isUnresolved({ value: "USD", label: "USD" })).toBe(false);
  });
});

describe("sanitizeOptions", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ value: String(i), label: "l" }));

  it("drops malformed and repeated entries", () => {
    const answer = [{ value: "a", label: "A" }, { value: "a", label: "again" }, null, 3, { value: true, label: "n" }, { value: "", label: "e" }, { value: "b" }, { value: "c", label: "C" }];
    expect(sanitizeOptions(answer, 50)).toEqual([
      { value: "a", label: "A" },
      { value: "c", label: "C" },
    ]);
  });

  it("caps the count at the limit, and the limit at 200", () => {
    expect(sanitizeOptions(many(1000), undefined)).toHaveLength(50);
    expect(sanitizeOptions(many(1000), 10_000)).toHaveLength(200);
    expect(sanitizeOptions(many(1000), 3)).toHaveLength(3);
  });

  it("falls back to the key for an empty label", () => {
    expect(sanitizeOptions([{ value: "k", label: "" }], 5)).toEqual([{ value: "k", label: "k" }]);
  });

  it("accepts numeric keys as text", () => {
    expect(sanitizeOptions([{ value: 7, label: "Seven" }], 5)).toEqual([{ value: "7", label: "Seven" }]);
  });

  it("rejects a non-array answer", () => {
    expect(() => sanitizeOptions({ rows: [] }, 5)).toThrow(TypeError);
    expect(() => sanitizeOptions(null, 5)).toThrow(TypeError);
  });
});

describe("known options", () => {
  it("recalls by label (any case) and by key, per owner", () => {
    const a = {};
    const b = {};
    rememberOption(a, { value: "c1", label: "Acme" });
    expect(recallOption(a, "acme")).toEqual({ value: "c1", label: "Acme" });
    expect(recallOption(a, "c1")).toEqual({ value: "c1", label: "Acme" });
    expect(recallOption(b, "Acme")).toBeUndefined();
  });

  it("treats a label shared by two keys as ambiguous", () => {
    const owner = {};
    rememberOption(owner, { value: "a", label: "John Smith" });
    rememberOption(owner, { value: "b", label: "John Smith" });
    rememberOption(owner, { value: "a", label: "John Smith" });
    expect(recallOption(owner, "john smith")).toBeUndefined();
    expect(recallOption(owner, "b")).toEqual({ value: "b", label: "John Smith" });
  });

  it("forgets the oldest entry past the bound", () => {
    const owner = {};
    for (let i = 0; i < 5100; i++) rememberOption(owner, { value: `v${i}`, label: `L${i}` });
    expect(recallOption(owner, "L0")).toBeUndefined();
    expect(recallOption(owner, "L5099")).toBeDefined();
  });
});

describe("adoptOwner", () => {
  const acme = { value: "c1", label: "Acme" };

  it("carries a column's options over to its next fetchOptions identity", () => {
    const grid = {};
    const first = {};
    const next = {};
    adoptOwner(grid, "customer", first);
    rememberOption(first, acme);
    adoptOwner(grid, "customer", next);
    expect(recallOption(next, "Acme")).toEqual(acme);
  });

  it("merges into an identity that already remembered options", () => {
    const grid = {};
    const first = {};
    const next = {};
    adoptOwner(grid, "customer", first);
    rememberOption(first, acme);
    rememberOption(next, { value: "c2", label: "Globex" });
    adoptOwner(grid, "customer", next);
    expect(recallOption(next, "Acme")).toEqual(acme);
    expect(recallOption(next, "Globex")).toEqual({ value: "c2", label: "Globex" });
  });

  it("keeps other grids and other columns apart", () => {
    const gridA = {};
    const gridB = {};
    const first = {};
    adoptOwner(gridA, "customer", first);
    rememberOption(first, acme);
    const otherGrid = {};
    const otherColumn = {};
    adoptOwner(gridB, "customer", otherGrid);
    adoptOwner(gridA, "supplier", otherColumn);
    expect(recallOption(otherGrid, "Acme")).toBeUndefined();
    expect(recallOption(otherColumn, "Acme")).toBeUndefined();
  });

  it("drops the remembered labels when the cache key changes, also for the same fetchOptions", () => {
    const grid = {};
    const fetchOptions = {};
    adoptOwner(grid, "customer", fetchOptions, "tenant-a");
    rememberOption(fetchOptions, acme);
    adoptOwner(grid, "customer", fetchOptions, "tenant-a");
    expect(recallOption(fetchOptions, "Acme")).toEqual(acme);
    adoptOwner(grid, "customer", fetchOptions, "tenant-b");
    expect(recallOption(fetchOptions, "Acme")).toBeUndefined();
  });

  it("does not carry labels to a new identity when the cache key changed", () => {
    const grid = {};
    const first = {};
    const next = {};
    adoptOwner(grid, "customer", first, 1);
    rememberOption(first, acme);
    adoptOwner(grid, "customer", next, 2);
    expect(recallOption(next, "Acme")).toBeUndefined();
  });
});

describe("rememberOption on a repeated render", () => {
  it("keeps the stored option when an equal option is shown again", () => {
    const owner = {};
    const first = { value: "c1", label: "Acme" };
    rememberOption(owner, first);
    rememberOption(owner, { value: "c1", label: "Acme" });
    expect(recallOption(owner, "Acme")).toBe(first);
    rememberOption(owner, { value: "c1", label: "Acme Corp" });
    expect(recallOption(owner, "Acme Corp")).toEqual({ value: "c1", label: "Acme Corp" });
  });
});
