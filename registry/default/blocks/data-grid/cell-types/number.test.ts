import { afterEach, describe, expect, it, vi } from "vitest";
import { numberCellType } from "./number";
import { displayText } from "./display-text";

describe("number display formatting", () => {
  const toDisplayText = numberCellType.toDisplayText!;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats currency, percent, and compact from options.format", () => {
    expect(toDisplayText(1234.5, { format: { style: "currency", currency: "USD" } })).toBe("$1,234.50");
    expect(toDisplayText(0.25, { format: { style: "percent" } })).toBe("25%");
    expect(toDisplayText(1_500_000, { format: { notation: "compact" } })).toBe("1.5M");
  });

  it("applies the options.locale", () => {
    expect(toDisplayText(1234.5, { format: { style: "decimal" }, locale: "de-DE" })).toBe("1.234,5");
  });

  it("uses decimals for both fraction digits when the format leaves them open", () => {
    expect(toDisplayText(0.25, { format: { style: "percent" }, decimals: 2 })).toBe("25.00%");
    expect(toDisplayText(1.234, { format: { style: "currency", currency: "USD" }, decimals: 2 })).toBe("$1.23");
  });

  it("keeps explicit fraction-digit options over decimals", () => {
    expect(toDisplayText(1.234, { format: { style: "currency", currency: "USD", minimumFractionDigits: 0 }, decimals: 2 })).toBe(
      new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(1.23),
    );
  });

  it("stays on the raw value without options.format", () => {
    expect(toDisplayText(1234.5)).toBe("1234.5");
    expect(toDisplayText(null, { format: { style: "currency", currency: "USD" } })).toBe("");
  });

  it("toText stays raw with or without a format", () => {
    expect(numberCellType.toText(1234.5, { format: { style: "currency", currency: "USD" } })).toBe("1234.5");
    expect(numberCellType.toText(0.25, { format: { style: "percent" } })).toBe("0.25");
  });

  it("the cell renders the display text through the shared helper", () => {
    expect(displayText(numberCellType, 1234.5, { format: { style: "currency", currency: "USD" } })).toBe("$1,234.50");
  });

  it("an invalid format falls back to the raw text and dev-warns once per options object", () => {
    const warnSpy = vi.spyOn(console, "warn");
    const bad = { style: "currency" as const }; // no currency
    expect(toDisplayText(5, { format: bad })).toBe("5");
    expect(toDisplayText(5, { format: bad })).toBe("5");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain("invalid number format options");
  });

  it("builds one formatter per options object and reuses it across renders and decimals", () => {
    const constructorSpy = vi.spyOn(Intl, "NumberFormat");
    const format: Intl.NumberFormatOptions = { style: "currency", currency: "USD" };
    toDisplayText(1, { format });
    toDisplayText(2, { format });
    toDisplayText(3, { format });
    // a different decimals value needs its own formatter
    toDisplayText(3, { format, decimals: 0 });
    expect(constructorSpy).toHaveBeenCalledTimes(2);
    // a different options object is a fresh cache entry
    toDisplayText(1, { format: { style: "currency", currency: "EUR" } });
    expect(constructorSpy).toHaveBeenCalledTimes(3);
  });
});
