import { describe, expect, it, vi } from "vitest";
import { DEFAULT_IMPORT_LIMITS, parseImportFile } from "./parse-import-file";

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
  it("returns an empty grid for a workbook with no sheets", async () => {
    vi.resetModules();
    vi.doMock("xlsx", () => ({
      read: vi.fn(() => ({ SheetNames: [], Sheets: {} })),
      utils: { sheet_to_json: vi.fn() },
    }));

    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const xlsxFile = new File([new ArrayBuffer(8)], "empty.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await freshParse(xlsxFile);
    expect(result.rows).toEqual([]);

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("stringifies null/undefined xlsx cells as empty strings", async () => {
    vi.resetModules();
    vi.doMock("xlsx", () => ({
      read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: { A1: { t: "s", v: "Alice" }, A2: { t: "s", v: "Bob" } } } })),
      utils: { sheet_to_json: vi.fn(() => [["Alice", null], ["Bob", undefined]]) },
    }));

    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const xlsxFile = new File([new ArrayBuffer(8)], "data.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await freshParse(xlsxFile);
    expect(result.rows).toEqual([
      ["Alice", ""],
      ["Bob", ""],
    ]);

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });
});

// `sheetNames` exposes every sheet so a caller avoids the first-sheet-only default.
describe("parseImportFile — xlsx sheetNames", () => {
  it("returns every sheet name alongside the first sheet's rows, for a multi-sheet workbook", async () => {
    vi.resetModules();
    vi.doMock("xlsx", () => ({
      read: vi.fn(() => ({
        SheetNames: ["Summary", "Q3 Data"],
        Sheets: { Summary: { A1: { t: "s", v: "summary-row" } }, "Q3 Data": { A1: { t: "s", v: "q3-row" } } },
      })),
      utils: { sheet_to_json: vi.fn(() => [["summary-row"]]) },
    }));

    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const xlsxFile = new File([new ArrayBuffer(8)], "workbook.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await freshParse(xlsxFile);
    expect(result.rows).toEqual([["summary-row"]]);
    expect(result.sheetNames).toEqual(["Summary", "Q3 Data"]);
    expect(result.sheetName).toBe("Summary");

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("returns a single-entry sheetNames for a single-sheet workbook", async () => {
    vi.resetModules();
    vi.doMock("xlsx", () => ({
      read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: { A1: { t: "s", v: "Alice" } } } })),
      utils: { sheet_to_json: vi.fn(() => [["Alice"]]) },
    }));

    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const xlsxFile = new File([new ArrayBuffer(8)], "data.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await freshParse(xlsxFile);
    expect(result.sheetNames).toEqual(["Sheet1"]);

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("csv results carry no sheetNames", async () => {
    const result = await parseImportFile(makeCsvFile("name\nAlice"));
    expect(result.sheetNames).toBeUndefined();
  });
});

// A multi-sheet workbook selects its sheet instead of importing the first.
describe("parseImportFile — xlsx sheet selection", () => {
  function mockWorkbook(sheetNames: string[], rowsBySheet: Record<string, string[][]>): void {
    vi.resetModules();
    const sheets: Record<string, { tag: string; A1: { t: string; v: string } }> = {};
    for (const name of sheetNames) sheets[name] = { tag: name, A1: { t: "s", v: name } };
    vi.doMock("xlsx", () => ({
      read: vi.fn(() => ({ SheetNames: sheetNames, Sheets: sheets })),
      utils: { sheet_to_json: vi.fn((sheet: { tag: string }) => rowsBySheet[sheet.tag]) },
    }));
  }

  function xlsxFile(): File {
    return new File([new ArrayBuffer(8)], "workbook.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  it("reports the first sheet's name as sheetName by default", async () => {
    mockWorkbook(["Summary", "Q3 Data"], { Summary: [["summary-row"]], "Q3 Data": [["q3-row"]] });
    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const result = await freshParse(xlsxFile());
    expect(result.rows).toEqual([["summary-row"]]);
    expect(result.sheetName).toBe("Summary");
    expect(result.sheetNames).toEqual(["Summary", "Q3 Data"]);

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("parses the sheet named by the sheetName option", async () => {
    mockWorkbook(["Summary", "Q3 Data"], { Summary: [["summary-row"]], "Q3 Data": [["q3-row"]] });
    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const result = await freshParse(xlsxFile(), { sheetName: "Q3 Data" });
    expect(result.rows).toEqual([["q3-row"]]);
    expect(result.sheetName).toBe("Q3 Data");
    expect(result.sheetNames).toEqual(["Summary", "Q3 Data"]);

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("rejects when the sheetName option names a sheet the workbook doesn't have", async () => {
    mockWorkbook(["Summary"], { Summary: [["summary-row"]] });
    const { parseImportFile: freshParse } = await import("./parse-import-file");
    await expect(freshParse(xlsxFile(), { sheetName: "Missing" })).rejects.toThrow('unknown sheet "Missing"');

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
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

  it("clamps the SheetJS read with sheetRows and converts only the real cell extent, never a forged !ref", async () => {
    // forged !ref plus two real cells: the range follows the real cells, or sheet_to_json materializes the forged rectangle
    const sheet = { A1: { t: "s", v: "a" }, B3: { t: "n", v: 1 }, "!ref": "A1:ZZ1000000" };
    vi.resetModules();
    const read = vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: sheet } }));
    const sheetToJSON = vi.fn(() => [["a", ""], [], ["", "1"]]);
    vi.doMock("xlsx", () => ({ read, utils: { sheet_to_json: sheetToJSON } }));
    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const file = new File([new ArrayBuffer(8)], "forged.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await freshParse(file, { maxRows: 1000, maxColumns: 50 });
    expect(read).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ sheetRows: 1000 }));
    expect(sheetToJSON).toHaveBeenCalledWith(sheet, expect.objectContaining({ range: "A1:B3" }));

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("caps the conversion range at maxRows/maxColumns when real cells exceed them", async () => {
    const sheet = { A1: { t: "s", v: "a" }, AY5000: { t: "s", v: "b" }, "!ref": "A1:AY5000" };
    vi.resetModules();
    const read = vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: sheet } }));
    const sheetToJSON = vi.fn(() => []);
    vi.doMock("xlsx", () => ({ read, utils: { sheet_to_json: sheetToJSON } }));
    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const file = new File([new ArrayBuffer(8)], "wide.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await freshParse(file, { maxRows: 1000, maxColumns: 50 });
    expect(sheetToJSON).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ range: "A1:AX1000" }));

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("returns an empty grid for a sheet with a forged !ref but no real cells, without converting", async () => {
    vi.resetModules();
    const sheetToJSON = vi.fn(() => {
      throw new Error("sheet_to_json must not run for a cell-less sheet");
    });
    vi.doMock("xlsx", () => ({
      read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: { "!ref": "A1:ZZ1000000" } } })),
      utils: { sheet_to_json: sheetToJSON },
    }));
    const { parseImportFile: freshParse } = await import("./parse-import-file");
    const file = new File([new ArrayBuffer(8)], "empty.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await freshParse(file);
    expect(result.rows).toEqual([]);
    expect(sheetToJSON).not.toHaveBeenCalled();

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });

  it("rejects a csv with more rows than maxRows", async () => {
    await expect(parseImportFile(makeCsvFile("a,b\n1,2\n3,4"), { maxRows: 2 })).rejects.toThrow("import-too-many-cells");
  });

  it("rejects a csv wider than maxColumns", async () => {
    await expect(parseImportFile(makeCsvFile("a,b,c"), { maxColumns: 2 })).rejects.toThrow("import-too-many-cells");
  });

  it("defaults to 50 MB, 1M rows, and 1000 columns, and small files pass", async () => {
    expect(DEFAULT_IMPORT_LIMITS).toEqual({ maxFileBytes: 50 * 1024 * 1024, maxRows: 1_000_000, maxColumns: 1_000 });
    const result = await parseImportFile(makeCsvFile("a,b\n1,2"));
    expect(result.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseImportFile — xlsx lazy loading", () => {
  it("loads xlsx only for an .xlsx file, not for .csv files", async () => {
    vi.resetModules();
    const xlsxModuleSpy = vi.fn();
    vi.doMock("xlsx", () => {
      xlsxModuleSpy();
      return {
        read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: { A1: { t: "s", v: "name" } } } })),
        utils: { sheet_to_json: vi.fn(() => [["name"], ["Alice"]]) },
      };
    });

    const { parseImportFile: freshParse } = await import("./parse-import-file");

    await freshParse(makeCsvFile("name\nAlice"));
    expect(xlsxModuleSpy).not.toHaveBeenCalled();

    const xlsxFile = new File([new ArrayBuffer(8)], "data.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const result = await freshParse(xlsxFile);
    expect(xlsxModuleSpy).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([["name"], ["Alice"]]);

    vi.doUnmock("xlsx");
    vi.restoreAllMocks();
  });
});
