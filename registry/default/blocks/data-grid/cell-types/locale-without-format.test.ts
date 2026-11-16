import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("locale without a format", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("a number column with a locale and no format dev-warns once", async () => {
    const { numberCellType } = await import("./number");
    expect(numberCellType.toDisplayText!(1234.5, { locale: "de-DE" })).toBe("1234.5");
    numberCellType.toDisplayText!(1234.5, { locale: "de-DE" });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]![0]).toContain("without format");
  });

  it("a number column with a locale and a format does not warn", async () => {
    const { numberCellType } = await import("./number");
    numberCellType.toDisplayText!(1234.5, { locale: "de-DE", format: {} });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("a date column with a locale and no displayFormat dev-warns once", async () => {
    const { dateCellType } = await import("./date");
    dateCellType.toDisplayText!("2024-03-05", { locale: "de-DE" });
    dateCellType.toDisplayText!("2024-03-05", { locale: "de-DE" });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]![0]).toContain("without displayFormat");
  });
});
