import { describe, expect, it, vi } from "vitest";
import { DEFAULT_IMPORT_LIMITS, parseImportFile } from "./parse-import-file";
import { workbookFile, XLSX_TYPE } from "./xlsx-fixtures.test-helper";

function makeCsvFile(content: string, name = "data.csv"): File {
  return new File([content], name, { type: "text/csv" });
}

describe("parseImportFile — csv", () => {
  it("auto-detects a comma delimiter", async () => {
    const result = await parseImportFile(makeCsvFile("name,age\nAlice,30\nBob,40"));
    expect(result.delimiter).toBe(",");
    expect(result.rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
      ["Bob", "40"],
    ]);
  });

  it("auto-detects a semicolon delimiter", async () => {
    const result = await parseImportFile(makeCsvFile("name;age\nAlice;30"));
    expect(result.delimiter).toBe(";");
    expect(result.rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
    ]);
  });

  it("auto-detects a tab delimiter", async () => {
    const result = await parseImportFile(makeCsvFile("name\tage\nAlice\t30"));
    expect(result.delimiter).toBe("\t");
    expect(result.rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
    ]);
  });

  it("honors a user-supplied delimiter override even when another delimiter would auto-detect differently", async () => {
    // this text reads as one comma-delimited column per papaparse's auto-detect;
    // forcing ';' proves the override wins.
    const result = await parseImportFile(makeCsvFile("a;b,c\n1;2,3"), { csvDelimiter: ";" });
    expect(result.delimiter).toBe(";");
    expect(result.rows).toEqual([
      ["a", "b,c"],
      ["1", "2,3"],
    ]);
  });

  it("accepts a .tsv file (tab-separated) and parses it through the csv path", async () => {
    const file = new File(["name\tage\nAlice\t30"], "data.tsv", { type: "text/tab-separated-values" });
    const result = await parseImportFile(file);
    expect(result.delimiter).toBe("\t");
    expect(result.rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
    ]);
  });

  it("skips empty lines", async () => {
    const result = await parseImportFile(makeCsvFile("name,age\n\nAlice,30\n"));
    expect(result.rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
    ]);
  });
});

describe("parseImportFile — xlsx edge cases", () => {
  it("returns an empty grid for an empty sheet", async () => {
    const result = await parseImportFile(await workbookFile({ Empty: [] }));
    expect(result.rows).toEqual([]);
    expect(result.sheetNames).toEqual(["Empty"]);
  });

  it("fills empty cells inside the grid with empty strings", async () => {
    const result = await parseImportFile(await workbookFile({ Sheet1: [["Alice", null, "x"], ["Bob"]] }));
    expect(result.rows).toEqual([
      ["Alice", "", "x"],
      ["Bob", "", ""],
    ]);
  });

  it("reads a workbook by its content even when the extension says .xls", async () => {
    const xlsx = await workbookFile({ Sheet1: [["name"], ["Alice"]] });
    const renamed = new File([await xlsx.arrayBuffer()], "renamed.xls", { type: "application/vnd.ms-excel" });
    await expect(parseImportFile(renamed)).resolves.toMatchObject({ rows: [["name"], ["Alice"]] });
  });

  it("rejects an .xlsx file that is not a zip or OLE2 container", async () => {
    const file = new File(["name,age\nAlice,30"], "data.xlsx", { type: XLSX_TYPE });
    await expect(parseImportFile(file)).rejects.toThrow("unsupported-excel-format");
  });

  it("surfaces a corrupt workbook as the reader's own error", async () => {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])], "broken.xlsx", { type: XLSX_TYPE });
    await expect(parseImportFile(file)).rejects.toThrow();
    await expect(parseImportFile(file)).rejects.not.toThrow(/import-too-many-cells|file-too-large|unsupported-excel-format/);
  });
});

// `sheetNames` exposes every sheet so a caller avoids the first-sheet-only default.
describe("parseImportFile — xlsx sheetNames", () => {
  it("returns every sheet name alongside the first sheet's rows, for a multi-sheet workbook", async () => {
    const result = await parseImportFile(await workbookFile({ Summary: [["summary-row"]], "Q3 Data": [["q3-row"]] }));
    expect(result.rows).toEqual([["summary-row"]]);
    expect(result.sheetNames).toEqual(["Summary", "Q3 Data"]);
    expect(result.sheetName).toBe("Summary");
  });

  it("returns a single-entry sheetNames for a single-sheet workbook", async () => {
    const result = await parseImportFile(await workbookFile({ Sheet1: [["Alice"]] }));
    expect(result.sheetNames).toEqual(["Sheet1"]);
  });

  it("csv results carry no sheetNames", async () => {
    const result = await parseImportFile(makeCsvFile("name\nAlice"));
    expect(result.sheetNames).toBeUndefined();
  });
});

