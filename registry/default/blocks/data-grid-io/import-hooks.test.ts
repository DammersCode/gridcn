import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { buildImportedRows, MAX_REJECTED_MESSAGE_LENGTH, type ProcessCellFromText } from "./build-imported-rows";
import {
  assertImportRows,
  IMPORT_CSV_ENCODINGS,
  IMPORT_TOO_MANY_CELLS_MESSAGE,
  INVALID_IMPORT_ROWS_MESSAGE,
  parseImportFile,
  type ParsedImportFile,
} from "./parse-import-file";
import { useDataGridImportPreview, type ImportTargetColumn, type UseDataGridImportPreviewOptions } from "./use-data-grid-import";

type Row = { id: string; name: string; age: number | null };

const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

const columns = [
  { id: "name", header: "Name", accessorKey: "name", type: "text" },
  { id: "age", header: "Age", accessorKey: "age", type: "text", validate: (value: unknown) => (typeof value === "string" && /^\d*$/.test(value) ? null : "digits only") },
] as unknown as ColumnDef<Row, unknown>[];

const cellTypes = { text: textCellType } as never;
const targets: ImportTargetColumn[] = [{ id: "name", header: "Name" }, { id: "age", header: "Age" }];
const mapping = [
  { importColumnIndex: 0, gridColumnId: "name" },
  { importColumnIndex: 1, gridColumnId: "age" },
];

function csvFile(bytes: BlobPart, name = "people.csv"): File {
  return new File([bytes], name, { type: "text/csv" });
}

describe("csvEncoding", () => {
  it("decodes a windows-1252 file that UTF-8 would garble", async () => {
    const bytes = new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]);
    expect((await parseImportFile(csvFile(bytes), { csvEncoding: "windows-1252" })).rows).toEqual([["Name"], ["Müller"]]);
    expect((await parseImportFile(csvFile(bytes))).rows[1]![0]).toContain("�");
  });

  it("decodes utf-16le", async () => {
    const text = "a,b\n1,2";
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) bytes[i * 2] = text.charCodeAt(i);
    expect((await parseImportFile(csvFile(bytes), { csvEncoding: "UTF-16LE" })).rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("rejects every label outside the allow-list, whatever TextDecoder would take", async () => {
    for (const label of ["utf-7", "x-user-defined", "replacement", "../etc", "", "iso-2022-jp"]) {
      await expect(parseImportFile(csvFile("a"), { csvEncoding: label as never })).rejects.toThrow(RangeError);
    }
    expect(IMPORT_CSV_ENCODINGS).toContain("utf-8");
  });
});

describe("assertImportRows — the bound that runs after a hook", () => {
  it("accepts string rows inside the limits", () => {
    expect(() => assertImportRows([["a", "b"], ["c"]], { maxRows: 2, maxColumns: 2, maxCells: 4 })).not.toThrow();
  });

  it("rejects anything that is not an array of arrays of strings", () => {
    for (const bad of [null, "rows", { length: 2 }, [1], [["a", 1]], [[null]], [["a"], "b"]]) {
      expect(() => assertImportRows(bad, {})).toThrow(INVALID_IMPORT_ROWS_MESSAGE);
    }
  });

  it("rejects a rectangle over any limit, for random shapes", () => {
    const limits = { maxRows: 20, maxColumns: 8, maxCells: 100 };
    let seed = 7;
    const next = (max: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % max);
    for (let i = 0; i < 200; i++) {
      const rowCount = next(40);
      const colCount = next(16);
      const rows = Array.from({ length: rowCount }, () => Array.from({ length: colCount }, () => "x"));
      const over = rowCount > limits.maxRows || colCount > limits.maxColumns || rowCount * colCount > limits.maxCells;
      if (over) expect(() => assertImportRows(rows, limits)).toThrow(IMPORT_TOO_MANY_CELLS_MESSAGE);
      else expect(() => assertImportRows(rows, limits)).not.toThrow();
    }
  });
});

