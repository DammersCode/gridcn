import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { heldYears, nestedPivotStore, pivotSlot, twoLevelLayout, type NestedPivotRow } from "@/registry/default/blocks/data-grid/test/nested-pivot.test-helper";
import { buildCsv, buildExportHeaders, buildExportRows, buildXlsx, exportGrid } from "./export-grid";
import type { ExportSourceContext } from "./export-source";
import { printGrid } from "./print-grid";
import { listZip } from "./xlsx-fixtures.test-helper";

const csvLines = async (blob: Blob) => (await blob.text()).replace(/^﻿/, "").split("\r\n");
const xlsxXml = async (blob: Blob) => listZip(new Uint8Array(await blob.arrayBuffer())).map((entry) => new TextDecoder().decode(entry.data)).join(" ");
const state = () => nestedPivotStore(twoLevelLayout()).getState();

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll("iframe").forEach((iframe) => iframe.remove());
});

describe("export of a nested pivot", () => {
  it("writes the generated columns and every landed pivot row at every depth in view order, never a source column", async () => {
    expect(await csvLines(buildCsv(state()))).toEqual(["Region,2023,2024,2025", "EU,10,20,30.5", "DE,1,2,3", "FR,4,,6", "'=1+1,7,8,9", "__proto__,-7,0,"]);
  });

  it("keeps the pivot cells numbers and the labels strings in XLSX, and writes no formula", async () => {
    const xml = await xlsxXml(await buildXlsx(state()));
    expect(xml).not.toMatch(/<f[ >]/);
    expect(xml).toMatch(/<c r="D2"[^>]*><v>30.5<\/v><\/c>/);
    expect(xml).toMatch(/<c r="B6"[^>]*><v>-7<\/v><\/c>/);
    const cell = (ref: string) => new RegExp(`<c r="${ref}"[^>]*?(/>|>.*?</c>)`).exec(xml)?.[0].replace(ref, "");
    expect(cell("C4")).toMatch(/^<c/);
    expect(cell("D6")).toBe(cell("C4"));
    expect(xml).not.toContain("Infinity");
    expect(xml).toContain("__proto__");
    expect(xml).not.toContain("Secret");
  });

  it("cuts no long label below the key bound and keeps the export limits", async () => {
    const long = "x".repeat(1_024);
    const layout = { rows: [pivotSlot(0, ["EU"], 1, [1, 2, 3]), pivotSlot(1, ["EU", long], 0, [1, 2, 3]), pivotSlot(2, ["US"], 0, [4, 5, 6])], leafCount: 4, pivot: heldYears() };
    const s = nestedPivotStore(layout).getState();
    expect((await csvLines(buildCsv(s)))[2]).toBe(`${long},1,2,3`);
    expect(await csvLines(buildCsv(s, { maxRows: 2, includeHeaders: false }))).toEqual(["EU,1,2,3", `${long},1,2,3`]);
  });

  it("prints the shown text of every landed pivot row", () => {
    expect(buildExportHeaders(state())).toEqual(["Region", "2023", "2024", "2025"]);
    expect(buildExportRows(state(), "view", { text: "display" })).toEqual([
      ["EU", "10", "20", "30.5"],
      ["DE", "1", "2", "3"],
      ["FR", "4", "", "6"],
      ["=1+1", "7", "8", "9"],
      ["__proto__", "-7", "0", ""],
    ]);
  });
});

describe("export with a source under pivot", () => {
  const sourceRow: NestedPivotRow = { id: "r1", region: "=1+1", country: "DE", city: "Berlin", year: 2024, amount: 5, secret: "s" };

  it("exports the source rows in the source columns and does not read the pivot view", async () => {
    let file: Blob | undefined;
    const source = vi.fn((_ctx: ExportSourceContext) => [sourceRow]);
    await exportGrid(state(), { source, csvBom: false, output: (blob) => void (file = blob) });
    expect(source.mock.calls[0]![0].columnIds).toEqual(["region", "country", "city", "year", "amount"]);
    expect((source.mock.calls[0]![0].spec as ServerSpec & { pivot?: unknown }).pivot).toBeUndefined();
    expect(await csvLines(file!)).toEqual(["Region,Country,City,Year,Amount", "'=1+1,DE,Berlin,2024,5"]);
  });

  it("rejects a generated column id in `columns` before the source runs", async () => {
    const source = vi.fn(() => [sourceRow]);
    const generated = state().visibleColumns[1]!.id;
    await expect(exportGrid(state(), { source, columns: ["region", generated], output: () => {} })).rejects.toThrow(new RangeError(`[data-grid-io] unknown export column: ${generated}`));
    expect(source).not.toHaveBeenCalled();
  });

  it("prints the source rows in the source columns", async () => {
    const append = document.body.append.bind(document.body);
    vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
      append(...nodes);
      for (const node of nodes) if (node instanceof HTMLIFrameElement && node.contentWindow) node.contentWindow.print = () => {};
    });
    await printGrid(state(), { source: () => [sourceRow] });
    const doc = document.querySelector("iframe")!.contentDocument!;
    expect([...doc.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Region", "Country", "City", "Year", "Amount"]);
    expect([...doc.querySelectorAll("tbody td")].map((td) => td.textContent)).toEqual(["=1+1", "DE", "Berlin", "2024", "5"]);
  });
});
