import { afterEach, describe, expect, it, vi } from "vitest";
import { dateCellType } from "./date";

describe("date display formatting", () => {
  const toDisplayText = dateCellType.toDisplayText!;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats with displayFormat and locale", () => {
    expect(toDisplayText("2024-03-05", { locale: "de-DE", displayFormat: { year: "numeric", month: "long" } })).toBe("März 2024");
  });

  it("a locale that Intl rejects falls back to the ISO text and dev-warns once per displayFormat object", () => {
    const warnSpy = vi.spyOn(console, "warn");
    const displayFormat = { year: "numeric" as const };
    expect(toDisplayText("2024-03-05", { locale: "de_DE", displayFormat })).toBe("2024-03-05");
    expect(toDisplayText("2024-03-05", { locale: "de_DE", displayFormat })).toBe("2024-03-05");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain("invalid date format options");
  });

  it("a timeZone that Intl rejects falls back to the ISO text", () => {
    expect(toDisplayText("2024-03-05", { displayFormat: { timeZone: "Not/AZone" } })).toBe("2024-03-05");
  });
});