// A multi-sheet workbook selects its sheet instead of importing the first.
describe("parseImportFile — xlsx sheet selection", () => {
  const twoSheets = () => workbookFile({ Summary: [["summary-row"]], "Q3 Data": [["q3-row"]] });

  it("parses the sheet named by the sheetName option", async () => {
    const result = await parseImportFile(await twoSheets(), { sheetName: "Q3 Data" });
    expect(result.rows).toEqual([["q3-row"]]);
    expect(result.sheetName).toBe("Q3 Data");
    expect(result.sheetNames).toEqual(["Summary", "Q3 Data"]);
  });

  it("rejects when the sheetName option names a sheet the workbook doesn't have", async () => {
    await expect(parseImportFile(await twoSheets(), { sheetName: "Missing" })).rejects.toThrow('unknown sheet "Missing"');
  });

  it("ignores the sheetName option for csv files", async () => {
    const result = await parseImportFile(makeCsvFile("name\nAlice"), { sheetName: "Whatever" });
    expect(result.sheetName).toBeUndefined();
    expect(result.rows).toEqual([
      ["name"],
      ["Alice"],
    ]);
  });
});

describe("parseImportFile — csv edge cases", () => {
  it("treats a null/undefined papaparse cell as an empty string", async () => {
    vi.resetModules();
    vi.doMock("papaparse", () => ({
      default: {
        parse: vi.fn(() => ({
          data: [["Alice", null], ["Bob", undefined]],
          meta: { delimiter: "," },
        })),
      },
    }));

    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const result = await freshParse(makeCsvFile("Alice,\nBob,"));
    expect(result.rows).toEqual([
      ["Alice", ""],
      ["Bob", ""],
    ]);

    vi.doUnmock("papaparse");
    vi.restoreAllMocks();
  });

  it("falls back to a comma when neither an override nor an auto-detected delimiter is available", async () => {
    vi.resetModules();
    vi.doMock("papaparse", () => ({
      default: {
        parse: vi.fn(() => ({ data: [["a"]], meta: {} })),
      },
    }));

    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const result = await freshParse(makeCsvFile("a"));
    expect(result.delimiter).toBe(",");

    vi.doUnmock("papaparse");
    vi.restoreAllMocks();
  });
});

describe("parseImportFile — unsupported types", () => {
  it("throws for a non csv/xlsx/xls file", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(parseImportFile(file)).rejects.toThrow("unsupported-file-type");
  });
});

describe("parseImportFile — size and dimension limits", () => {
  it("rejects a file over maxFileBytes before touching the file contents", async () => {
    const arrayBufferSpy = vi.spyOn(File.prototype, "arrayBuffer");
    const textSpy = vi.spyOn(File.prototype, "text");
    try {
      await expect(parseImportFile(makeCsvFile("a,b\n1,2"), { maxFileBytes: 1 })).rejects.toThrow("file-too-large");
      expect(arrayBufferSpy).not.toHaveBeenCalled();
      expect(textSpy).not.toHaveBeenCalled();
    } finally {
      arrayBufferSpy.mockRestore();
      textSpy.mockRestore();
    }
  });

  it("rejects a csv with more rows than maxRows", async () => {
    await expect(parseImportFile(makeCsvFile("a,b\n1,2\n3,4"), { maxRows: 2 })).rejects.toThrow("import-too-many-cells");
  });

  it("rejects a csv wider than maxColumns", async () => {
    await expect(parseImportFile(makeCsvFile("a,b,c"), { maxColumns: 2 })).rejects.toThrow("import-too-many-cells");
  });

  it("rejects a csv whose rows times its widest row exceed maxCells", async () => {
    const csv = "a,b,c\n1\n2";
    await expect(parseImportFile(makeCsvFile(csv), { maxCells: 8 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(makeCsvFile(csv), { maxCells: 9 })).resolves.toMatchObject({ rows: [["a", "b", "c"], ["1"], ["2"]] });
  });

  it("defaults to 50 MB, 1M rows, 1000 columns, and 5M cells, and small files pass", async () => {
    expect(DEFAULT_IMPORT_LIMITS).toEqual({ maxFileBytes: 50 * 1024 * 1024, maxRows: 1_000_000, maxColumns: 1_000, maxCells: 5_000_000 });
    const result = await parseImportFile(makeCsvFile("a,b\n1,2"));
    expect(result.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseImportFile — xlsx lazy loading", () => {
  it("loads hucre only for an .xlsx file, not for .csv files", async () => {
    const file = await workbookFile({ Sheet1: [["name"], ["Alice"]] }, "data.xlsx");
    vi.resetModules();
    const hucreLoaded = vi.fn();
    for (const id of ["hucre", "hucre/xlsx"]) {
      vi.doMock(id, async (importOriginal) => {
        hucreLoaded(id);
        return importOriginal();
      });
    }

    const { parseImportFile: freshParse } = await import("./parse-import-file");

    await freshParse(makeCsvFile("name\nAlice"));
    expect(hucreLoaded).not.toHaveBeenCalled();

    const result = await freshParse(file);
    expect(hucreLoaded).toHaveBeenCalledWith("hucre");
    expect(hucreLoaded).toHaveBeenCalledWith("hucre/xlsx");
    expect(result.rows).toEqual([["name"], ["Alice"]]);

    vi.doUnmock("hucre");
    vi.doUnmock("hucre/xlsx");
    vi.restoreAllMocks();
  });
});
