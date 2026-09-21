import { describe, expect, it, vi } from "vitest";
import { parseImportFile } from "./parse-import-file";

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
      read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
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
        Sheets: { Summary: {}, "Q3 Data": {} },
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
      read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
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
    const sheets: Record<string, { tag: string }> = {};
    for (const name of sheetNames) sheets[name] = { tag: name };
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

describe("parseImportFile — xlsx lazy loading", () => {
  it("loads xlsx only for an .xlsx file, not for .csv files", async () => {
    vi.resetModules();
    const xlsxModuleSpy = vi.fn();
    vi.doMock("xlsx", () => {
      xlsxModuleSpy();
      return {
        read: vi.fn(() => ({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } })),
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
