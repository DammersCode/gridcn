import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { dateCellType as DateCellType } from "./date";

describe("date display formatting", () => {
  let toDisplayText: NonNullable<typeof DateCellType.toDisplayText>;

  beforeEach(async () => {
    vi.resetModules();
    toDisplayText = (await import("./date")).dateCellType.toDisplayText!;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats with displayFormat and locale", () => {
    expect(toDisplayText("2024-03-05", { locale: "de-DE", displayFormat: { year: "numeric", month: "long" } })).toBe("März 2024");
  });

  it("a locale that Intl rejects falls back to the ISO text and dev-warns once", () => {
    const warnSpy = vi.mocked(console.warn);
    const displayFormat = { year: "numeric" as const };
    expect(toDisplayText("2024-03-05", { locale: "de_DE", displayFormat })).toBe("2024-03-05");
    expect(toDisplayText("2024-03-05", { locale: "de_DE", displayFormat })).toBe("2024-03-05");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain("invalid date format options");
  });

  it("two equal fresh displayFormat literals warn once and build the failing formatter once", () => {
    const warnSpy = vi.mocked(console.warn);
    const constructorSpy = vi.spyOn(Intl, "DateTimeFormat");
    for (let i = 0; i < 3; i++) toDisplayText("2024-03-05", { locale: "fr_FR", displayFormat: { month: "long" } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  it("stops warning for new failing formats after 100 keys", () => {
    const warnSpy = vi.mocked(console.warn);
    for (let i = 0; i < 150; i++) toDisplayText("2024-03-05", { locale: `bad_${i}`, displayFormat: { year: "numeric" } });
    expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(100);
  });

  it("a timeZone that Intl rejects falls back to the ISO text", () => {
    expect(toDisplayText("2024-03-05", { displayFormat: { timeZone: "Not/AZone" } })).toBe("2024-03-05");
  });
});
