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
