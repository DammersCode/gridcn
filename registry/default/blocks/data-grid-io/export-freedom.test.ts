import { afterEach, describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { buildCsv, buildXlsx, exportGrid, exportRows, MAX_CELL_TEXT, type ExportCellValue, type ExportOutput } from "./export-grid";
import { listZip } from "./xlsx-fixtures.test-helper";

type Row = { id: string; name: string; age: number; secret: string };

const textCellType: CellType<Row, unknown> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => (value === null || value === undefined ? "" : String(value)),
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

const allColumns: ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "text" },
  { id: "secret", header: "Secret", accessorKey: "secret", type: "text" },
];

const rows: Row[] = [
  { id: "a", name: "Ann", age: 31, secret: "s1" },
  { id: "b", name: "Bob", age: 42, secret: "s2" },
  { id: "c", name: "Cy", age: 5, secret: "s3" },
];

function makeState(held: Row[] = rows): DataGridStoreState {
  return {
    data: held,
    columns: allColumns,
    visibleColumns: allColumns.slice(0, 2),
    viewIndex: held.map((_, i) => i),
    cellTypes: { text: textCellType as never },
    sortState: [],
    filterState: [],
    searchText: "",
  } as unknown as DataGridStoreState;
}

const BOMLESS = { csvBom: false } as const;
const lines = (csv: string) => csv.split("\r\n");

function stubDownload(): { urls: Blob[]; clicked: () => number } {
  const urls: Blob[] = [];
  vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => (urls.push(b), "blob:x"), revokeObjectURL: vi.fn() });
  const anchor = document.createElement("a");
  const click = vi.fn();
  anchor.click = click;
  vi.spyOn(document, "createElement").mockReturnValue(anchor);
  return { urls, clicked: () => click.mock.calls.length };
}

function captureOutput() {
  const calls: { file: Blob; ctx: Parameters<ExportOutput>[1] }[] = [];
  const output: ExportOutput = (file, ctx) => {
    calls.push({ file, ctx });
  };
  return { output, calls };
}

async function workbookEntries(blob: Blob): Promise<Map<string, string>> {
  const entries = listZip(new Uint8Array(await blob.arrayBuffer()));
  return new Map(entries.map((entry) => [entry.name, new TextDecoder().decode(entry.data)]));
}

async function sheetXml(blob: Blob): Promise<string> {
  return (await workbookEntries(blob)).get("xl/worksheets/sheet1.xml")!;
}

async function allText(blob: Blob): Promise<string> {
  return [...(await workbookEntries(blob)).values()].join(" ");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("output", () => {
  it("receives the CSV file and never downloads", async () => {
    const download = stubDownload();
    const { output, calls } = captureOutput();
    const result = await exportGrid(makeState(), { output, fileName: "people", ...BOMLESS });
    expect(result).toEqual({ rowCount: 3, truncated: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ctx.fileName).toBe("people.csv");
    expect(calls[0]!.ctx.format).toBe("csv");
    expect(await calls[0]!.file.text()).toBe(["Name,Age", "Ann,31", "Bob,42", "Cy,5"].join("\r\n"));
    expect(download.urls).toHaveLength(0);
    expect(download.clicked()).toBe(0);
  });

  it("receives the XLSX file with the extension in fileName", async () => {
    const download = stubDownload();
    const { output, calls } = captureOutput();
    await exportGrid(makeState(), { output, format: "xlsx" });
    expect(calls[0]!.ctx).toMatchObject({ fileName: "export.xlsx", format: "xlsx" });
    expect(calls[0]!.file.size).toBeGreaterThan(100);
    expect(download.urls).toHaveLength(0);
  });

  it("receives a source export in both formats", async () => {
    const download = stubDownload();
    const { output, calls } = captureOutput();
    const source = () => [rows[0]!];
    await exportGrid(makeState([]), { output, source, ...BOMLESS });
    await exportGrid(makeState([]), { output, source, format: "xlsx" });
    expect(calls.map((call) => call.ctx.fileName)).toEqual(["export.csv", "export.xlsx"]);
    expect(await calls[0]!.file.text()).toBe("Name,Age\r\nAnn,31");
    expect(download.urls).toHaveLength(0);
  });

  it("rejects before output runs when the signal is aborted", async () => {
    const { output, calls } = captureOutput();
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(exportGrid(makeState(), { output, signal: controller.signal })).rejects.toThrow("stop");
    await expect(exportGrid(makeState(), { output, signal: controller.signal, format: "xlsx" })).rejects.toThrow("stop");
    expect(calls).toHaveLength(0);
  });

  it("gives output a signal that follows the caller's signal", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    await exportGrid(makeState(), {
      output: (_file, ctx) => {
        received = ctx.signal;
      },
      signal: controller.signal,
    });
    expect(received!.aborted).toBe(false);
    controller.abort();
    expect(received!.aborted).toBe(true);
  });

  it("gives output a live signal when the caller passes none", async () => {
    let received: AbortSignal | undefined;
    await exportGrid(makeState(), {
      output: (_file, ctx) => {
        received = ctx.signal;
      },
    });
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received!.aborted).toBe(false);
  });

  it("rejects the export when output throws or rejects", async () => {
    await expect(
      exportGrid(makeState(), {
        output: () => {
          throw new Error("sync fail");
        },
      }),
    ).rejects.toThrow("sync fail");
    await expect(exportGrid(makeState(), { output: () => Promise.reject(new Error("async fail")), format: "xlsx" })).rejects.toThrow("async fail");
  });

  it("awaits an async output before it resolves", async () => {
    let done = false;
    await exportGrid(makeState(), {
      output: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        done = true;
      },
    });
    expect(done).toBe(true);
  });
});

