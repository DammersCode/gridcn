import { describe, expect, it } from "vitest";
import { urlCellType } from "./url";

describe("url cell type", () => {
  it("toText is the trimmed URL", () => {
    expect(urlCellType.toText("  https://example.com/a ")).toBe("https://example.com/a");
    expect(urlCellType.toText(null)).toBe("");
  });

  it("fromText trims and clearValue clears to null", () => {
    expect(urlCellType.fromText("  https://example.com/a ")).toBe("https://example.com/a");
    expect(urlCellType.clearValue()).toBeNull();
  });

  it("href resolves the stored URL through the allow-list", () => {
    const href = urlCellType.href!;
    expect(href("https://example.com/a")).toBe("https://example.com/a");
    expect(href("mailto:user@example.com")).toBe("mailto:user@example.com");
    expect(href("  https://example.com/a  ")).toBe("https://example.com/a");
    expect(href("javascript:alert(1)")).toBeNull();
    expect(href("")).toBeNull();
    expect(href(null)).toBeNull();
  });

  it("toDisplayText shows the URL, or options.label when set", () => {
    const display = urlCellType.toDisplayText!;
    expect(display(" https://example.com/a ")).toBe("https://example.com/a");
    expect(display("https://example.com/a", { label: (url) => `Open ${url}` })).toBe("Open https://example.com/a");
  });

  it("isEmpty, compare, and filter capabilities", () => {
    expect(urlCellType.isEmpty(null)).toBe(true);
    expect(urlCellType.isEmpty("")).toBe(true);
    expect(urlCellType.isEmpty("https://example.com")).toBe(false);
    expect(urlCellType.compare!("a", "b")).toBeLessThan(0);
    expect(urlCellType.compare!("b", "a")).toBeGreaterThan(0);
    expect(urlCellType.filter?.valueInput).toBe("text");
  });
});
