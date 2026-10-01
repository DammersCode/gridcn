import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseImportFile } from "./parse-import-file";
import { inlineCell, partText, withEntries, workbookFile, worksheetXml, xlsxWithSheetAt, xlsxWithWorksheet } from "./xlsx-fixtures.test-helper";

const XLS_TYPE = "application/vnd.ms-excel";

function xlsBytes(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(resolve(__dirname, "../../../../tests/fixtures/xls", name)));
}

function xlsFixture(name: string): File {
  return new File([xlsBytes(name)], name, { type: XLS_TYPE });
}

function textFile(content: string, name: string): File {
  return new File([content], name, { type: XLS_TYPE });
}

async function expectFastRejection(parse: Promise<unknown>, message: string, budgetMs: number): Promise<void> {
  const started = performance.now();
  await expect(parse).rejects.toThrow(message);
  expect(performance.now() - started).toBeLessThan(budgetMs);
}

describe("parseImportFile — hostile xlsx", () => {
  it("rejects a zip bomb whose worksheet inflates past the default decompression cap", async () => {
    const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 257 * 1024 * 1024);
    expect(file.size).toBeLessThan(1024 * 1024);

    await expectFastRejection(parseImportFile(file), "file-too-large", 3_000);
  }, 20_000);

  it("rejects a zip bomb whose worksheet claims a small size and inflates past it", async () => {
    const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 100 * 1024 * 1024, 1024 * 1024);

    await expectFastRejection(parseImportFile(file), "file-too-large", 3_000);
  }, 20_000);

  it("rejects the 311 KB zip bomb that inflates to 300 MB under a lower maxDecompressedBytes", async () => {
    const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 300 * 1024 * 1024);
    expect(file.size).toBeLessThan(400 * 1024);

    await expectFastRejection(parseImportFile(file, { maxDecompressedBytes: 64 * 1024 * 1024 }), "file-too-large", 2_000);
  }, 20_000);

  it("applies maxDecompressedBytes to parts that lie about their size", async () => {
    const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 8 * 1024 * 1024, 1024);

    await expect(parseImportFile(file, { maxDecompressedBytes: 4 * 1024 * 1024 })).rejects.toThrow("file-too-large");
    await expect(parseImportFile(await workbookFile({ Sheet1: [["a"]] }), { maxDecompressedBytes: 4 * 1024 * 1024 })).resolves.toMatchObject({ rows: [["a"]] });
  });

  it("rejects a worksheet whose declared size could hold more cells than maxCells, before parsing it", async () => {
    const sheet = worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`);
    const padded = await xlsxWithWorksheet(sheet, 8 * 1024 * 1024);
    const lying = await xlsxWithWorksheet(sheet, 1, 8 * 1024 * 1024);

    await expectFastRejection(parseImportFile(padded, { maxCells: 100_000 }), "import-too-many-cells", 1_000);
    await expectFastRejection(parseImportFile(lying, { maxCells: 100_000 }), "import-too-many-cells", 1_000);
  });

  it("sizes the worksheet bound at 21 bytes per allowed cell, the smallest real cell, plus 1 MiB for the rest of the sheet", async () => {
    const sheet = worksheetXml('<row r="1"><c r="A1"><v>1</v></c></row>');
    const pad = (maxCells: number) => 21 * maxCells + 1024 * 1024 - new TextEncoder().encode(sheet).length;

    await expect(parseImportFile(await xlsxWithWorksheet(sheet, pad(1_000)), { maxCells: 1_000 })).resolves.toMatchObject({ rows: [["1"]] });
    await expect(parseImportFile(await xlsxWithWorksheet(sheet, pad(1_000) + 1), { maxCells: 1_000 })).rejects.toThrow("import-too-many-cells");
  });

  it.each(["data/huge.xml", "/xl/data/huge.xml", "../xl/data/huge.xml", "./data/huge.xml"])(
    "bounds the worksheet part its relationship targets (%s), wherever it sits",
    async (target) => {
      const file = await xlsxWithSheetAt(target, 8 * 1024 * 1024);

      await expectFastRejection(parseImportFile(file, { maxCells: 100_000 }), "import-too-many-cells", 1_000);
    },
  );

  it.each(["data/sheet.xml", "/xl/worksheets/sheet1.xml", "../xl/data/sheet.xml"])("imports a worksheet whose relationship targets %s", async (target) => {
    await expect(parseImportFile(await xlsxWithSheetAt(target, 0))).resolves.toMatchObject({ rows: [["a"]] });
  });

  it("bounds the selected sheet's part, not another sheet's", async () => {
    const book = await workbookFile({ Small: [["x"]], Other: [["y"]] });
    const huge = await withEntries(book, { "xl/worksheets/sheet2.xml": worksheetXml(`<row r="1">${inlineCell("A1", "y")}</row>`) }, { "xl/worksheets/sheet2.xml": 8 * 1024 * 1024 });

    await expect(parseImportFile(huge, { maxCells: 100_000 })).resolves.toMatchObject({ rows: [["x"]] });
    await expect(parseImportFile(huge, { maxCells: 100_000, sheetName: "Other" })).rejects.toThrow("import-too-many-cells");
  });

  it("rejects a workbook whose selected sheet targets a part missing from the zip", async () => {
    const base = await workbookFile({ Sheet1: [["a"]] });
    const rels = (await partText(base, "xl/_rels/workbook.xml.rels")).replace("worksheets/sheet1.xml", "data/missing.xml");

    await expect(parseImportFile(await withEntries(base, { "xl/_rels/workbook.xml.rels": rels }))).rejects.toThrow("unsupported-excel-format");
  });

  it("rejects a workbook whose relationships part declares more than 16 MiB", async () => {
    const base = await workbookFile({ Sheet1: [["a"]] });
    const rels = await partText(base, "xl/_rels/workbook.xml.rels");
    const file = await withEntries(base, { "xl/_rels/workbook.xml.rels": rels }, { "xl/_rels/workbook.xml.rels": 17 * 1024 * 1024 });

    await expect(parseImportFile(file)).rejects.toThrow("file-too-large");
  });

  it("does not hold large parts other than worksheets to the cell bound", async () => {
    const base = await workbookFile({ Sheet1: [["a"]] });
    const file = await withEntries(base, { "xl/media/image1.bin": new Uint8Array(8 * 1024 * 1024) });

    await expect(parseImportFile(file, { maxCells: 100_000 })).resolves.toMatchObject({ rows: [["a"]] });
  });

  it("rejects a ZIP64 directory, which can declare parts past any cap", async () => {
    const bytes = new Uint8Array(await (await workbookFile({ Sheet1: [["a"]] })).arrayBuffer());
    new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, 0xffffffff, true);

    await expect(parseImportFile(new File([bytes], "zip64.xlsx"))).rejects.toThrow("file-too-large");
  });

  it("leaves a broken central directory to the reader's own error", async () => {
    const bytes = new Uint8Array(await (await workbookFile({ Sheet1: [["a"]] })).arrayBuffer());
    new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, 0, true);

    await expect(parseImportFile(new File([bytes], "broken.xlsx"))).rejects.not.toThrow(/file-too-large|import-too-many-cells|unsupported-excel-format/);
  });

  it("rejects a forged A1 + XFD1048576 box before building the grid", async () => {
    const sheet = worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row><row r="1048576">${inlineCell("XFD1048576", "b")}</row>`);
    const file = await xlsxWithWorksheet(sheet);

    await expectFastRejection(parseImportFile(file), "import-too-many-cells", 2_000);
  }, 5_000);

  it("rejects a sparse two-cell sheet (A1 + CV1000000) before building the grid", async () => {
    const sheet = worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row><row r="1000000">${inlineCell("CV1000000", "b")}</row>`);
    const file = await xlsxWithWorksheet(sheet);
    expect(file.size).toBeLessThan(64 * 1024);

    await expectFastRejection(parseImportFile(file), "import-too-many-cells", 2_000);
  }, 5_000);

  // a dense reader pads every row out to its farthest cell before any box check: 20,000 rows x 16,384 slots
  it("rejects a sheet of far-right cells without padding every row out to column XFD", async () => {
    let rows = "";
    for (let r = 1; r <= 20_000; r++) rows += `<row r="${r}">${inlineCell(`XFD${r}`, "x")}</row>`;
    const file = await xlsxWithWorksheet(worksheetXml(rows));
    expect(file.size).toBeLessThan(256 * 1024);

    await expectFastRejection(parseImportFile(file), "import-too-many-cells", 1_500);
  }, 5_000);

  it("rejects a sheet whose rows continue after empty row elements instead of truncating it", async () => {
    const filled = [1, 2, 3].map((r) => `<row r="${r}">${inlineCell(`A${r}`, String(r))}</row>`).join("");
    const file = await xlsxWithWorksheet(worksheetXml(`${filled}<row r="4"/><row r="5"/><row r="6">${inlineCell("A6", "6")}</row>`));

    await expect(parseImportFile(file, { maxRows: 4 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(file, { maxRows: 6 })).resolves.toMatchObject({ rows: [["1"], ["2"], ["3"], [""], [""], ["6"]] });
  });

  it("sizes the grid from the real cells, not a forged dimension or styled empty cells", async () => {
    const sheet = worksheetXml(`<row r="1">${inlineCell("A1", "a")}<c r="ZZ1" s="0"/></row><row r="3">${inlineCell("B3", "b")}</row>`).replace(
      "<sheetData>",
      '<dimension ref="A1:ZZ1000000"/><sheetData>',
    );
    const file = await xlsxWithWorksheet(sheet);

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([
      ["a", ""],
      ["", ""],
      ["", "b"],
    ]);
  });

  it("returns an empty grid for a sheet with a forged dimension but no cells", async () => {
    const file = await xlsxWithWorksheet(worksheetXml("").replace("<sheetData>", '<dimension ref="A1:ZZ1000000"/><sheetData>'));

    await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [] });
  });
});

describe("parseImportFile — xlsx limits", () => {
  it("imports a normal workbook", async () => {
    const file = await workbookFile({ People: [["name", "age"], ["Alice", 30], ["Bob", 40]] });

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
      ["Bob", "40"],
    ]);
    expect(result.sheetName).toBe("People");
    expect(result.sheetNames).toEqual(["People"]);
  });

  it("rejects a workbook with more rows than maxRows instead of truncating it", async () => {
    const file = await workbookFile({ Sheet1: [["h"], ["1"], ["2"], ["3"]] });

    await expect(parseImportFile(file, { maxRows: 3 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(file, { maxRows: 4 })).resolves.toMatchObject({ rows: [["h"], ["1"], ["2"], ["3"]] });
  });

  it("rejects a workbook wider than maxColumns instead of truncating it", async () => {
    const file = await workbookFile({ Sheet1: [["a", "b", "c"]] });

    await expect(parseImportFile(file, { maxColumns: 2 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(file, { maxColumns: 3 })).resolves.toMatchObject({ rows: [["a", "b", "c"]] });
  });

  it("rejects a workbook whose row-by-column extent exceeds maxCells", async () => {
    const file = await workbookFile({ Sheet1: [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]] });

    await expect(parseImportFile(file, { maxCells: 8 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(file, { maxCells: 9 })).resolves.toMatchObject({ rows: [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]] });
  });

  it("parses only the selected sheet and still lists every sheet name", async () => {
    const book = await workbookFile({ Small: [["x"], ["1"]], Forged: [["a"]] });
    const forged = worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row><row r="1048576">${inlineCell("XFD1048576", "b")}</row>`);
    const file = await withEntries(book, { "xl/worksheets/sheet2.xml": forged });

    const result = await parseImportFile(file, { sheetName: "Small" });

    expect(result.rows).toEqual([["x"], ["1"]]);
    expect(result.sheetNames).toEqual(["Small", "Forged"]);
    await expect(parseImportFile(file, { sheetName: "Forged" })).rejects.toThrow("import-too-many-cells");
  });
});

