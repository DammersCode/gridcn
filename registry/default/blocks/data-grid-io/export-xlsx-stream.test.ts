import { describe, expect, it } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { buildXlsx, exportGrid, type ExportGridOptions, type XlsxWriterMode } from "./export-grid";
import { readXlsx } from "./xlsx-reader";

type Row = { text: string; num: number | null; day: string; flag: boolean };

const cellType = (toText: (value: unknown) => string): CellType<Row, unknown> =>
  ({ Cell: () => null, Editor: () => null, toText, fromText: (t: string) => t, clearValue: () => "", isEmpty: (v: unknown) => v === "" || v === null }) as never;

const columns = [
  { id: "text", header: "Text", accessorKey: "text", type: "text" },
  { id: "num", header: "Num", accessorKey: "num", type: "number" },
  { id: "day", header: "Day", accessorKey: "day", type: "date" },
  { id: "flag", header: "Flag", accessorKey: "flag", type: "checkbox" },
] as ColumnDef<Row, unknown>[];

function makeState(data: Row[]): DataGridStoreState {
  const toText = (value: unknown) => (value === null || value === undefined ? "" : String(value));
  return {
    data,
    visibleColumns: columns as never,
    viewIndex: data.map((_, i) => i),
    cellTypes: { text: cellType(toText), number: cellType(toText), date: cellType(toText), checkbox: cellType(toText) } as never,
    sortState: [],
    filterState: [],
    searchText: "",
  } as unknown as DataGridStoreState;
}

const rows: Row[] = [
  { text: "plain", num: 1.5, day: "2024-02-29", flag: true },
  { text: "x".repeat(40_000), num: -3, day: "1999-12-31", flag: false },
  { text: "=SUM(A1:A9)", num: null, day: "not a date", flag: false },
  { text: "+cmd|' /C calc'!A0", num: 0, day: "2024-13-40", flag: true },
  { text: "שלום עולם مرحبا", num: 1e21, day: "2000-01-01", flag: true },
  { text: "line\nbreak & <tag> \"quote\"", num: 12345678.9, day: "", flag: false },
];

async function sheetOf(mode: XlsxWriterMode, how: "loaded" | "source", data: Row[], extra: Partial<ExportGridOptions<Row>> = {}) {
  let file: Blob | undefined;
  const options: ExportGridOptions<Row> = {
    format: "xlsx",
    xlsxWriter: mode,
    output: (blob) => {
      file = blob;
    },
    ...extra,
  };
  if (how === "source") {
    options.source = async function* () {
      yield data.slice(0, 2);
      yield data.slice(2);
    };
  }
  const result = await exportGrid(makeState(how === "loaded" ? data : []), options);
  const workbook = await readXlsx(new Uint8Array(await file!.arrayBuffer()));
  return { result, sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rows })) };
}

describe("xlsxWriter: stream", () => {
  for (const how of ["loaded", "source"] as const) {
    it(`reads back the same grid as buffered (${how})`, async () => {
      const buffered = await sheetOf("buffered", how, rows);
      const streamed = await sheetOf("stream", how, rows);
      expect(streamed.result).toEqual(buffered.result);
      expect(streamed.sheets).toEqual(buffered.sheets);
      expect(streamed.sheets[0]!.rows).toHaveLength(rows.length + 1);
    });
  }

  it("keeps typed cells, the 32,767 cut, and formula-like text as text", async () => {
    const { sheets } = await sheetOf("stream", "source", rows);
    const body = sheets[0]!.rows;
    expect(body[1]![1]).toBe(1.5);
    expect(body[1]![2]).toBeInstanceOf(Date);
    expect(body[1]![3]).toBe(true);
    expect(String(body[2]![0])).toHaveLength(32_767);
    expect(body[3]![0]).toBe("=SUM(A1:A9)");
    expect(body[5]![0]).toBe("שלום עולם مرحبا");
  });

  it("writes an empty sheet with only the header, and with no header at all", async () => {
    for (const how of ["loaded", "source"] as const) {
      expect((await sheetOf("stream", how, [])).sheets).toEqual((await sheetOf("buffered", how, [])).sheets);
      expect((await sheetOf("stream", how, [], { includeHeaders: false })).sheets).toEqual((await sheetOf("buffered", how, [], { includeHeaders: false })).sheets);
    }
  });

  it("applies the source row cap, the byte cap, and the sheet name like buffered", async () => {
    const capped = await sheetOf("stream", "source", rows, { maxRows: 2, sheetName: "Data" });
    expect(capped.result).toEqual({ rowCount: 2, truncated: true });
    expect(capped.sheets[0]).toMatchObject({ name: "Data" });
    expect(capped.sheets[0]!.rows).toHaveLength(3);
    const bytes = await sheetOf("stream", "source", rows, { maxBytes: 10 });
    expect(bytes.result.truncated).toBe(true);
    expect(bytes).toEqual(await sheetOf("buffered", "source", rows, { maxBytes: 10 }));
  });

  it("rejects an invalid sheet name before any row is written", async () => {
    await expect(sheetOf("stream", "loaded", rows, { sheetName: "a/b" })).rejects.toThrow();
  });

  it("rejects when the signal aborts between slices and delivers nothing", async () => {
    const controller = new AbortController();
    let delivered = false;
    const many = Array.from({ length: 3_000 }, (_, i) => ({ text: `r${i}`, num: i, day: "2024-01-01", flag: false }));
    const run = exportGrid(makeState(many), {
      format: "xlsx",
      xlsxWriter: "stream",
      signal: controller.signal,
      output: () => {
        delivered = true;
      },
      formatCell: ({ text }) => {
        controller.abort(new Error("stop"));
        return text;
      },
    });
    await expect(run).rejects.toThrow("stop");
    expect(delivered).toBe(false);
  });

  it("buildXlsx streams too", async () => {
    const buffered = await readXlsx(new Uint8Array(await (await buildXlsx(makeState(rows))).arrayBuffer()));
    const streamed = await readXlsx(new Uint8Array(await (await buildXlsx(makeState(rows), { xlsxWriter: "stream" })).arrayBuffer()));
    expect(streamed.sheets.map((s) => s.rows)).toEqual(buffered.sheets.map((s) => s.rows));
  });
});
