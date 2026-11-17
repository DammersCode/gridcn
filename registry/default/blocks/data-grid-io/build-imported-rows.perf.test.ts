import { describe, expect, it } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { buildImportedRows, IMPORT_CANCELLED_MESSAGE, type BuildImportedRowsOptions } from "./build-imported-rows";

/**
 * Acceptance check of the import `validateRow` hook: at 100,000 rows x 10 columns a sync
 * `validateRow` adds at most 15% to the build, and Cancel lands within one chunk of 2,000 rows.
 * Runs alternate between the two builds and compare medians, so a loaded machine slows both alike.
 */

const ROW_COUNT = 100_000;
const COL_COUNT = 10;
const CHUNK_SIZE = 2_000;
const RUNS = 5;
const MAX_OVERHEAD = 1.15;

type Row = Record<string, string>;

const textCellType: CellType<Row, string> = {
  Cell: () => null,
  Editor: () => null,
  toText: (value) => value ?? "",
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value === "",
};

const columns: ColumnDef<Row, unknown>[] = Array.from({ length: COL_COUNT }, (_, c) => ({ id: `c${c}`, header: `C${c}`, accessorKey: `c${c}`, type: "text" }));
const dataRows = Array.from({ length: ROW_COUNT }, (_, i) => Array.from({ length: COL_COUNT }, (_, c) => `v${i}-${c}`));

function options(extra: Partial<BuildImportedRowsOptions<Row>> = {}): BuildImportedRowsOptions<Row> {
  return {
    dataRows,
    mapping: columns.map((column, index) => ({ importColumnIndex: index, gridColumnId: column.id })),
    columns,
    cellTypes: { text: textCellType } as never,
    createRow: () => ({}),
    ...extra,
  };
}

async function time(extra: Partial<BuildImportedRowsOptions<Row>>): Promise<number> {
  const started = performance.now();
  await buildImportedRows(options(extra));
  return performance.now() - started;
}

function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

describe("buildImportedRows validateRow at 100,000 rows", () => {
  it("adds at most 15% to the build for a sync validateRow", async () => {
    const validateRow = (row: Row) => (row["c0"] === "never" ? { c0: "x" } : null);
    await time({});
    await time({ validateRow });
    const plain: number[] = [];
    const validated: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      plain.push(await time({}));
      validated.push(await time({ validateRow }));
    }
    const ratio = median(validated) / median(plain);
    console.info(`[perf] import build 100k x 10: plain ${median(plain).toFixed(0)} ms, validateRow ${median(validated).toFixed(0)} ms, ratio ${ratio.toFixed(3)}`);
    expect(ratio).toBeLessThan(MAX_OVERHEAD);
  }, 120_000);

  it("cancels within one chunk of 2,000 rows", async () => {
    const controller = new AbortController();
    const abortAt = 30_000;
    let calls = 0;
    const pending = buildImportedRows(
      options({
        signal: controller.signal,
        validateRow: () => {
          calls += 1;
          if (calls === abortAt) controller.abort();
          return null;
        },
      }),
    );
    await expect(pending).rejects.toThrow(IMPORT_CANCELLED_MESSAGE);
    expect(calls).toBeLessThanOrEqual(abortAt + CHUNK_SIZE);
  }, 60_000);
});
