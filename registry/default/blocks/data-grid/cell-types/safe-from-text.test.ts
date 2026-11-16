import { afterEach, describe, expect, it, vi } from "vitest";
import { isRejectedText, isUnparseable, parseWithHook, rejectText, safeFromText, UnparseableTextError } from "./safe-from-text";
import { runValidateSync } from "../validation/validate-cell";
import type { CellType } from "../types";

const throwing = { fromText: () => { throw new Error("boom"); } } as unknown as CellType;
const fine = { fromText: (text: string) => text.toUpperCase() } as unknown as CellType;

afterEach(() => vi.restoreAllMocks());

describe("safeFromText", () => {
  it("passes the parsed value and the validator through", () => {
    const validate = () => null;
    const parsed = safeFromText(fine, "a", undefined, validate);
    expect(parsed).toEqual({ value: "A", validate });
    expect(isUnparseable(parsed)).toBe(false);
  });

  it("turns a throw into a rejecting validator", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = safeFromText(throwing, "a", undefined, undefined);
    expect(isUnparseable(parsed)).toBe(true);
    expect(runValidateSync(parsed.validate, parsed.value, {})).toEqual({ error: "The text could not be parsed" });
  });

  it("warns once per cell type", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const type = { fromText: () => { throw new Error("x"); } } as unknown as CellType;
    safeFromText(type, "a", undefined, undefined);
    safeFromText(type, "b", undefined, undefined);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("rejectText", () => {
  it("refuses the text on purpose: the cell is rejected without the faulty-type warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rating: CellType<unknown, number> = { fromText: (text: string) => (/^[0-5]$/.test(text) ? Number(text) : rejectText()) } as unknown as CellType<unknown, number>;
    expect(safeFromText(rating, "4", undefined, undefined).value).toBe(4);
    const parsed = safeFromText(rating, "abc", undefined, undefined);
    expect(isRejectedText(parsed)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(() => rejectText()).toThrow(UnparseableTextError);
  });
});

describe("parseWithHook", () => {
  it("rejects a cell without a warning when the hook passes on a deliberate fromText rejection", () => {
    const warnOnce = vi.fn();
    const parsed = parseWithHook("processCellFromClipboard", () => { throw new UnparseableTextError("not a choice"); }, undefined, warnOnce);
    expect(isRejectedText(parsed)).toBe(true);
    expect(warnOnce).not.toHaveBeenCalled();
  });

  it("warns and rejects when the hook itself throws", () => {
    const warnOnce = vi.fn();
    const parsed = parseWithHook("processCellFromClipboard", () => { throw new Error("boom"); }, undefined, warnOnce);
    expect(isUnparseable(parsed) && !isRejectedText(parsed)).toBe(true);
    expect(warnOnce).toHaveBeenCalledOnce();
  });
});
