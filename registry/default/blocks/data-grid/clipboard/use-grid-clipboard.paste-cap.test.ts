import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "../store/create-store";
import type { InternalSyncProps } from "../store/types";
import { MAX_PASTE_CELLS, pasteText, truncatePasteGrid } from "./use-grid-clipboard";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("truncatePasteGrid", () => {
  it("returns the input unchanged below the cap", () => {
    const cells = [
      ["a", "b"],
      ["c"],
    ];
    expect(truncatePasteGrid(cells, 3)).toBe(cells);
  });

  it("returns the input unchanged at exactly the cap", () => {
    const cells = [
      ["a", "b"],
      ["c", "d"],
    ];
    expect(truncatePasteGrid(cells, 4)).toBe(cells);
  });

  it("keeps the first rows when the grid exceeds the cap", () => {
    const cells = [
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ];
    expect(truncatePasteGrid(cells, 3)).toEqual([
      ["a", "b"],
    ]);
  });

  it("row-sums ragged rows", () => {
    const cells = [
      ["a", "b", "c"],
      ["d", "e"],
      ["f"],
    ];
    expect(truncatePasteGrid(cells, 5)).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });
});

describe("pasteText cap", () => {
  it("caps a 1×20 paste into a 100k-row range at MAX_PASTE_CELLS and warns in dev", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rowCount = 100_000;
    const columnCount = 20;
    const expectedRows = Math.floor(MAX_PASTE_CELLS / columnCount);

    type WideRow = { [key: string]: string } & { id: string };
    const columns: readonly ColumnDef<WideRow, unknown>[] = Array.from({ length: columnCount }, (_, column) => ({
      id: `c${column}`,
      header: `C${column}`,
      accessorKey: `c${column}`,
    }));
    const data: WideRow[] = Array.from({ length: rowCount }, (_, row) => {
      const entry: WideRow = { id: `row-${row}` };
      for (let column = 0; column < columnCount; column++) {
        entry[`c${column}`] = `row-${row}-c${column}`;
      }
      return entry;
    });

    const store = createDataGridStore({
      data,
      columns,
      getRowId: (row: WideRow) => row.id,
    } as InternalSyncProps);
    const actions = store.getState().actions;
    actions.selectCell({ col: 0, row: 0 });
    actions.extendTo({ col: columnCount - 1, row: rowCount - 1 });

    const text = Array.from({ length: columnCount }, (_, column) => `p${column}`).join("\t");
    const applied = pasteText(store.getState(), actions, text, undefined, store);

    expect(applied).toBe(true);
    const next = store.getState().data as WideRow[];
    expect(next[0]!["c0"]).toBe("p0");
    expect(next[expectedRows - 1]!["c19"]).toBe("p19");
    expect(next[expectedRows]!["c0"]).toBe(`row-${expectedRows}-c0`);
    expect(warn).toHaveBeenCalledWith(`gridcn: paste truncated to ${expectedRows} of ${rowCount} rows (MAX_PASTE_CELLS)`);
  });
});
