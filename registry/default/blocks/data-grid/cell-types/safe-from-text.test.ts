import { afterEach, describe, expect, it, vi } from "vitest";
import { isUnparseable, safeFromText } from "./safe-from-text";
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
