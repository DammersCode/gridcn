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

  it("stops at a negative maxBytes after the first batch", async () => {
    const { result } = await run({ maxBytes: -1 });
    expect(result.truncated).toBe(true);
  });
});
