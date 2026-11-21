import { afterEach, describe, expect, it, vi } from "vitest";
import { numberCellType } from "./number";
import { displayText } from "./display-text";

describe("number display formatting", () => {
  const toDisplayText = numberCellType.toDisplayText!;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a null-prototype value with a format falls back to safe text", () => {
    const hostile = Object.create(null) as never;
    expect(() => toDisplayText(hostile, { format: { style: "currency", currency: "USD" } })).not.toThrow();
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

  it("formats an exact decimal string without a round trip through Number", () => {
    expect(toDisplayText("12345678901234567.89" as never, { format: { style: "decimal" } })).toBe("12,345,678,901,234,567.89");
    expect(toDisplayText("12345678901234567.885" as never, { format: { style: "currency", currency: "USD" }, decimals: 2 })).toBe("$12,345,678,901,234,567.89");
    expect(toDisplayText("-0.001" as never, { format: { style: "decimal" }, decimals: 2 })).toBe("0.00");
    expect(numberCellType.toText("12345678901234567.885" as never, { decimals: 2 })).toBe("12345678901234567.89");
    expect(numberCellType.toText("12345678901234567.80" as never)).toBe("12345678901234567.80");
    expect(numberCellType.toText("12.50" as never, { decimals: 2 })).toBe("12.50");
  });

  it("shows a string that is not a decimal, or is over 1,024 characters, as its text", () => {
    const long = "1".repeat(100_000);
    expect(toDisplayText(long as never, { format: { style: "decimal" }, decimals: 2 })).toBe(long);
    expect(toDisplayText("1e5" as never, { format: { style: "decimal" } })).toBe("1e5");
    expect(numberCellType.toText("abc" as never, { decimals: 2 })).toBe("abc");
  });

  it("formats numbers exactly as before", () => {
    expect(toDisplayText(1.005, { format: { style: "decimal" }, decimals: 2 })).toBe("1.01");
    expect(toDisplayText(-1.5, { format: { style: "decimal" }, decimals: 0 })).toBe("-1");
    expect(toDisplayText(-0.001, { format: { style: "decimal" }, decimals: 2 })).toBe("0.00");
    expect(numberCellType.toText(1.005, { decimals: 2 })).toBe("1.01");
    expect(numberCellType.toText(-1.5, { decimals: 0 })).toBe("-1");
    expect(numberCellType.toText(12.5, { decimals: 2 })).toBe("12.5");
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

  it("two equal fresh format literals warn once and build the failing formatter once", () => {
    const warnSpy = vi.spyOn(console, "warn");
    const constructorSpy = vi.spyOn(Intl, "NumberFormat");
    for (let i = 0; i < 3; i++) expect(toDisplayText(7, { format: { style: "unit" as const } })).toBe("7");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  it("builds one formatter per equal options and reuses it across renders and decimals", () => {
    const constructorSpy = vi.spyOn(Intl, "NumberFormat");
    const format: Intl.NumberFormatOptions = { style: "currency", currency: "CHF" };
    toDisplayText(1, { format });
    toDisplayText(2, { format });
    toDisplayText(3, { format: { ...format } });
    // a different decimals value needs its own formatter
    toDisplayText(3, { format, decimals: 0 });
    expect(constructorSpy).toHaveBeenCalledTimes(2);
    // different options are a fresh cache entry
    toDisplayText(1, { format: { style: "currency", currency: "SEK" } });
    expect(constructorSpy).toHaveBeenCalledTimes(3);
  });
});

describe("number fromText input validation", () => {
  const fromText = numberCellType.fromText!;

  it.each(["Infinity", "-Infinity", "1e999", "-1e999", "0x10", "0b11", "0o7", "1_000", "NaN", "1e", "--1", "."])(
    "rejects %s",
    (text) => {
      expect(() => fromText(text, undefined)).toThrow();
    },
  );

  it.each([
    ["1,234.50", 1234.5],
    ["1,234,567", 1234567],
    ["-1,234.5", -1234.5],
    ["1.234,50", 1234.5],
    ["1.234.567,5", 1234567.5],
  ])("reads the grouped number %s", (text, expected) => {
    expect(fromText(text, undefined)).toBe(expected);
  });

  it("rejects 1,234 as ambiguous instead of storing 1.234", () => {
    expect(() => fromText("1,234", undefined)).toThrow();
  });

  it("rejects abc instead of clearing the cell", () => {
    expect(() => fromText("abc", undefined)).toThrow();
    expect(fromText("  ", undefined)).toBeNull();
  });

  it.each([
    ["42", 42],
    ["-3.5", -3.5],
    ["+7", 7],
    [" 1,5 ", 1.5],
    [".5", 0.5],
    ["5.", 5],
    ["1e3", 1000],
    ["-2.5E-2", -0.025],
  ])("accepts %s", (text, expected) => {
    expect(fromText(text, undefined)).toBe(expected);
  });

  it("rejects a long digit run with a trailing letter in linear time", () => {
    const start = performance.now();
    expect(() => fromText(`${"1".repeat(200_000)}x`, undefined)).toThrow();
    expect(performance.now() - start).toBeLessThan(500);
  });
});
