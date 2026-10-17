import { describe, expect, it } from "vitest";
import { safeHref } from "./safe-href";

describe("safeHref", () => {
  it("accepts http, https, and mailto and returns the normalized href", () => {
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    expect(safeHref("mailto:user@example.com")).toBe("mailto:user@example.com");
    // normalized form, never the raw text
    expect(safeHref("https://example.com/a b")).toBe("https://example.com/a%20b");
  });

  it("rejects non-allow-listed protocols", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,evil")).toBeNull();
    expect(safeHref("vbscript:msgbox(1)")).toBeNull();
    expect(safeHref("file:///etc/passwd")).toBeNull();
    expect(safeHref("ftp://example.com/file")).toBeNull();
  });

  it("rejects whitespace-padded schemes the URL parser strips", () => {
    expect(safeHref("\tjavascript:alert(1)")).toBeNull();
    expect(safeHref("  javascript:alert(1)")).toBeNull();
  });

  it("rejects NUL-injected schemes and relative or scheme-less values", () => {
    expect(safeHref("java\0script:alert(1)")).toBeNull();
    expect(safeHref("//evil.example/page")).toBeNull();
    expect(safeHref("example.com/page")).toBeNull();
    expect(safeHref("")).toBeNull();
  });

  it("rejects input longer than 2,048 characters", () => {
    const base = "https://example.com/";
    expect(safeHref(base + "a".repeat(2_048 - base.length))).not.toBeNull();
    expect(safeHref(base + "a".repeat(2_049 - base.length))).toBeNull();
  });
});
