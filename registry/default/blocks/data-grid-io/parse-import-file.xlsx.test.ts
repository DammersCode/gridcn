import * as XLSX from "@e965/xlsx";
import { describe, expect, it } from "vitest";
import { parseImportFile } from "./parse-import-file";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function workbookFile(sheets: Record<string, XLSX.WorkSheet>, name = "book.xlsx"): File {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], name, { type: XLSX_TYPE });
}

/**
 * Appends cell CV1000000 to a one-cell worksheet inside the zip and keeps its `<dimension ref="A1"/>`:
 * two real cells span 100 columns by 1,000,000 rows. Patched in place because the writer walks `!ref`.
 */
async function forgeSparseSheet(file: File, sheetPath: string): Promise<File> {
  const container = XLSX.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const entry = XLSX.CFB.find(container, sheetPath);
  if (!entry?.content) throw new Error(`missing ${sheetPath}`);
  const xml = new TextDecoder().decode(entry.content as Uint8Array);
  const farRow = '<row r="1000000"><c r="CV1000000" t="str"><v>b</v></c></row></sheetData>';
  entry.content = new TextEncoder().encode(xml.replace("</sheetData>", farRow));
  const bytes = XLSX.CFB.write(container, { fileType: "zip", type: "array" }) as Uint8Array;
  return new File([bytes.slice()], file.name, { type: XLSX_TYPE });
}

function oneCellSheet(): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([["a"]]);
}

describe("parseImportFile — real xlsx limits", () => {
  it("rejects a forged sparse workbook before materializing its cells", async () => {
    const file = await forgeSparseSheet(workbookFile({ Sheet1: oneCellSheet() }), "/xl/worksheets/sheet1.xml");
    expect(file.size).toBeLessThan(64 * 1024);

    const started = performance.now();
    await expect(parseImportFile(file)).rejects.toThrow("import-too-many-cells");
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("imports a normal workbook", async () => {
    const file = workbookFile({ People: XLSX.utils.aoa_to_sheet([["name", "age"], ["Alice", 30], ["Bob", 40]]) });

    const result = await parseImportFile(file);

    expect(result.rows).toEqual([
      ["name", "age"],
      ["Alice", "30"],
      ["Bob", "40"],
    ]);
    expect(result.sheetName).toBe("People");
  });

  it("rejects a workbook with more rows than maxRows instead of truncating it", async () => {
    const file = workbookFile({ Sheet1: XLSX.utils.aoa_to_sheet([["h"], ["1"], ["2"], ["3"]]) });

    await expect(parseImportFile(file, { maxRows: 3 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(file, { maxRows: 4 })).resolves.toMatchObject({ rows: [["h"], ["1"], ["2"], ["3"]] });
  });

  it("rejects a workbook wider than maxColumns instead of truncating it", async () => {
    const file = workbookFile({ Sheet1: XLSX.utils.aoa_to_sheet([["a", "b", "c"]]) });

    await expect(parseImportFile(file, { maxColumns: 2 })).rejects.toThrow("import-too-many-cells");
  });

  it("rejects a workbook whose row-by-column extent exceeds maxCells", async () => {
    const file = workbookFile({ Sheet1: XLSX.utils.aoa_to_sheet([["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]) });

    await expect(parseImportFile(file, { maxCells: 8 })).rejects.toThrow("import-too-many-cells");
    await expect(parseImportFile(file, { maxCells: 9 })).resolves.toMatchObject({ rows: [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]] });
  });

  it("parses only the selected sheet and still lists every sheet name", async () => {
    const book = workbookFile({ Small: XLSX.utils.aoa_to_sheet([["x"], ["1"]]), Forged: oneCellSheet() });
    const file = await forgeSparseSheet(book, "/xl/worksheets/sheet2.xml");

    const result = await parseImportFile(file, { sheetName: "Small" });

    expect(result.rows).toEqual([["x"], ["1"]]);
    expect(result.sheetNames).toEqual(["Small", "Forged"]);
    await expect(parseImportFile(file, { sheetName: "Forged" })).rejects.toThrow("import-too-many-cells");
  });
});
