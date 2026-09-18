import { describe, expect, it, vi } from "vitest";
import type { ColumnDef, DataChange } from "../types";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

const ROW_COUNT = 100_000;
const COLUMN_COUNT = 20;

// Shared GitHub Actions runners are several × slower than a dev machine; the ceiling guards the
// order of magnitude, not machine jitter.
const CI_FACTOR = process.env["CI"] ? 2 : 1;

type WideRow = { [key: string]: string | number } & { id: string };

function makeColumns(): readonly ColumnDef<WideRow, unknown>[] {
  return Array.from({ length: COLUMN_COUNT }, (_, column) => ({
    id: `c${column}`,
    header: `C${column}`,
    accessorKey: `c${column}`,
  }));
}

function makeRows(): WideRow[] {
  return Array.from({ length: ROW_COUNT }, (_, row) => {
    const entry: WideRow = { id: `row-${row}` };
    for (let column = 0; column < COLUMN_COUNT; column++) {
      entry[`c${column}`] = `row-${row}-c${column}`;
    }
    return entry;
  });
}

describe("deleteSelection perf (100k rows × 20 columns)", () => {
  it("clears a whole-grid selection in one bounded batch", () => {
    const onDataChange = vi.fn();
    const store = createDataGridStore({
      data: makeRows(),
      columns: makeColumns(),
      getRowId: (row: WideRow) => row.id,
      onDataChange,
    } as InternalSyncProps);

    const actions = store.getState().actions;
    actions.selectCell({ col: 0, row: 0 });
    actions.extendTo({ col: COLUMN_COUNT - 1, row: ROW_COUNT - 1 });

    const start = performance.now();
    actions.deleteSelection();
    const ms = performance.now() - start;
    console.log(`deleteSelection 100k rows × 20 columns: ${ms.toFixed(2)}ms`);

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [, change] = onDataChange.mock.calls[0] as [readonly WideRow[], DataChange<WideRow>];
    expect(change.source).toBe("delete");
    expect(change.ops).toHaveLength(ROW_COUNT);
    // ~5× the ~1.2s local mean (×CI_FACTOR on CI); the 2M-write batch is allocation-bound —
    // observed 6277ms on a loaded runner.
    expect(ms).toBeLessThan(6000 * CI_FACTOR);
    // 2M cells of fixture generation plus the batch itself exceed the default 5s wall budget on
    // a slow CI runner (the assertion above is its own ceiling, not the wall clock), so give it
    // the same generous wall budget as the commit-perf sibling.
  }, 30_000);
});
