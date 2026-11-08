import { describe, expect, it } from "vitest";
import { lookupCellType } from "../lookup-cell-type";
import type { LookupOption, LookupOptions } from "../lookup-model";

const acme: LookupOption = { value: "c1", label: "Acme" };
const globex: LookupOption = { value: "c2", label: "Globex" };

function makeOptions(overrides: Partial<LookupOptions> = {}): LookupOptions {
  return { fetchOptions: async () => [acme, globex], debounceMs: 0, ...overrides };
}

describe("lookupCellType value pipeline", () => {
  it("toText copies the label, empty for no value", () => {
    expect(lookupCellType.toText(acme)).toBe("Acme");
    expect(lookupCellType.toText(null)).toBe("");
  });

  it("round-trips a copied label back to the key", () => {
    const options = makeOptions();
    const text = lookupCellType.toText(acme, options);
    expect(lookupCellType.fromText(text, options)).toEqual(acme);
    expect(lookupCellType.fromText("  acme ", options)).toEqual(acme);
    expect(lookupCellType.fromText("c1", options)).toEqual(acme);
  });

  it("clears an unresolved paste by default and keeps it on request", () => {
    expect(lookupCellType.fromText("Nobody", makeOptions())).toBeNull();
    expect(lookupCellType.fromText("Nobody", makeOptions({ unresolvedPaste: "keep" }))).toEqual({ value: "Nobody", label: "" });
  });

  it("fromText never throws and bounds hostile text", () => {
    expect(lookupCellType.fromText("", makeOptions())).toBeNull();
    expect(lookupCellType.fromText("   ")).toBeNull();
    const kept = lookupCellType.fromText("x".repeat(100_000), makeOptions({ unresolvedPaste: "keep" }));
    expect(kept).toEqual({ value: "x".repeat(256), label: "" });
  });

  it("isEmpty, clearValue, compare, and search read the label", () => {
    expect(lookupCellType.isEmpty(null)).toBe(true);
    expect(lookupCellType.isEmpty({} as never)).toBe(true);
    expect(lookupCellType.isEmpty(acme)).toBe(false);
    expect(lookupCellType.clearValue()).toBeNull();
    expect(lookupCellType.compare?.(acme, globex)).toBeLessThan(0);
    expect(lookupCellType.compare?.({ value: "z", label: "Alpha" }, { value: "a", label: "Beta" })).toBeLessThan(0);
    expect(lookupCellType.toSearchText?.(acme)).toBe("Acme");
  });

  it("offers no isAnyOf operator", () => {
    expect(lookupCellType.filter?.operators).not.toContain("isAnyOf");
  });

  it("filters by label", () => {
    const match = lookupCellType.filter?.match;
    expect(match?.(acme, { columnId: "c", operator: "contains", value: "cm" })).toBe(true);
    expect(match?.(acme, { columnId: "c", operator: "equals", value: "globex" })).toBe(false);
    expect(match?.(null, { columnId: "c", operator: "empty" })).toBe(true);
  });
});
