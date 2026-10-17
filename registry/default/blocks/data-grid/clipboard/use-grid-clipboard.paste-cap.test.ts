import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "../store/create-store";
import type { InternalSyncProps } from "../store/types";
import { MAX_PASTE_CELLS, pasteText, truncatePasteGrid } from "./use-grid-clipboard";
import { parseClipboard, parseClipboardText } from "./parse-clipboard";

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
    actions.selectCellAt({ col: 0, row: 0 });
    actions.extendToAt({ col: columnCount - 1, row: rowCount - 1 });

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

describe("parse-time paste cap", () => {
  it("stops parsing text once the cell cap is passed", () => {
    const text = Array.from({ length: 1000 }, (_, row) => `a${row}\tb${row}`).join("\n");
    const rows = parseClipboardText(text, 10);
    expect(rows.length).toBeLessThan(10);
    expect(rows[0]).toEqual(["a0", "b0"]);
  });

  it("parses the whole text without a cap", () => {
    expect(parseClipboardText("a\tb\nc\td")).toHaveLength(2);
  });

  it("skips an HTML payload too large for the cell cap and falls back to the text", () => {
    const html = `<table><tr><td>from-html</td></tr></table>${" ".repeat(10_000)}`;
    expect(parseClipboard({ html, text: "from-text" }, 10)).toEqual([["from-text"]]);
    expect(parseClipboard({ html, text: "from-text" })).toEqual([["from-html"]]);
  });
});

describe("hostile paste input", () => {
  it("parseClipboardText stops inside one over-wide row", () => {
    const parsed = parseClipboardText("a\t".repeat(3_000_000), 200_000);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.length).toBeLessThanOrEqual(200_001);
  });

  it("parseClipboard stops an HTML table at the cap", () => {
    const html = `<table><tr>${"<td>x</td>".repeat(50)}</tr><tr>${"<td>y</td>".repeat(50)}</tr></table>`;
    const parsed = parseClipboard({ html }, 60);
    expect(parsed.flat().length).toBeLessThanOrEqual(61);
  });

  it("truncatePasteGrid crops a first row wider than the cap instead of dropping the paste", () => {
    expect(truncatePasteGrid([["a", "b", "c", "d"]], 3)).toEqual([["a", "b", "c"]]);
  });
});
