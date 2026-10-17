import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseImportFile } from "./parse-import-file";
import { forgedBoundSheetOffsets, forgedXlsFile, inlineCell, withEntries, workbookFile, worksheetXml, xlsxWithWorksheet } from "./xlsx-fixtures.test-helper";

const XLS_TYPE = "application/vnd.ms-excel";
const MIB = 1024 * 1024;

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

    await expectFastRejection(parseImportFile(file), "part-too-large", 3_000);
  }, 20_000);

  it("rejects a zip bomb whose worksheet claims a small size and inflates past it", async () => {
    const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 100 * 1024 * 1024, 1024 * 1024);

    await expectFastRejection(parseImportFile(file), "part-too-large", 3_000);
  }, 20_000);

  it("rejects the 311 KB zip bomb that inflates to 300 MB under a lower maxDecompressedBytes", async () => {
    const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 300 * 1024 * 1024);
    expect(file.size).toBeLessThan(400 * 1024);

    await expectFastRejection(parseImportFile(file, { maxDecompressedBytes: 64 * 1024 * 1024 }), "part-too-large", 2_000);
  }, 20_000);

  it("applies maxDecompressedBytes to parts that lie about their size", async () => {
    const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`), 8 * 1024 * 1024, 1024);

    await expect(parseImportFile(file, { maxDecompressedBytes: 4 * 1024 * 1024 })).rejects.toThrow("part-too-large");
    await expect(parseImportFile(await workbookFile({ Sheet1: [["a"]] }), { maxDecompressedBytes: 4 * 1024 * 1024 })).resolves.toMatchObject({ rows: [["a"]] });
  });

  describe("per-entry cap of maxCells * 10 bytes + 1 MiB", () => {
    const SMALL = { maxCells: 100_000 };
    const sheet = worksheetXml(`<row r="1">${inlineCell("A1", "a")}</row>`);
    const sheetPath = "xl/worksheets/sheet1.xml";

    it("rejects a worksheet padded past the cap", async () => {
      await expectFastRejection(parseImportFile(await xlsxWithWorksheet(sheet, 8 * MIB), SMALL), "part-too-large", 1_000);
    });

    it("rejects a worksheet that declares a small size and inflates past the cap", async () => {
      await expectFastRejection(parseImportFile(await xlsxWithWorksheet(sheet, 8 * MIB, 1024), SMALL), "part-too-large", 1_000);
    });

    it("rejects a worksheet whose central directory declares size 0", async () => {
      const file = await withEntries(await xlsxWithWorksheet(sheet, 8 * MIB), {}, { [sheetPath]: 0 }, { centralOnly: [sheetPath] });

      await expectFastRejection(parseImportFile(file, SMALL), "part-too-large", 1_000);
    });

    it("rejects a worksheet that keeps its sizes in a data descriptor", async () => {
      const file = await withEntries(await xlsxWithWorksheet(sheet, 8 * MIB), {}, { [sheetPath]: 0 }, { descriptor: [sheetPath] });

      await expectFastRejection(parseImportFile(file, SMALL), "part-too-large", 1_000);
    });

    it("rejects a stored worksheet that under-declares its size", async () => {
      const file = await withEntries(await xlsxWithWorksheet(sheet, 8 * MIB), {}, { [sheetPath]: 1024 }, { stored: [sheetPath] });

      await expectFastRejection(parseImportFile(file, SMALL), "part-too-large", 1_000);
    });

    it("rejects a worksheet no relationship points at, so a decoy relationship cannot hide it", async () => {
      const base = await workbookFile({ Sheet1: [["a"]] });
      const file = await withEntries(base, { "xl/data/huge.xml": new Uint8Array(8 * MIB).fill(0x20) });

      await expectFastRejection(parseImportFile(file, SMALL), "part-too-large", 1_000);
    });

    it("rejects an oversized worksheet in a workbook whose workbook part is UTF-16", async () => {
      const utf16 = new Uint8Array([0xff, 0xfe, ...new Uint8Array(new Uint16Array([...'<workbook><sheets><sheet name="a" r:id="rId1"/></sheets></workbook>'].map((char) => char.charCodeAt(0))).buffer)]);
      const file = await withEntries(await xlsxWithWorksheet(sheet, 8 * MIB), { "xl/workbook.xml": utf16 });

      await expectFastRejection(parseImportFile(file, SMALL), "part-too-large", 1_000);
    });

    it("rejects 300,000 styled empty cells, 10 bytes each, before building 300,000 map entries", async () => {
      const cells = '<c s="0"/>'.repeat(300_000);
      const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${cells}</row>`));

      await expectFastRejection(parseImportFile(file, SMALL), "part-too-large", 1_000);
    });

    it("rejects 300,000 minimal 15-byte cells", async () => {
      const cells = "<c><v>1</v></c>".repeat(300_000);
      const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${cells}</row>`));

      await expectFastRejection(parseImportFile(file, SMALL), "part-too-large", 1_000);
    });

    it("rejects a 220 KB file of 10 million styled empty cells at the default limits, without building them", async () => {
      const cells = '<c s="0"/>'.repeat(10_000_000);
      const file = await xlsxWithWorksheet(worksheetXml(`<row r="1">${cells}</row>`));
      expect(file.size).toBeLessThan(400 * 1024);

      await expectFastRejection(parseImportFile(file), "part-too-large", 500);
    }, 60_000);

    it("imports a worksheet under the cap, spaces and all", async () => {
      await expect(parseImportFile(await xlsxWithWorksheet(sheet, MIB), SMALL)).resolves.toMatchObject({ rows: [["a"]] });
    });

    it("lets maxDecompressedBytes lower the cap below the cell bound", async () => {
      await expect(parseImportFile(await xlsxWithWorksheet(sheet, 2 * MIB), { maxDecompressedBytes: MIB })).rejects.toThrow("part-too-large");
    });
  });

  it("rejects a zip with an entry size of the ZIP64 sentinel", async () => {
    const bytes = new Uint8Array(await (await workbookFile({ Sheet1: [["a"]] })).arrayBuffer());
    const view = new DataView(bytes.buffer);
    let end = bytes.length - 22;
    while (view.getUint32(end, true) !== 0x06054b50) end--;
    view.setUint32(view.getUint32(end + 16, true) + 24, 0xffffffff, true);

    await expect(parseImportFile(new File([bytes], "zip64-size.xlsx"))).rejects.toThrow("part-too-large");
  });

  it("rejects a zip whose end-of-central-directory record is missing", async () => {
    const bytes = new Uint8Array(await (await workbookFile({ Sheet1: [["a"]] })).arrayBuffer());
    bytes.fill(0, bytes.length - 22);

    await expect(parseImportFile(new File([bytes], "no-eocd.xlsx"))).rejects.toThrow("unreadable-zip");
  });

  it("rejects a ZIP64 directory, which can declare parts past any cap", async () => {
    const bytes = new Uint8Array(await (await workbookFile({ Sheet1: [["a"]] })).arrayBuffer());
    new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, 0xffffffff, true);

    await expect(parseImportFile(new File([bytes], "zip64.xlsx"))).rejects.toThrow("part-too-large");
  });

  it("rejects a broken central directory as unreadable", async () => {
    const bytes = new Uint8Array(await (await workbookFile({ Sheet1: [["a"]] })).arrayBuffer());
    new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, 0, true);

    await expect(parseImportFile(new File([bytes], "broken.xlsx"))).rejects.toThrow("unreadable-zip");
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

  it.each([
    "# ?/[Red]?????????",
    "# ?[Red]/?????????",
    "# ?/_x?????????",
    "# ?_x/?????????",
    "# ?/*x?????????",
    "[>5]# ?/?????????",
    "# ?[$-409]/?????????",
    "# ?/[Color 3]?????????",
  ])("falls back to the raw value for the fraction format %s once hucre strips its decoration", async (numFmt) => {
    const file = await workbookFile({ Sheet1: [[{ value: 0.3141592653, style: { numFmt } }]] });
    const started = performance.now();

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([["0.3141592653"]]);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it.each(['# ?"x"/?????????', "# ?\\/?????????", '# ??/?"x"????????', "# ?/\\??????????"])("formats %s, which hucre does not read as a fraction, within 250 ms", async (numFmt) => {
    const file = await workbookFile({ Sheet1: [[{ value: 0.3141592653, style: { numFmt } }]] });
    const started = performance.now();

    await parseImportFile(file);

    expect(performance.now() - started).toBeLessThan(250);
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

  it("rejects a forged workbook whose sheets each fit the cell limit but together exceed it, before hucre pads them", async () => {
    const file = forgedXlsFile({ sheets: 4, cell: { row: 19_000, col: 255 } });

    await expectFastRejection(parseImportFile(file), "import-too-many-cells", 1_000);
  });

  it("rejects a forged workbook with a single cell at the far corner of the BIFF8 grid", async () => {
    await expectFastRejection(parseImportFile(forgedXlsFile({ sheets: 1, cell: { row: 65_535, col: 255 } })), "import-too-many-cells", 1_000);
  });

  it("reads a forged workbook with one cell inside the limits", async () => {
    const result = await parseImportFile(forgedXlsFile({ sheets: 2, cell: { row: 2, col: 1 } }));

    expect(result.sheetNames).toEqual(["S0", "S1"]);
    expect(result.rows).toEqual([
      ["", ""],
      ["", ""],
      ["", "1"],
    ]);
  });

  it("rejects an OLE2 file with no readable workbook stream", async () => {
    const bytes = new Uint8Array(2048);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

    await expect(parseImportFile(new File([bytes], "broken.xls"))).rejects.toThrow();
  });

  it("counts every cell of a MULRK run toward the cell limit", async () => {
    const file = () => forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mulrkCount: 3 });

    await expect(parseImportFile(file())).resolves.toMatchObject({ rows: [["0", "0", "0"]] });
    await expect(parseImportFile(file(), { maxCells: 2 })).rejects.toThrow("import-too-many-cells");
  });

  it("reads a worksheet whose substream has no EOF record", async () => {
    const result = await parseImportFile(forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, unterminatedWorksheet: true }));

    expect(result.rows).toEqual([["1"]]);
  });

  it("reads a sheet that points into the globals as an empty sheet", async () => {
    const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, sheetOffsets: forgedBoundSheetOffsets(["S0"]) });

    await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [] });
  });

  describe("the pre-scan reads the workbook as hucre does", () => {
    const hostile = { sheets: 4, cell: { row: 19_000, col: 255 } };

    it("treats a globals BOF without a version as BIFF8", async () => {
      await expectFastRejection(parseImportFile(forgedXlsFile({ ...hostile, globalsBofLength: 0 })), "import-too-many-cells", 500);
    });

    it("counts the cells after a sheet start that is not a BOF", async () => {
      await expectFastRejection(parseImportFile(forgedXlsFile({ ...hostile, junkBeforeWorksheet: true })), "import-too-many-cells", 500);
    });

    it("rejects two Workbook streams, whichever one hucre would read", async () => {
      await expectFastRejection(parseImportFile(forgedXlsFile({ ...hostile, decoyWorkbook: true })), "unreadable-xls", 500);
    });

    it("reads a mini-stream workbook", async () => {
      await expect(parseImportFile(forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mini: true }))).resolves.toMatchObject({ rows: [["1"]] });
    });

    it("reads a mini-stream workbook whose header cutoff is 0, which means 4096", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mini: true, forgery: { miniCutoff: 0 } });

      await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [["1"]] });
    });

    it("rejects a mini sector size other than 64 bytes", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mini: true, forgery: { miniShift: 7 } });

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects a Workbook size past the mini stream before it allocates that size", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mini: true, forgery: { miniCutoff: 0xffffffff, workbookSize: 0xfffffffe } });

      await expectFastRejection(parseImportFile(file), "unreadable-xls", 500);
    });

    it("rejects another stream whose sector chain loops", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, forgery: { cycleStream: "Loop", miniCutoff: 1 } });

      await expectFastRejection(parseImportFile(file), "unreadable-xls", 500);
    });

    it("ignores header FAT entries past the declared FAT sector count", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, forgery: { headerFatSectors: [0x7fff] } });

      await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [["1"]] });
    });

    it("rejects a FAT sector listed twice", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, forgery: { numFatSectors: 2, headerFatSectors: [0] } });

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects a workbook with more records than its cell limit can need, before hucre builds one object per record", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, junkRecords: 120_000 });

      await expectFastRejection(parseImportFile(file, { maxCells: 10 }), "import-too-many-cells", 500);
      await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [["1"]] });
    });

    it("reads a workbook whose FAT sectors are listed in a DIFAT sector", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, forgery: { difat: true } });

      await expect(parseImportFile(file)).resolves.toMatchObject({ rows: [["1"]] });
    });

    it("rejects streams that declare more bytes than the file holds", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, forgery: { rawEntries: [{ name: "Big", type: 2, start: 0xfffffffe, size: 100_000 }] } });

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects a mini-stream workbook whose chain ends early", async () => {
      const bytes = new Uint8Array(await forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mini: true }).arrayBuffer());
      new DataView(bytes.buffer).setUint32(3 * 512, 0xfffffffe, true);

      await expect(parseImportFile(new File([bytes], "short-chain.xls"))).rejects.toThrow("unreadable-xls");
    });

    it("rejects a container without a root entry", async () => {
      const bytes = new Uint8Array(await forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 } }).arrayBuffer());
      bytes[1024 + 66] = 0;

      await expect(parseImportFile(new File([bytes], "no-root.xls"))).rejects.toThrow("unreadable-xls");
    });

    it("reads a MULRK record with no cells as an empty sheet", async () => {
      const empty = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mulrkCount: 0 });
      const truncated = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mulrkCount: 0, mulrkExtraBytes: -1 });

      await expect(parseImportFile(empty)).resolves.toMatchObject({ rows: [] });
      await expect(parseImportFile(truncated)).resolves.toMatchObject({ rows: [] });
    });

    it("rejects a MULRK record whose length is not a whole number of cells", async () => {
      const file = forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 }, mulrkCount: 3, mulrkExtraBytes: 2 });

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("reads a workbook of five numeric sheets, each in its own substream", async () => {
      const sheetCells = Array.from({ length: 5 }, (_, i) => ({ row: i, col: 0 }));

      const result = await parseImportFile(forgedXlsFile({ sheets: 5, cell: { row: 0, col: 0 }, sheetCells }));

      expect(result.sheetNames).toHaveLength(5);
      expect(result.rows).toEqual([["1"]]);
    });

    it("rejects 300 sheets that start at different records of one stream, so scanning them cannot go quadratic", async () => {
      const names = Array.from({ length: 300 }, (_, i) => `S${i}`);
      const file = forgedXlsFile({ sheets: 300, cell: { row: 0, col: 0 }, sheetOffsets: forgedBoundSheetOffsets(names) });

      await expectFastRejection(parseImportFile(file), "unreadable-xls", 500);
    });
  });

  describe("a damaged OLE2 container", () => {
    it("rejects a container shorter than its header", async () => {
      const file = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])], "tiny.xls");

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    async function damaged(patch: (view: DataView, bytes: Uint8Array) => void): Promise<File> {
      const bytes = new Uint8Array(await forgedXlsFile({ sheets: 1, cell: { row: 0, col: 0 } }).arrayBuffer());
      patch(new DataView(bytes.buffer), bytes);
      return new File([bytes], "damaged.xls");
    }

    it("rejects a container without a Workbook stream", async () => {
      const file = await damaged((view) => view.setUint16(1024 + 128, 0x58, true));

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects a Workbook stream that starts outside the file", async () => {
      const file = await damaged((view) => view.setUint32(1024 + 128 + 116, 0x7fff, true));

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects an unsupported sector size", async () => {
      const file = await damaged((view) => view.setUint16(30, 7, true));

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects a DIFAT chain that leaves the file", async () => {
      const file = await damaged((view) => {
        view.setUint32(68, 0x7fff, true);
        view.setUint32(72, 1, true);
      });

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects a FAT sector outside the file", async () => {
      const file = await damaged((view) => view.setUint32(76, 0x7fff, true));

      await expect(parseImportFile(file)).rejects.toThrow("unreadable-xls");
    });

    it("rejects a mini stream the file does not hold", async () => {
      const bytes = xlsBytes("biff8.xls");
      const view = new DataView(bytes.buffer);
      view.setUint32((view.getUint32(48, true) + 1) * 512 + 120, 0, true);

      await expect(parseImportFile(new File([bytes], "no-mini.xls"))).rejects.toThrow("unreadable-xls");
    });
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