describe("parseImportFile — xlsx formatted text", () => {
  it("renders each cell through its number format", async () => {
    const file = await workbookFile({
      Sheet1: [
        [
          { value: new Date(Date.UTC(2024, 0, 15)), style: { numFmt: "yyyy-mm-dd" } },
          { value: new Date(Date.UTC(2024, 0, 15, 12, 30)), style: { numFmt: "yyyy-mm-dd hh:mm" } },
          { value: 1234.5, style: { numFmt: '"$"#,##0.00' } },
          { value: 0.125, style: { numFmt: "0.0%" } },
          { value: 12345.678, style: { numFmt: "0.00E+00" } },
        ],
      ],
    });

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([["2024-01-15", "2024-01-15 12:30", "$1,234.50", "12.5%", "1.23E+04"]]);
  });

  it("renders Excel's built-in format ids (short date, percent, scientific, thousands)", async () => {
    const styles =
      '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="9" applyNumberFormat="1"/>' +
      '<xf numFmtId="11" applyNumberFormat="1"/><xf numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>';
    const sheet = worksheetXml(
      '<row r="1"><c r="A1" s="1"><v>45306</v></c><c r="B1" s="2"><v>0.125</v></c><c r="C1" s="3"><v>12345.678</v></c><c r="D1" s="4"><v>1234.5</v></c></row>',
    );
    const file = await withEntries(await xlsxWithWorksheet(sheet), { "xl/styles.xml": styles });

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([["1/15/2024", "13%", "1.23E+04", "1,234.50"]]);
  });

  it("falls back to the raw value for a number format over 255 characters, without running it", async () => {
    const file = await workbookFile({ Sheet1: [[{ value: 1234.5, style: { numFmt: "0".repeat(100_000) } }]] });
    const started = performance.now();

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([["1234.5"]]);
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("still applies a number format of exactly 255 characters", async () => {
    const numFmt = `"${"x".repeat(252)}"0`;
    const file = await workbookFile({ Sheet1: [[{ value: 7, style: { numFmt } }]] });

    expect(numFmt).toHaveLength(255);
    await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [[`${"x".repeat(252)}7`]] });
  });

  it("falls back to the raw value for a fraction format whose denominator search would stall the tab", async () => {
    const file = await workbookFile({ Sheet1: [[{ value: 0.3141592653, style: { numFmt: `# ?/${"?".repeat(16)}` } }]] });
    const started = performance.now();

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([["0.3141592653"]]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("still renders a fraction format with a three-digit denominator", async () => {
    const file = await workbookFile({ Sheet1: [[{ value: 0.3141592653, style: { numFmt: "# ???/???" } }]] });

    await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [[" 71/226"]] });
  });

  it("falls back to the raw value when hucre throws on a format", async () => {
    const file = await workbookFile({ Sheet1: [[{ value: 1234.5, style: { numFmt: `0.${"0".repeat(120)}` } }]] });

    await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [["1234.5"]] });
  });

  it("renders General cells like Excel: 15 significant digits, TRUE/FALSE, error codes, strings as-is", async () => {
    const sheet = worksheetXml(
      '<row r="1"><c r="A1"><v>0.30000000000000004</v></c><c r="B1"><v>123456789012345</v></c><c r="C1"><v>-0.5</v></c>' +
        '<c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c><c r="F1" t="e"><v>#DIV/0!</v></c>' +
        `${inlineCell("G1", "=1+1")}${inlineCell("H1", "00123")}</row>`,
    );
    const file = await xlsxWithWorksheet(sheet);

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([["0.3", "123456789012345", "-0.5", "TRUE", "FALSE", "#DIV/0!", "=1+1", "00123"]]);
  });
});

