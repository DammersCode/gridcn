import { describe, expect, it } from "vitest";
import {
  assertImportRows,
  DEFAULT_IMPORT_LIMITS,
  FILE_TOO_LARGE_MESSAGE,
  IMPORT_TOO_MANY_CELLS_MESSAGE,
  parseImportFile,
  resolveImportLimits,
} from "./parse-import-file";

const csv = (text: string) => new File([text], "h.csv", { type: "text/csv" });

describe("import limits from untrusted config", () => {
  it("a NaN limit takes the default and a negative one counts as 0", () => {
    expect(resolveImportLimits({ maxRows: Number.NaN, maxFileBytes: -5 })).toMatchObject({ maxRows: DEFAULT_IMPORT_LIMITS.maxRows, maxFileBytes: 0 });
    expect(resolveImportLimits().maxCells).toBe(DEFAULT_IMPORT_LIMITS.maxCells);
  });

  it("NaN maxFileBytes keeps the file-size bound", async () => {
    const file = csv("x");
    Object.defineProperty(file, "size", { value: DEFAULT_IMPORT_LIMITS.maxFileBytes + 1 });
    await expect(parseImportFile(file, { maxFileBytes: Number.NaN })).rejects.toThrow(FILE_TOO_LARGE_MESSAGE);
  });

  it("NaN maxCells keeps the cell bound of the built-in parser", async () => {
    await expect(parseImportFile(csv("a,b,c\n".repeat(10)), { maxCells: Number.NaN, maxColumns: 2 })).rejects.toThrow(IMPORT_TOO_MANY_CELLS_MESSAGE);
  });

  it("NaN limits keep the bounds on rows from a consumer hook", () => {
    const rows = Array.from({ length: DEFAULT_IMPORT_LIMITS.maxRows + 1 }, () => ["a"]);
    expect(() => assertImportRows(rows, { maxRows: Number.NaN })).toThrow(IMPORT_TOO_MANY_CELLS_MESSAGE);
    expect(() => assertImportRows([["a", "b", "c"]], { maxColumns: Number.NaN, maxCells: 2 })).toThrow(IMPORT_TOO_MANY_CELLS_MESSAGE);
  });
});
