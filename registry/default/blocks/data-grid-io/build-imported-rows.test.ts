import { describe, expect, it, vi } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import {
  buildImportedRows as buildImportedRowsRaw,
  IMPORT_CANCELLED_MESSAGE,
  IMPORT_CHUNK_THRESHOLD_ROWS,
  type BuildImportedRowsOptions,
} from "./build-imported-rows";

/** Asserts the sync contract while calling: a fully-sync column set must never return a Promise. */
function buildImportedRows<TData>(options: BuildImportedRowsOptions<TData>): TData[] {
  const result = buildImportedRowsRaw(options);
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result.rows;
}

type Row = { id: string; name: string; age: number | null };

const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

const numberCellType: CellType<Row, number | null> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => (value === null ? "" : String(value)),
  fromText: (text) => {
    const n = Number(text);
    return Number.isFinite(n) && text.trim() !== "" ? n : null;
  },
  clearValue: () => null,
  isEmpty: (value) => value === null,
};

function makeColumns(): ColumnDef<Row, unknown>[] {
  return [
    { id: "name", header: "Name", accessorKey: "name", type: "text" },
    {
      id: "age",
      header: "Age",
      accessorKey: "age",
      type: "number",
      validate: (value) => (typeof value === "number" && value < 0 ? "must be non-negative" : null),
    },
  ];
}

function makeRow(index: number): Row {
  return { id: `row-${index}`, name: "", age: null };
}

describe("buildImportedRows", () => {
  it("creates one row per data row via createRow and applies mapped cells through fromText", () => {
    const rows = buildImportedRows({
      dataRows: [
        ["Alice", "30"],
        ["Bob", "40"],
      ],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "age" },
      ],
      columns: makeColumns(),
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });

    expect(rows).toEqual([
      { id: "row-0", name: "Alice", age: 30 },
      { id: "row-1", name: "Bob", age: 40 },
    ]);
  });

  it("skips import columns mapped to null", () => {
    const rows = buildImportedRows({
      dataRows: [["Alice", "30"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: null },
      ],
      columns: makeColumns(),
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });

    expect(rows).toEqual([{ id: "row-0", name: "Alice", age: null }]);
  });

  it("clears a value that fails column.validate rather than dropping the row", () => {
    const rows = buildImportedRows({
      dataRows: [["Alice", "-5"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "age" },
      ],
      columns: makeColumns(),
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });

    expect(rows).toEqual([{ id: "row-0", name: "Alice", age: null }]);
  });

  it("lists every rejected cell in `rejected` with its row and source column, and still builds all rows", () => {
    const columns: ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name", type: "text", validate: (value) => (value === "bad" ? "invalid name" : null) },
      { id: "age", header: "Age", accessorKey: "age", type: "number", validate: (value) => (typeof value === "number" && value < 0 ? "must be non-negative" : null) },
    ];
    const result = buildImportedRowsRaw<Row>({
      dataRows: [
        ["Alice", "-5"],
        ["bad", "7"],
        ["Carol", "-1"],
      ],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "age" },
      ],
      columns,
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });
    if (result instanceof Promise) throw new Error("expected a synchronous result");

    expect(result.rows).toEqual([
      { id: "row-0", name: "Alice", age: null },
      { id: "row-1", name: "", age: 7 },
      { id: "row-2", name: "Carol", age: null },
    ]);
    expect(result.rejected).toEqual([
      { rowIndex: 0, importColumnIndex: 1, gridColumnId: "age" },
      { rowIndex: 1, importColumnIndex: 0, gridColumnId: "name" },
      { rowIndex: 2, importColumnIndex: 1, gridColumnId: "age" },
    ]);
  });

  it("passes through createRow's index for identity/defaults", () => {
    const rows = buildImportedRows({
      dataRows: [["A"], ["B"], ["C"]],
      mapping: [{ importColumnIndex: 0, gridColumnId: "name" }],
      columns: makeColumns(),
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });
    expect(rows.map((r) => r.id)).toEqual(["row-0", "row-1", "row-2"]);
  });

  it("skips a mapping whose gridColumnId doesn't match any column", () => {
    const rows = buildImportedRows({
      dataRows: [["Alice", "30"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "not-a-real-column" },
      ],
      columns: makeColumns(),
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });
    expect(rows).toEqual([{ id: "row-0", name: "Alice", age: null }]);
  });

  it("a duplicate mapping (two source columns on one grid column) lets the later one win, once per column", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = buildImportedRows({
      dataRows: [["Alice", "Bob"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "name" },
      ],
      columns: makeColumns(),
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });
    // mapping order is importColumnIndex ascending, so index 1 ("Bob") writes last and wins
    expect(rows).toEqual([{ id: "row-0", name: "Bob", age: null }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("is mapped by more than one import column"));
    warn.mockRestore();
  });

  it("defaults a column with no `type` to the 'text' cell type", () => {
    const rows = buildImportedRows({
      dataRows: [["Alice"]],
      mapping: [{ importColumnIndex: 0, gridColumnId: "untyped" }],
      columns: [{ id: "untyped", header: "Untyped", accessorKey: "name" }] as never,
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });
    expect(rows).toEqual([{ id: "row-0", name: "Alice", age: null }]);
  });

  it("skips a mapping whose column type has no registered cell type", () => {
    const rows = buildImportedRows({
      dataRows: [["Alice"]],
      mapping: [{ importColumnIndex: 0, gridColumnId: "name" }],
      columns: makeColumns(),
      cellTypes: { number: numberCellType } as never, // no "text" entry
      createRow: makeRow,
    });
    expect(rows).toEqual([{ id: "row-0", name: "", age: null }]);
  });

  it("treats a missing source cell as empty text", () => {
    const rows = buildImportedRows({
      dataRows: [["Alice"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "age" },
      ],
      columns: makeColumns(),
      cellTypes: { text: textCellType, number: numberCellType } as never,
      createRow: makeRow,
    });
    expect(rows).toEqual([{ id: "row-0", name: "Alice", age: null }]);
  });
});