describe("processCellFromText and the rejected message", () => {
  const base = { columns, cellTypes, mapping, createRow: (index: number): Row => ({ id: `r${index}`, name: "", age: null }) };

  it("replaces fromText, awaits a promise, and still validates the value", async () => {
    const processCellFromText: ProcessCellFromText<Row> = async (text, ctx) => {
      expect(ctx.source).toBe("import");
      expect(ctx.row.id).toMatch(/^r\d$/);
      return ctx.column.id === "name" ? text.toUpperCase() : text;
    };
    const result = await buildImportedRows<Row>({ ...base, dataRows: [["ann", "30"], ["bob", "x1"]], processCellFromText });
    expect(result.rows.map((r) => r.name)).toEqual(["ANN", "BOB"]);
    expect(result.rows[0]!.age).toBe("30");
    expect(result.rows[1]!.age).toBe("");
    expect(result.rejected).toEqual([{ rowIndex: 1, importColumnIndex: 1, gridColumnId: "age", message: "digits only" }]);
  });

  it("cannot sneak a bad value past validate", async () => {
    const result = await buildImportedRows<Row>({ ...base, dataRows: [["a", "12"]], processCellFromText: () => "not digits" });
    expect(result.rejected).toHaveLength(2 - 1);
    expect(result.rows[0]!.age).toBe("");
  });

  it("rejects the cell when the hook rejects, and stops on an aborted signal", async () => {
    const result = await buildImportedRows<Row>({ ...base, dataRows: [["a", "1"]], processCellFromText: () => Promise.reject(new Error("boom")) });
    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    const controller = new AbortController();
    controller.abort();
    await expect(buildImportedRows<Row>({ ...base, dataRows: [["a", "1"]], processCellFromText: () => "1", signal: controller.signal })).rejects.toThrow("import-cancelled");
  });

  it("cuts a long validator message", async () => {
    const long = { ...columns[1]!, validate: () => "e".repeat(5000) } as unknown as ColumnDef<Row, unknown>;
    const result = await buildImportedRows<Row>({ ...base, columns: [columns[0]!, long], dataRows: [["a", "1"]], processCellFromText: (text) => text });
    expect(result.rejected[0]!.message).toHaveLength(MAX_REJECTED_MESSAGE_LENGTH);
  });
});

