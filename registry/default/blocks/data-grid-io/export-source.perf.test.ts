import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { exportGrid } from "./export-grid";
import { ciFactor } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

const ROW_COUNT = 100_000;
const COL_COUNT = 10;
const BATCH = 2_000;
const BUDGET_MS = 3_000 * (ciFactor(2));

type Row = Record<string, string>;

const toText = (value: unknown) => (value === null || value === undefined ? "" : String(value));

function makeState(): DataGridStoreState {
  const visibleColumns = Array.from({ length: COL_COUNT }, (_, c) => ({ id: `c${c}`, header: `C${c}`, accessorKey: `c${c}`, type: "text" }));
  return {
    data: [],
    visibleColumns,
    viewIndex: [],
    cellTypes: { text: { toText } },
    sortState: [],
    filterState: [],
    searchText: "",
  } as unknown as DataGridStoreState;
}

async function* batches(): AsyncGenerator<Row[]> {
  for (let start = 0; start < ROW_COUNT; start += BATCH) {
    yield Array.from({ length: BATCH }, (_, i) => {
      const row: Row = {};
      for (let c = 0; c < COL_COUNT; c++) row[`c${c}`] = `value ${start + i}-${c}`;
      return row;
    });
  }
}

afterEach(() => vi.restoreAllMocks());

describe("export of a 100k-row source", () => {
  it("writes a CSV file within the budget", async () => {
    let blob: Blob | undefined;
    vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => ((blob = b), "blob:x"), revokeObjectURL: vi.fn() });
    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue(anchor);
    const state = makeState();
    await exportGrid(state, { source: batches, maxRows: ROW_COUNT });
    const start = performance.now();
    const result = await exportGrid(state, { source: batches, maxRows: ROW_COUNT });
    const elapsed = performance.now() - start;
    vi.unstubAllGlobals();
    expect(result).toEqual({ rowCount: ROW_COUNT, truncated: false });
    expect(blob!.size).toBeGreaterThan(ROW_COUNT * COL_COUNT);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("writes a CSV file with a formatCell hook within the budget", async () => {
    const state = makeState();
    const output = vi.fn();
    const formatCell = ({ value, column }: { value: unknown; column: { id: string } }) => (column.id === "c0" ? Number.parseFloat(String(value).slice(6)) : String(value).toUpperCase());
    await exportGrid(state, { source: batches, maxRows: ROW_COUNT, formatCell, output });
    const start = performance.now();
    const result = await exportGrid(state, { source: batches, maxRows: ROW_COUNT, formatCell, output });
    const elapsed = performance.now() - start;
    expect(result).toEqual({ rowCount: ROW_COUNT, truncated: false });
    expect(output.mock.calls[1]![0].size).toBeGreaterThan(ROW_COUNT * COL_COUNT);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