/** An async Standard Schema over the age column: negatives reject, everything else doubles. */
const asyncAgeSchema = {
  "~standard": {
    version: 1,
    vendor: "mock",
    validate: async (value: unknown) =>
      typeof value === "number" && value < 0
        ? { issues: [{ message: "must be non-negative" }] }
        : { value: typeof value === "number" ? value * 2 : value },
  },
};

function asyncColumns(): ColumnDef<Row, unknown>[] {
  return [
    { id: "name", header: "Name", accessorKey: "name", type: "text" },
    { id: "age", header: "Age", accessorKey: "age", type: "number", validate: asyncAgeSchema as never },
  ];
}

describe("buildImportedRows with an async schema", () => {
  const options = (dataRows: string[][]) => ({
    dataRows,
    mapping: [
      { importColumnIndex: 0, gridColumnId: "name" },
      { importColumnIndex: 1, gridColumnId: "age" },
    ],
    columns: asyncColumns(),
    cellTypes: { text: textCellType, number: numberCellType } as never,
    createRow: makeRow,
  });

  it("returns a Promise and commits the schema's transformed value", async () => {
    const result = buildImportedRowsRaw<Row>(options([["Alice", "30"]]));
    expect(result).toBeInstanceOf(Promise);
    const built = await result;
    expect(built.rows).toEqual([{ id: "row-0", name: "Alice", age: 60 }]);
    expect(built.rejected).toEqual([]);
  });

  it("clears a rejected value and keeps the rest of the row, same as the sync path", async () => {
    const { rows, rejected } = await buildImportedRowsRaw<Row>(options([["Alice", "-5"], ["Bob", "4"]]));
    expect(rows).toEqual([
      { id: "row-0", name: "Alice", age: null },
      { id: "row-1", name: "Bob", age: 8 },
    ]);
    expect(rejected).toEqual([{ rowIndex: 0, importColumnIndex: 1, gridColumnId: "age" }]);
  });
});

/** Regression for B5(a): writeCells merges same-row accessorKey writes into one spread instead of one per cell. */
type WideRow = { id: string; a: string; b: string; c: string; d: string; e: string };

function wideColumns(): ColumnDef<WideRow, unknown>[] {
  return ["a", "b", "c", "d", "e"].map((key) => ({ id: key, header: key, accessorKey: key, type: "text" }) as ColumnDef<WideRow, unknown>);
}

function makeWideRow(index: number): WideRow {
  return { id: `row-${index}`, a: "", b: "", c: "", d: "", e: "" };
}