describe("useDataGridImportPreview — parseFile, header row index, build", () => {
  const options = (extra: Partial<UseDataGridImportPreviewOptions> = {}): UseDataGridImportPreviewOptions => ({ columnFallback: (i) => `Column ${i}`, ...extra });
  const FILE = csvFile("unused");

  it("uses parseFile for the load and checks its rows against the limits afterwards", async () => {
    const parseFile = vi.fn(async (): Promise<ParsedImportFile> => ({ rows: [["Name", "Age"], ["a", "1"]] }));
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile })));
    await act(async () => result.current.loadFile(FILE, targets));
    expect(parseFile).toHaveBeenCalledTimes(1);
    expect((parseFile.mock.calls as unknown as [File, unknown][])[0]![1]).toMatchObject({ limits: { maxRows: 1_000_000 } });
    expect(result.current.preview?.rows).toHaveLength(2);

    const tooBig = renderHook(() => useDataGridImportPreview(options({ limits: { maxRows: 1 }, parseFile: async () => ({ rows: [["a"], ["b"]] }) })));
    await act(async () => tooBig.result.current.loadFile(FILE, targets));
    expect(tooBig.result.current.error).toBe("errorTooManyCells");
    expect(tooBig.result.current.preview).toBeNull();
  });

  it("rejects a file over maxFileBytes before parseFile sees it", async () => {
    const parseFile = vi.fn(async (): Promise<ParsedImportFile> => ({ rows: [["a"]] }));
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile, limits: { maxFileBytes: 4 } })));
    await act(async () => result.current.loadFile(csvFile("more than four bytes"), targets));
    expect(parseFile).not.toHaveBeenCalled();
    expect(result.current.error).toBe("errorFileTooLarge");
  });

  it("keeps only bounded fields of a custom parse result", async () => {
    const parseFile = async (): Promise<ParsedImportFile> =>
      ({ rows: [["Name"], ["a"]], delimiter: "x", sheetNames: [...Array.from({ length: 1000 }, (_, i) => `S${i}`), 7], sheetName: "x".repeat(1000) }) as never;
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile })));
    await act(async () => result.current.loadFile(FILE, targets));
    expect(result.current.preview?.delimiter).toBeUndefined();
    expect(result.current.preview?.sheetNames).toHaveLength(256);
    expect(result.current.preview?.sheetName).toHaveLength(255);
  });

  it("build() rejects when the signal aborts during an async processImportRows", async () => {
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile: async () => ({ rows: [["Name", "Age"], ["a", "1"]] }) })));
    await act(async () => result.current.loadFile(FILE, targets));
    const controller = new AbortController();
    const pending = result.current.build<Row>({
      columns,
      cellTypes,
      createRow: (index) => ({ id: `r${index}`, name: "", age: null }),
      signal: controller.signal,
      processImportRows: async ({ rows }) => {
        controller.abort();
        return rows;
      },
    });
    await expect(pending).rejects.toThrow("import-cancelled");
  });

  it("shows a parse error when parseFile returns something that is not rows", async () => {
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile: (async () => ({ rows: [[1]] })) as never })));
    await act(async () => result.current.loadFile(FILE, targets));
    expect(result.current.error).toBe("errorParseFailed");
  });

  it("drops the rows above a numeric defaultHeaderRow", async () => {
    const parseFile = async (): Promise<ParsedImportFile> => ({ rows: [["Report"], ["generated"], ["Name", "Age"], ["a", "1"]] });
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile, defaults: { defaultHeaderRow: 2 } })));
    await act(async () => result.current.loadFile(FILE, targets));
    expect(result.current.preview?.importHeaders).toEqual(["Name", "Age"]);
    expect(result.current.importRows).toEqual([["a", "1"]]);
    expect(result.current.preview?.mapping.map((m) => m.gridColumnId)).toEqual(["name", "age"]);
  });

  it("shows no-rows when the header index is past the end", async () => {
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile: async () => ({ rows: [["a"]] }), defaults: { defaultHeaderRow: 5 } })));
    await act(async () => result.current.loadFile(FILE, targets));
    expect(result.current.error).toBe("errorNoRows");
  });

  it("build() runs processImportRows, checks its result, and returns null on false", async () => {
    const { result } = renderHook(() => useDataGridImportPreview(options({ parseFile: async () => ({ rows: [["Name", "Age"], ["a", "1"], ["b", "2"]] }), limits: { maxCells: 8 } })));
    await act(async () => result.current.loadFile(FILE, targets));
    const buildOptions = { columns, cellTypes, createRow: (index: number): Row => ({ id: `r${index}`, name: "", age: null }) };

    const plain = await result.current.build<Row>(buildOptions);
    expect(plain?.rows.map((r) => r.name)).toEqual(["a", "b"]);

    const seen = vi.fn();
    const filtered = await result.current.build<Row>({
      ...buildOptions,
      processImportRows: (ctx) => {
        seen(ctx.headers, ctx.rows.length);
        return ctx.rows.filter((row) => row[0] !== "a");
      },
    });
    expect(seen).toHaveBeenCalledWith(["Name", "Age"], 2);
    expect(filtered?.rows.map((r) => r.name)).toEqual(["b"]);

    expect(await result.current.build<Row>({ ...buildOptions, processImportRows: (async () => false) as never })).toBeNull();

    const grown = () => result.current.build<Row>({ ...buildOptions, processImportRows: ({ rows }) => [...rows, ...rows, ...rows] });
    await expect(Promise.resolve().then(grown)).rejects.toThrow(IMPORT_TOO_MANY_CELLS_MESSAGE);
    await expect(Promise.resolve().then(() => result.current.build<Row>({ ...buildOptions, processImportRows: () => [[1 as never]] }))).rejects.toThrow(INVALID_IMPORT_ROWS_MESSAGE);
  });
});