describe("columns", () => {
  it("selects hidden columns in the given order and the header follows", async () => {
    const { output, calls } = captureOutput();
    await exportGrid(makeState(), { output, columns: ["secret", "name"], ...BOMLESS });
    expect(lines(await calls[0]!.file.text())).toEqual(["Secret,Name", "s1,Ann", "s2,Bob", "s3,Cy"]);
  });

  it("applies to buildCsv, buildXlsx and a source export", async () => {
    expect(lines(await buildCsv(makeState(), { columns: ["age"], ...BOMLESS }).text())).toEqual(["Age", "31", "42", "5"]);
    const xml = await allText(await buildXlsx(makeState(), { columns: ["secret"] }));
    expect(xml).toContain("s1");
    expect(xml).not.toContain("Ann");
    const { output, calls } = captureOutput();
    await exportGrid(makeState([]), { output, source: () => [rows[1]!], columns: ["secret", "age"], ...BOMLESS });
    expect(await calls[0]!.file.text()).toBe("Secret,Age\r\ns2,42");
  });

  it("throws a RangeError for an unknown id before any fetch", async () => {
    const source = vi.fn(() => [rows[0]!]);
    await expect(exportGrid(makeState(), { source, columns: ["name", "nope"] })).rejects.toBeInstanceOf(RangeError);
    await expect(exportGrid(makeState(), { source, columns: ["nope"], format: "xlsx" })).rejects.toBeInstanceOf(RangeError);
    expect(source).not.toHaveBeenCalled();
    expect(() => buildCsv(makeState(), { columns: ["nope"] })).toThrow(RangeError);
    await expect(buildXlsx(makeState(), { columns: ["nope"] })).rejects.toBeInstanceOf(RangeError);
  });

  it("tells the source the resolved column ids", async () => {
    const source = vi.fn((_ctx: { columnIds: readonly string[] }) => [rows[0]!]);
    await exportGrid(makeState(), { source, ...BOMLESS, output: () => {} });
    expect(source.mock.calls[0]![0].columnIds).toEqual(["name", "age"]);
    await exportGrid(makeState(), { source, columns: ["secret", "name"], ...BOMLESS, output: () => {} });
    expect(source.mock.calls[1]![0].columnIds).toEqual(["secret", "name"]);
  });
});

