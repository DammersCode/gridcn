import { describe, expect, it } from "vitest";
import { longTextCellType, LONG_TEXT_DEFAULT_MAX_LENGTH } from "./long-text";

const toText = longTextCellType.toText!;
const toDisplayText = longTextCellType.toDisplayText!;
const fromText = longTextCellType.fromText!;
const clearValue = longTextCellType.clearValue!;
const isEmpty = longTextCellType.isEmpty!;

describe("longText cell type", () => {
  it("toText keeps the stored value verbatim, line breaks included", () => {
    expect(toText("line one\nline two\r\nline three")).toBe("line one\nline two\r\nline three");
    expect(toText(null as unknown as string)).toBe("");
  });

  it("toDisplayText caps at 500 characters and shows line breaks as spaces", () => {
    expect(toDisplayText("x".repeat(600))).toHaveLength(500);
    expect(toDisplayText("line one\nline two\r\nline three")).toBe("line one line two line three");
    expect(toDisplayText(null as unknown as string)).toBe("");
  });

  it("fromText is the identity and clearValue empties", () => {
    expect(fromText("  kept as-is ")).toBe("  kept as-is ");
    expect(clearValue()).toBe("");
    expect(isEmpty("")).toBe(true);
    expect(isEmpty("x")).toBe(false);
  });

  it("the default validate bounds stored text at the default max length", () => {
    const validate = longTextCellType.validate! as (value: string, row: unknown) => string | null;
    expect(validate("ok", {})).toBeNull();
    expect(validate("x".repeat(LONG_TEXT_DEFAULT_MAX_LENGTH), {})).toBeNull();
    const rejected = validate("x".repeat(LONG_TEXT_DEFAULT_MAX_LENGTH + 1), {});
    expect(rejected).toContain(String(LONG_TEXT_DEFAULT_MAX_LENGTH));
  });

  it("declares text filter capabilities", () => {
    expect(longTextCellType.filter?.valueInput).toBe("text");
  });
});
