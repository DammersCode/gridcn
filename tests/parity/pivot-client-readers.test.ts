import { describe, expect, it } from "vitest";
import { serializeCopyScope } from "@/registry/default/blocks/data-grid/clipboard/use-grid-clipboard";
import { createDataGridStore } from "@/registry/default/blocks/data-grid/store/create-store";
import type { InternalSyncProps } from "@/registry/default/blocks/data-grid/store/types";
import { buildCsv } from "@/registry/default/blocks/data-grid-io/export-grid";

type Row = { id: string; region: string; year: number | null; amount: number };

const columns = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
];

const rows: Row[] = [
  { id: "r0", region: "EU", year: 2024, amount: 1.5 },
  { id: "r1", region: "EU", year: 2025, amount: 2 },
  { id: "r2", region: "=1+1", year: 2024, amount: -3 },
  { id: "r3", region: "US", year: null, amount: 4 },
];

const store = () => createDataGridStore({ data: rows, columns, getRowId: (row: Row) => row.id, groupBy: ["region"], defaultPivot: { columnIds: ["year"] } } as unknown as InternalSyncProps);

describe("the readers of a client pivot", () => {
  it("copy the group label and the shown pivot cells", () => {
    const s = store().getState();
    expect(serializeCopyScope(s, { kind: "rect", rect: { x: 0, y: 0, width: 4, height: 3 } })).toEqual([
      ["=1+1", "-3", "", ""],
      ["EU", "1.5", "2", ""],
      ["US", "", "", "4"],
    ]);
  });

  it("export the generated columns and the pivot rows, neutralizing a formula-like label", async () => {
    const lines = (await buildCsv(store().getState()).text()).replace(/^﻿/, "").split("\r\n");
    expect(lines).toEqual(["Region,2024,2025,(empty)", "'=1+1,-3,,", "EU,1.5,2,", "US,,,4"]);
  });

  it("find the shown text of a pivot cell and the group label", () => {
    const grid = store();
    grid.getState().actions.setSearch("1.5");
    const generated = grid.getState().visibleColumns[1]!.id;
    expect(grid.getState().searchMatches).toEqual([{ row: 1, columnId: generated }]);
    grid.getState().actions.setSearch("US");
    expect(grid.getState().searchMatches).toEqual([{ row: 2, columnId: "region" }]);
  });
});