describe("buildImportedRows — writeCells row-merged spread (B5a)", () => {
  it("produces byte-identical output to per-cell writes on a several-column fixture", () => {
    const dataRows = [
      ["a0", "b0", "c0", "d0", "e0"],
      ["a1", "b1", "c1", "d1", "e1"],
      ["a2", "b2", "c2", "d2", "e2"],
    ];
    const mapping = ["a", "b", "c", "d", "e"].map((gridColumnId, importColumnIndex) => ({ importColumnIndex, gridColumnId }));

    const rows = buildImportedRows<WideRow>({
      dataRows,
      mapping,
      columns: wideColumns(),
      cellTypes: { text: textCellType } as never,
      createRow: makeWideRow,
    });

    expect(rows).toEqual([
      { id: "row-0", a: "a0", b: "b0", c: "c0", d: "d0", e: "e0" },
      { id: "row-1", a: "a1", b: "b1", c: "c1", d: "d1", e: "e1" },
      { id: "row-2", a: "a2", b: "b2", c: "c2", d: "d2", e: "e2" },
    ]);
  });

  it("a setValue column still sees every earlier accessorKey cell's write in the same row (ordering preserved)", () => {
    type Row2 = { id: string; first: string; last: string; full: string };
    const columns: ColumnDef<Row2, unknown>[] = [
      { id: "first", header: "First", accessorKey: "first", type: "text" },
      { id: "last", header: "Last", accessorKey: "last", type: "text" },
      {
        id: "full",
        header: "Full",
        // setValue reads the row's `first`/`last` as already written by the earlier accessorKey cells.
        setValue: (row: Row2) => ({ ...row, full: `${row.first} ${row.last}`.trim() }),
        type: "text",
      },
    ];

    const rows = buildImportedRows<Row2>({
      dataRows: [["Alice", "Doe", "ignored"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "first" },
        { importColumnIndex: 1, gridColumnId: "last" },
        { importColumnIndex: 2, gridColumnId: "full" },
      ],
      columns,
      cellTypes: { text: textCellType } as never,
      createRow: (index) => ({ id: `row-${index}`, first: "", last: "", full: "" }),
    });

    expect(rows).toEqual([{ id: "row-0", first: "Alice", last: "Doe", full: "Alice Doe" }]);
  });
});

/** Regression for B5(b): large imports chunk (yield + cancellable) instead of hard-blocking with no affordance. */
describe("buildImportedRows — chunked path for large imports (B5b)", () => {
  function manyDataRows(count: number): string[][] {
    return Array.from({ length: count }, (_, i) => [`name-${i}`, String(i)]);
  }

  const chunkOptions = (dataRows: string[][], signal?: AbortSignal) => ({
    dataRows,
    mapping: [
      { importColumnIndex: 0, gridColumnId: "name" },
      { importColumnIndex: 1, gridColumnId: "age" },
    ],
    columns: makeColumns(),
    cellTypes: { text: textCellType, number: numberCellType } as never,
    createRow: makeRow,
    signal,
  });

  it("stays synchronous at or below the chunk threshold", () => {
    const result = buildImportedRowsRaw<Row>(chunkOptions(manyDataRows(IMPORT_CHUNK_THRESHOLD_ROWS)));
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("returns a Promise above the chunk threshold, resolving to the same rows the sync path would build", async () => {
    const dataRows = manyDataRows(IMPORT_CHUNK_THRESHOLD_ROWS + 1);
    const result = buildImportedRowsRaw<Row>(chunkOptions(dataRows));
    expect(result).toBeInstanceOf(Promise);
    const { rows } = await result;
    expect(rows).toHaveLength(dataRows.length);
    expect(rows[0]).toEqual({ id: "row-0", name: "name-0", age: 0 });
    expect(rows[rows.length - 1]).toEqual({ id: `row-${dataRows.length - 1}`, name: `name-${dataRows.length - 1}`, age: dataRows.length - 1 });
  });

  it("rejects once `signal` is aborted between chunks, instead of finishing the import", async () => {
    const controller = new AbortController();
    const dataRows = manyDataRows(IMPORT_CHUNK_THRESHOLD_ROWS * 3);
    const result = buildImportedRowsRaw<Row>(chunkOptions(dataRows, controller.signal));
    expect(result).toBeInstanceOf(Promise);
    // aborting synchronously would race the first chunk's own synchronous prefix (it hasn't reached
    // its first `await` yet, so it can't have observed the signal); wait one macrotask so at least the
    // first chunk's yield has happened, then abort mid-flight — proving cancellation actually lands
    // before the whole (3-chunk) import finishes, not just as a same-tick no-op.
    await new Promise((resolve) => setTimeout(resolve));
    controller.abort();
    await expect(result).rejects.toThrow(IMPORT_CANCELLED_MESSAGE);
  });
});
