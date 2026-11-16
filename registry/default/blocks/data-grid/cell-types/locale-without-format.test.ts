import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { numberCellType } from "./number";
import { dateCellType } from "./date";

describe("locale without a format", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("a number column with a locale and no format shows grouped digits in that locale", () => {
    expect(numberCellType.toDisplayText!(1234.5, { locale: "de-DE" })).toBe("1.234,5");
    expect(numberCellType.toText(1234.5, { locale: "de-DE" })).toBe("1234.5");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("an explicit format still wins over the implied one", () => {
    expect(numberCellType.toDisplayText!(1234.5, { locale: "de-DE", format: { useGrouping: false } })).toBe("1234,5");
  });

  it("a date column with a locale and no displayFormat shows the medium date style in that locale", () => {
    expect(dateCellType.toDisplayText!("2024-03-05", { locale: "de-DE" })).toBe("05.03.2024");
    expect(dateCellType.toText("2024-03-05", { locale: "de-DE" })).toBe("2024-03-05");
    expect(console.warn).not.toHaveBeenCalled();
  });
});
