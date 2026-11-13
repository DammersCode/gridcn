import Papa from "papaparse";
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

  it("detects a pipe delimiter", async () => {
    const result = await parseImportFile(makeCsvFile("name|age\nAlice|30\nBob|40"));
    expect(result.delimiter).toBe("|");
    expect(result.rows[0]).toEqual(["name", "age"]);
  });

  it("reads a file with another separator as one comma column", async () => {
    const result = await parseImportFile(makeCsvFile("name~age\nAlice~30\nBob~40"));
    expect(result.delimiter).toBe(",");
    expect(result.rows[0]).toEqual(["name~age"]);
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
        parse: vi.fn((_input: string, config: { step?: (result: { data: unknown[] }, parser: { abort(): void }) => void }) => {
          for (const data of [["Alice", null], ["Bob", undefined]]) config.step?.({ data }, { abort() {} });
          return { data: [], meta: { delimiter: "," } };
        }),
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
        parse: vi.fn((_input: string, config: { step?: (result: { data: unknown[] }, parser: { abort(): void }) => void }) => {
          config.step?.({ data: ["a"] }, { abort() {} });
          return { data: [], meta: {} };
        }),
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

  it("defaults to 50 MB, 1M rows, 1000 columns, 5M cells, and 256 MiB per inflated xlsx part, and small files pass", async () => {
    expect(DEFAULT_IMPORT_LIMITS).toEqual({
      maxFileBytes: 50 * 1024 * 1024,
      maxRows: 1_000_000,
      maxColumns: 1_000,
      maxCells: 5_000_000,
      maxDecompressedBytes: 256 * 1024 * 1024,
    });
    const result = await parseImportFile(makeCsvFile("a,b\n1,2"));
    expect(result.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

// papaparse builds a whole row before any callback runs, so a line of millions of delimiters must be rejected before it parses
describe("parseImportFile — csv limits", () => {
  // the delimiter guess reads a bounded preview; a full parse is any call without `preview`
  function fullParses(parse: { mock: { calls: unknown[][] } }, text: string): number {
    return parse.mock.calls.filter(([input, config]) => input === text && (config as { preview?: number } | undefined)?.preview === undefined).length;
  }

  it("rejects a single line of 5,000,000 delimiters without parsing it", async () => {
    const text = ",".repeat(5_000_001);
    const parse = vi.spyOn(Papa, "parse");
    try {
      await expect(parseImportFile(makeCsvFile(text))).rejects.toThrow("import-too-many-cells");
      await expect(parseImportFile(makeCsvFile(text), { csvDelimiter: "," })).rejects.toThrow("import-too-many-cells");
      expect(fullParses(parse, text)).toBe(0);
      for (const [input] of parse.mock.calls) expect(String(input).length).toBeLessThanOrEqual(1024 * 1024);
    } finally {
      parse.mockRestore();
    }
  });

  it("rejects a row of more delimiters than maxCells without parsing it", async () => {
    const text = `a${",".repeat(2_000)}\nb,c`;
    const parse = vi.spyOn(Papa, "parse");
    try {
      await expect(parseImportFile(makeCsvFile(text), { maxCells: 1_000 })).rejects.toThrow("import-too-many-cells");
      expect(fullParses(parse, text)).toBe(0);
    } finally {
      parse.mockRestore();
    }
  });

  it("stops the parser at the first breach of maxRows, maxColumns, or maxCells", async () => {
    const rows = "a,b\n".repeat(10_000);
    type Config = { step?: (...args: unknown[]) => void };
    const original = Papa.parse.bind(Papa) as unknown as (input: string, config: Config) => unknown;
    let steps = 0;
    const parse = vi.spyOn(Papa, "parse").mockImplementation(((input: string, config: Config) =>
      original(input, config.step ? { ...config, step: (...args: unknown[]) => (steps++, config.step!(...args)) } : config)) as never);
    try {
      for (const limit of [{ maxRows: 9 }, { maxColumns: 1 }, { maxCells: 19 }]) {
        steps = 0;
        await expect(parseImportFile(makeCsvFile(rows), limit)).rejects.toThrow("import-too-many-cells");
        expect(steps).toBeLessThanOrEqual(11);
      }
    } finally {
      parse.mockRestore();
    }
  });

  it("counts a quoted field with delimiters and line breaks as one cell", async () => {
    const quoted = `${",".repeat(5_000)}\n${";".repeat(10)}`;
    const result = await parseImportFile(makeCsvFile(`"${quoted}",b\nc,d`), { maxColumns: 2, maxRows: 2 });
    expect(result.rows).toEqual([
      [quoted, "b"],
      ["c", "d"],
    ]);
  });

  it("splits rows on a CR-only newline the same way the limits count them", async () => {
    const result = await parseImportFile(makeCsvFile("a,b\rc,d\re,f"), { maxRows: 3, maxColumns: 2 });
    expect(result.rows).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
    await expect(parseImportFile(makeCsvFile("a,b\rc,d\re,f"), { maxRows: 2 })).rejects.toThrow("import-too-many-cells");
  });

  it("counts CRLF rows once and an escaped quote as part of its field", async () => {
    const result = await parseImportFile(makeCsvFile('a,"say ""hi"", ok"\r\nc,d\r\n'), { maxRows: 2, maxColumns: 2 });
    expect(result.rows).toEqual([
      ["a", 'say "hi", ok'],
      ["c", "d"],
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

describe("parseImportFile — csv limits agree with papaparse", () => {
  const fixtures: Record<string, string> = {
    "quoted newline": 'a,"b\nc",d\ne,f,g',
    "escaped quotes": 'a,"say ""hi"", ok",c\nd,e,f',
    "quote inside an unquoted field": 'a,b"c,d\ne,f"g,h',
    "quote after the opening quote": 'a,""",x\ny,z',
    "unterminated quote": 'a,"b,c\nd,e,f',
    "empty lines": "a,b\n\n\nc,d\n\n",
    "trailing delimiters": "a,b,,,\nc,d,,,",
    "lone quoted empty field": '"",""\n"",""',
    "wide and narrow rows": "a\nb,c,d,e,f\ng,h",
  };

  it.each(Object.entries(fixtures))("%s: row and field counts match", async (_name, text) => {
    const parsed = Papa.parse<string[]>(text, { delimiter: ",", newline: "\n", skipEmptyLines: true });
    const rows = parsed.data.length;
    const columns = Math.max(...parsed.data.map((row) => row.length));
    const file = () => makeCsvFile(text);
    await expect(parseImportFile(file(), { csvDelimiter: ",", maxRows: rows, maxColumns: columns })).resolves.toBeDefined();
    await expect(parseImportFile(file(), { csvDelimiter: ",", maxRows: rows - 1 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(file(), { csvDelimiter: ",", maxColumns: columns - 1 })).rejects.toThrow("import-too-many-cells");
  });
});

describe("parseImportFile — csv limits follow papaparse's own counts", () => {
  it("accepts a file at papaparse's column count when a quote closes before text", async () => {
    const text = 'a,"b"c,d\ne,f,g';
    const parsed = Papa.parse<string[]>(text, { delimiter: ",", newline: "\n", skipEmptyLines: true });
    const columns = Math.max(...parsed.data.map((row) => row.length));
    expect(columns).toBeLessThan(3);
    await expect(parseImportFile(makeCsvFile(text), { csvDelimiter: ",", maxColumns: columns })).resolves.toBeDefined();
  });
});
