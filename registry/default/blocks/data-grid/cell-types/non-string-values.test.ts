import { describe, expect, it } from "vitest";
import { selectCellType } from "./select";
import { textCellType } from "./text";
import { urlCellType } from "./url";

const nonString = (value: number | boolean) => value as unknown as string;

describe("text pipelines tolerate non-string values", () => {
  it("url", () => {
    expect(urlCellType.toText(nonString(123))).toBe("123");
    expect(urlCellType.toDisplayText?.(nonString(123), undefined)).toBe("123");
    expect(urlCellType.href?.(nonString(123), undefined)).toBeNull();
    expect(urlCellType.toText(" https://example.com ")).toBe("https://example.com");
  });

  it("text", () => {
    expect(textCellType.toText(nonString(42))).toBe("42");
    expect(textCellType.toText(nonString(false))).toBe("false");
    expect(textCellType.toText("a b")).toBe("a b");
  });

  it("select", () => {
    const options = { choices: [{ value: "1", label: "One" }, { value: "2", label: "Two" }] };
    expect(selectCellType.toText(nonString(1), options)).toBe("One");
    expect(selectCellType.toSearchText?.(nonString(2), options)).toBe("Two");
    expect(selectCellType.toText(nonString(9), options)).toBe("9");
    expect(selectCellType.toText("1", options)).toBe("One");
  });
});
