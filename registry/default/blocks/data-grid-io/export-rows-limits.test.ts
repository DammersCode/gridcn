import { describe, expect, it } from "vitest";
import type { CellType, ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { exportRows } from "./export-source";

type Row = { id: string; name: string };
const textCellType: CellType<Row, string> = { Cell: () => null, Editor: () => null, toText: (v) => v ?? "", fromText: (t) => t, clearValue: () => "", isEmpty: (v) => v === "" };
const columns: ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", type: "text" }];
const state = { data: [], visibleColumns: columns, viewIndex: [], cellTypes: { text: textCellType }, sortState: [], filterState: [], searchText: "" } as unknown as DataGridStoreState;
const rows = ["a", "b", "c", "d", "e"].map((name) => ({ id: name, name }));

async function run(limits: { maxRows?: number; maxBytes?: number }) {
  const out: string[][] = [];
  const result = await exportRows<Row>(state, { source: async function* () { yield rows; }, ...limits }, (batch) => (out.push(...batch), 1));
  return { names: out.map((row) => row[0]), result };
}

describe("exportRows limits", () => {
  it("writes every row when both limits are omitted", async () => {
    expect((await run({})).names).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("writes no row for a negative maxRows instead of dropping the tail of each batch", async () => {
    const { names, result } = await run({ maxRows: -2 });
    expect(names).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("takes the default for a NaN limit", async () => {
    expect((await run({ maxRows: Number.NaN, maxBytes: Number.NaN })).names).toHaveLength(5);
  });

  it("rounds a fractional maxRows down", async () => {
    expect((await run({ maxRows: 2.9 })).names).toEqual(["a", "b"]);
  });

  it("maxRows 0 with empty rows in the batch ends truncated instead of throwing", async () => {
    const result = await exportRows<Row>(state, { source: () => [null, null, null, rows[0]] as never, maxRows: 0 }, () => 1);
    expect(result).toEqual({ rowCount: 0, truncated: true });
  });

  it("a batch of only empty rows beyond twice maxRows still rejects", async () => {
    await expect(exportRows<Row>(state, { source: () => [null, null, null] as never, maxRows: 1 }, () => 1)).rejects.toThrow("too many empty rows");
  });

  it("stops at a negative maxBytes after the first batch", async () => {
    const out: string[][] = [];
    const result = await exportRows<Row>(state, { source: async function* () { yield rows.slice(0, 2); yield rows.slice(2); }, maxBytes: -1 }, (batch) => (out.push(...batch), 1));
    expect(out.map((row) => row[0])).toEqual(["a", "b"]);
    expect(result.truncated).toBe(true);
  });
});
