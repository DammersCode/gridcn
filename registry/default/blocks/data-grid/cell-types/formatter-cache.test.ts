import { afterEach, expect, it, vi } from "vitest";
import { formatKey } from "./formatter-cache";
import { numberCellType } from "./number";
import { dateCellType } from "./date";

afterEach(() => vi.restoreAllMocks());

it("serializes a stable number format once", () => {
  const options = { format: { style: "currency", currency: "USD" } as Intl.NumberFormatOptions, locale: "en-US" };
  numberCellType.toDisplayText!(1, options as never);
  const stringify = vi.spyOn(JSON, "stringify");
  for (let i = 0; i < 50; i++) numberCellType.toDisplayText!(i, options as never);
  expect(stringify).not.toHaveBeenCalled();
});

it("serializes a stable date format once", () => {
  const options = { displayFormat: { dateStyle: "medium" }, locale: "en-US" };
  dateCellType.toDisplayText!("2024-01-02", options as never);
  const stringify = vi.spyOn(JSON, "stringify");
  for (let i = 0; i < 50; i++) dateCellType.toDisplayText!("2024-01-02", options as never);
  expect(stringify).not.toHaveBeenCalled();
});

it("keys equal content alike and survives a non-object format", () => {
  expect(formatKey({ a: 1 })).toBe(formatKey({ a: 1 }));
  expect(formatKey("x" as never)).toBe('"x"');
});

it.each([
  ["cyclic", "en-US", () => { const f: Record<string, unknown> = { style: "decimal" }; f["self"] = f; return f; }],
  ["BigInt", "de-DE", () => ({ style: "decimal", extra: 1n })],
])("a %s number format falls back to the plain number with one warning", (_name, locale, make) => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const options = { format: make() as Intl.NumberFormatOptions, locale };
  for (let i = 0; i < 3; i++) expect(numberCellType.toDisplayText!(1.5, options as never)).toBe("1.5");
  expect(warn).toHaveBeenCalledTimes(1);
});

it("a cyclic date format falls back to the ISO text", () => {
  const displayFormat: Record<string, unknown> = { dateStyle: "medium" };
  displayFormat["self"] = displayFormat;
  expect(dateCellType.toDisplayText!("2024-01-02", { displayFormat, locale: "en-US" } as never)).toBe("2024-01-02");
});
