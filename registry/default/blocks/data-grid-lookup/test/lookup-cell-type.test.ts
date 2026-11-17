import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { UnparseableTextError } from "@/registry/default/blocks/data-grid/data-grid-sdk";
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

  it("rejects an unresolved paste by default, so the cell keeps its value; clears or keeps it on request", () => {
    expect(() => lookupCellType.fromText("Nobody", makeOptions())).toThrow(UnparseableTextError);
    expect(lookupCellType.fromText("Nobody", makeOptions({ unresolvedPaste: "clear" }))).toBeNull();
    expect(lookupCellType.fromText("Nobody", makeOptions({ unresolvedPaste: "keep" }))).toEqual({ value: "Nobody", label: "" });
  });

  it("resolves a label that a cell only rendered", () => {
    const options = makeOptions();
    render(createElement(lookupCellType.Cell, { value: globex, options } as never));
    expect(lookupCellType.fromText("globex", options)).toEqual(globex);
  });

  it("fromText bounds hostile text and reads blank text as empty", () => {
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

  it("filters by label", () => {
    const match = lookupCellType.filter?.match;
    expect(match?.(acme, { columnId: "c", operator: "contains", value: "cm" })).toBe(true);
    expect(match?.(acme, { columnId: "c", operator: "equals", value: "globex" })).toBe(false);
    expect(match?.(null, { columnId: "c", operator: "empty" })).toBe(true);
  });
});

describe("lookupCellType resolveTexts", () => {
  const signal = new AbortController().signal;

  it("asks resolveLabels once for the unknown labels, then fromText finds them", async () => {
    const resolveLabels = vi.fn(async () => [acme, globex]);
    const options = makeOptions({ resolveLabels });
    lookupCellType.toText(acme, options);
    await lookupCellType.resolveTexts!(["Acme", " Globex ", "Globex", "", "Nobody"], options, { signal });
    expect(resolveLabels).toHaveBeenCalledTimes(1);
    expect(resolveLabels).toHaveBeenCalledWith({ labels: ["Globex", "Nobody"], signal });
    expect(lookupCellType.fromText("globex", options)).toEqual(globex);
    expect(() => lookupCellType.fromText("Nobody", options)).toThrow(UnparseableTextError);
  });

  it("does nothing when every label is known or no resolveLabels is set", () => {
    const resolveLabels = vi.fn(async () => []);
    const options = makeOptions({ resolveLabels });
    lookupCellType.toText(acme, options);
    expect(lookupCellType.resolveTexts!(["Acme"], options, { signal })).toBeUndefined();
    expect(resolveLabels).not.toHaveBeenCalled();
    expect(lookupCellType.resolveTexts!(["Zed"], makeOptions(), { signal })).toBeUndefined();
  });
});

describe("lookupCellType filter", () => {
  const spec = (operator: "isAnyOf" | "isNoneOf" | "contains", value: string | string[]) => ({ columnId: "c", operator, value });

  it("lists the set operators beside the text operators", () => {
    expect(lookupCellType.filter?.operators).toEqual(expect.arrayContaining(["contains", "isAnyOf", "isNoneOf"]));
  });

  it("matches a set entry by the stored key or by the label; text operators read the label", () => {
    const match = lookupCellType.filter!.match!;
    expect(match(acme, spec("isAnyOf", ["c1"]))).toBe(true);
    expect(match(acme, spec("isAnyOf", ["acme"]))).toBe(true);
    expect(match(acme, spec("isAnyOf", ["c2"]))).toBe(false);
    expect(match(acme, spec("isNoneOf", ["c1"]))).toBe(false);
    expect(match(acme, spec("isNoneOf", ["c2"]))).toBe(true);
    expect(match(acme, spec("contains", "cm"))).toBe(true);
    expect(match(acme, spec("contains", "c1"))).toBe(false);
  });
});