describe("formatCell", () => {
  it("receives value, text, row and column for loaded rows and source rows", async () => {
    const seen: { value: unknown; text: string; row: Row; id: string }[] = [];
    const formatCell = ({ value, text, row, column }: { value: unknown; text: string; row: Row; column: { id: string } }) => {
      seen.push({ value, text, row, id: column.id });
      return text.toUpperCase();
    };
    expect(await buildCsv(makeState(), { formatCell, ...BOMLESS }).text()).toBe("Name,Age\r\nANN,31\r\nBOB,42\r\nCY,5");
    expect(seen[0]).toEqual({ value: "Ann", text: "Ann", row: rows[0], id: "name" });
    expect(seen[1]).toEqual({ value: 31, text: "31", row: rows[0], id: "age" });
    const { output, calls } = captureOutput();
    await exportGrid(makeState([]), { output, source: () => [rows[2]!], formatCell, ...BOMLESS });
    expect(await calls[0]!.file.text()).toBe("Name,Age\r\nCY,5");
  });

  it("writes CSV values: numbers, booleans, Dates, empties", async () => {
    const values: ExportCellValue[] = [1.5, true, new Date(Date.UTC(2024, 0, 2, 3, 4, 5)), null, undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(Number.NaN), "text"];
    let call = 0;
    const csv = await buildCsv(makeState([rows[0]!]), { columns: ["name"], includeHeaders: false, formatCell: () => values[call++], ...BOMLESS }).text();
    expect(csv).toBe("1.5");
    const out: string[] = [];
    call = 0;
    for (let i = 0; i < values.length; i++) {
      call = i;
      out.push(await buildCsv(makeState([rows[0]!]), { columns: ["name"], includeHeaders: false, formatCell: () => values[i], ...BOMLESS }).text());
    }
    expect(out).toEqual(["1.5", "true", "2024-01-02T03:04:05.000Z", "", "", "", "", "", "text"]);
  });

  it("still neutralizes a formula string in CSV", async () => {
    const csv = await buildCsv(makeState([rows[0]!]), { columns: ["name"], includeHeaders: false, formatCell: () => "=1+1", ...BOMLESS }).text();
    expect(csv).toBe("'=1+1");
  });

  it("writes typed XLSX cells: a number column is numeric and a string with = is not a formula", async () => {
    const blob = await buildXlsx(makeState(), {
      columns: ["age", "name"],
      formatCell: ({ column, value }) => (column.id === "age" ? (value as number) : "=SUM(A1)"),
    });
    const xml = await sheetXml(blob);
    expect(xml).not.toContain("<f>");
    expect(xml).not.toContain("<f ");
    const cells = [...xml.matchAll(/<c r="A([2-4])"([^>]*)>(.*?)<\/c>/g)];
    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell[2]).not.toMatch(/t="(s|inlineStr|str)"/);
      expect(cell[3]).toMatch(/^<v>\d+<\/v>$/);
    }
    expect(await allText(blob)).toContain("=SUM(A1)");
  });

  it("writes booleans and Dates typed in XLSX and empties for bad numbers and dates", async () => {
    const values: ExportCellValue[] = [true, new Date(Date.UTC(2024, 0, 2)), Number.NaN, new Date(Number.NaN), null];
    let i = 0;
    const xml = await sheetXml(await buildXlsx(makeState([rows[0]!]), { columns: ["name", "age", "secret", "name", "age"], includeHeaders: false, formatCell: () => values[i++] }));
    expect(xml).toContain('t="b"');
    expect(xml).toMatch(/<c r="B1" s="\d+"><v>45293<\/v><\/c>/);
    expect(xml).not.toContain("NaN");
    expect(xml).not.toContain("Invalid");
  });

  it("cuts a 100k-character string at the cell limit in CSV and XLSX", async () => {
    const huge = "x".repeat(100_000);
    const csv = await buildCsv(makeState([rows[0]!]), { columns: ["name"], includeHeaders: false, formatCell: () => huge, ...BOMLESS }).text();
    expect(csv).toHaveLength(MAX_CELL_TEXT);
    const text = await allText(await buildXlsx(makeState([rows[0]!]), { columns: ["name"], includeHeaders: false, formatCell: () => huge }));
    expect(text).toContain("x".repeat(MAX_CELL_TEXT));
    expect(text).not.toContain("x".repeat(MAX_CELL_TEXT + 1));
    const { output, calls } = captureOutput();
    await exportGrid(makeState([]), { output, source: () => [rows[0]!], columns: ["name"], includeHeaders: false, formatCell: () => huge, ...BOMLESS });
    expect((await calls[0]!.file.text()).length).toBe(MAX_CELL_TEXT);
  });

  it("rejects when formatCell throws and delivers nothing", async () => {
    const download = stubDownload();
    const { output, calls } = captureOutput();
    const formatCell = () => {
      throw new Error("bad format");
    };
    await expect(exportGrid(makeState(), { output, formatCell })).rejects.toThrow("bad format");
    await expect(exportGrid(makeState(), { output, formatCell, format: "xlsx" })).rejects.toThrow("bad format");
    await expect(exportGrid(makeState([]), { output, formatCell, source: () => rows })).rejects.toThrow("bad format");
    await expect(exportGrid(makeState([]), { formatCell, source: () => rows, format: "xlsx" })).rejects.toThrow("bad format");
    expect(calls).toHaveLength(0);
    expect(download.clicked()).toBe(0);
  });
});

describe("limits count the formatted output", () => {
  const many = Array.from({ length: 3000 }, (_, i): Row => ({ id: `r${i}`, name: `n${i}`, age: i, secret: "" }));

  it("maxRows still stops a loaded and a source export", async () => {
    const formatCell = () => "v";
    expect(lines(await buildCsv(makeState(many), { formatCell, maxRows: 3, ...BOMLESS }).text())).toHaveLength(4);
    const { output, calls } = captureOutput();
    const result = await exportGrid(makeState([]), { output, source: () => many, formatCell, maxRows: 3, ...BOMLESS });
    expect(result).toEqual({ rowCount: 3, truncated: true });
    expect(lines(await calls[0]!.file.text())).toHaveLength(4);
  });

  it("maxBytes counts formatCell output in CSV and XLSX", async () => {
    const formatCell = () => "y".repeat(100);
    const { output } = captureOutput();
    const csv = await exportGrid(makeState([]), { output, source: () => many, formatCell, maxBytes: 50_000, ...BOMLESS });
    expect(csv.truncated).toBe(true);
    expect(csv.rowCount).toBeLessThan(3000);
    const sliced = await exportGrid(makeState([]), { output, source: () => many, formatCell, maxBytes: 50_000, format: "xlsx" });
    expect(sliced.truncated).toBe(true);
    const numeric = await exportGrid(makeState([]), { output, source: () => many, formatCell: () => 123456789, maxBytes: 100, format: "xlsx" });
    expect(numeric.truncated).toBe(true);
  });
});

describe("exportRows", () => {
  it("hands mapped rows to onBatch and reports the result", async () => {
    const batches: string[][][] = [];
    const result = await exportRows(makeState(), { source: () => rows, maxRows: 2, maxBytes: 1000, columns: ["age"] }, (batch: string[][]) => (batches.push(batch), 1));
    expect(batches).toEqual([[["31"], ["42"]]]);
    expect(result).toEqual({ rowCount: 2, truncated: true });
  });
});
