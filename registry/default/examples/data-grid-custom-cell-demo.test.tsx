import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { currencyCellType } from "./data-grid-custom-cell-demo";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";

describe("currencyCellType value pipeline", () => {
  it("fromText strips currency symbols and thousands separators", () => {
    expect(currencyCellType.fromText("$1,234.56")).toBeCloseTo(1234.56);
    expect(currencyCellType.fromText("EUR 42")).toBeCloseTo(42);
  });

  it("fromText trims whitespace", () => {
    expect(currencyCellType.fromText("  99.5  ")).toBeCloseTo(99.5);
  });

  it("fromText never throws on garbage; returns clearValue()'s result (null)", () => {
    expect(currencyCellType.fromText("not a price")).toBeNull();
    expect(currencyCellType.fromText("$")).toBeNull();
    expect(currencyCellType.fromText("")).toBeNull();
  });

  it("toText is the canonical unformatted number, not the display format", () => {
    expect(currencyCellType.toText(1234.5)).toBe("1234.5");
    expect(currencyCellType.toText(null)).toBe("");
  });

  it("toDisplayText formats per options.currency/locale; toText ignores both", () => {
    expect(currencyCellType.toDisplayText!(1234.5, { currency: "USD", locale: "en-US" })).toBe("$1,234.50");
    expect(currencyCellType.toDisplayText!(1234.5, { currency: "EUR", locale: "de-DE" })).toContain("1.234,50");
    expect(currencyCellType.toText(1234.5, { currency: "EUR", locale: "de-DE" })).toBe("1234.5");
  });

  it("toDisplayText without an explicit locale is deterministic (SSR hydration contract)", () => {
    expect(currencyCellType.toDisplayText!(10, { currency: "USD" })).toBe("$10.00");
  });

  it("isEmpty is null-only (0 is a real amount, not empty)", () => {
    expect(currencyCellType.isEmpty(null)).toBe(true);
    expect(currencyCellType.isEmpty(0)).toBe(false);
  });

  it("clearValue returns null", () => {
    expect(currencyCellType.clearValue()).toBeNull();
  });

  it("compare is numeric with nulls sorted first", () => {
    expect(currencyCellType.compare!(1, 2)).toBeLessThan(0);
    expect(currencyCellType.compare!(2, 1)).toBeGreaterThan(0);
    expect(currencyCellType.compare!(null, 1)).toBeLessThan(0);
    expect(currencyCellType.compare!(1, null)).toBeGreaterThan(0);
    expect(currencyCellType.compare!(null, null)).toBe(0);
  });
});

describe("currencyCellType.Editor focus", () => {
  afterEach(cleanup);

  it("focuses the input with the caret at the end on mount, so the user can type immediately", () => {
    const onChange = vi.fn();
    const commit = vi.fn();
    const cancel = vi.fn();
    render(
      <currencyCellType.Editor
        value={1234.5}
        row={{}}
        column={{ id: "priceUsd", header: "USD", options: { currency: "USD" } } as ColumnDef<unknown, number | null>}
        onChange={onChange}
        commit={commit}
        cancel={cancel}
      />,
    );
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("1234.5");
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});