describe("parseImportFile — legacy xls", () => {
  it("reads a BIFF8 workbook: every sheet name, raw values as text, dates as ISO dates", async () => {
    const result = await parseImportFile(xlsFixture("biff8.xls"));

    expect(result.sheetNames).toEqual(["People", "Other"]);
    expect(result.sheetName).toBe("People");
    expect(result.rows).toEqual([
      ["name", "age", "joined", "active", "share"],
      ["Alice", "30", "2024-01-15", "TRUE", "0.125"],
      ["Bob", "40.5", "2023-12-31", "FALSE", "0.3"],
    ]);
    await expect(parseImportFile(xlsFixture("biff8.xls"), { sheetName: "Other" })).resolves.toMatchObject({ rows: [["x"], ["1"]] });
    await expect(parseImportFile(xlsFixture("biff8.xls"), { sheetName: "Missing" })).rejects.toThrow('unknown sheet "Missing"');
  });

  it("rejects a BIFF8 workbook over the row, column, or cell limit", async () => {
    await expect(parseImportFile(xlsFixture("biff8.xls"), { maxRows: 2 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(xlsFixture("biff8.xls"), { maxColumns: 4 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(xlsFixture("biff8.xls"), { maxCells: 10 })).rejects.toThrow("import-too-many-cells");
  });

  it("bounds every sheet, so an oversized sheet rejects the workbook even when another sheet is selected", async () => {
    await expect(parseImportFile(xlsFixture("biff8.xls"), { sheetName: "Other" })).resolves.toMatchObject({ rows: [["x"], ["1"]] });
    await expect(parseImportFile(xlsFixture("biff8.xls"), { sheetName: "Other", maxCells: 10 })).rejects.toThrow("import-too-many-cells");
  });

  it("rejects an HTML table saved with an .xls extension", async () => {
    const file = textFile("<html><body><table><tr><td>a</td><td>b</td></tr></table></body></html>", "export.xls");

    await expect(parseImportFile(file)).rejects.toThrow("unsupported-excel-format");
  });

  it("rejects an Excel 2003 XML (SpreadsheetML) file saved with an .xls extension", async () => {
    const xml =
      '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Worksheet ss:Name="S"><Table><Row><Cell><Data ss:Type="String">a</Data></Cell></Row></Table></Worksheet></Workbook>';

    await expect(parseImportFile(textFile(xml, "export.xls"))).rejects.toThrow("unsupported-excel-format");
  });

  it("rejects a BIFF5 (Excel 5.0/95) workbook", async () => {
    await expect(parseImportFile(xlsFixture("biff5.xls"))).rejects.toThrow("unsupported-excel-format");
  });
});

// hucre has no error codes: parseImportFile maps these classes and texts, so an upgrade that changes them fails here
describe("hucre errors that parseImportFile maps", () => {
  it("keeps the class and text of its decompression-cap, cell-box, and xls-version errors", async () => {
    const { ParseError, ZipError } = await import("hucre");
    const { readXls, readXlsx } = await import("hucre/xlsx");
    const bomb = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 2 * 1024 * 1024);

    const bombError = await readXlsx(new Uint8Array(await bomb.arrayBuffer()), { maxDecompressedBytes: 1024 * 1024 }).catch((error: unknown) => error);
    const boxError = await readXls(xlsBytes("biff8.xls"), { maxTotalCells: 10 }).catch((error: unknown) => error);
    const versionError = await readXls(xlsBytes("biff5.xls")).catch((error: unknown) => error);

    expect(bombError).toBeInstanceOf(ZipError);
    expect(bombError).toHaveProperty("message", expect.stringContaining("Decompressed size exceeds limit"));
    expect(boxError).toBeInstanceOf(ParseError);
    expect(boxError).toHaveProperty("message", expect.stringMatching(/over the 10 limit/));
    expect(versionError).toBeInstanceOf(ParseError);
    expect(versionError).toHaveProperty("message", expect.stringMatching(/^Unsupported XLS version/));
  });
});
