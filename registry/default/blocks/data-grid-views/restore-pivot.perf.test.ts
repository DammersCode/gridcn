import { describe, expect, it } from "vitest";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { createDataGridStore } from "@/registry/default/blocks/data-grid/store/create-store";
import type { InternalSyncProps } from "@/registry/default/blocks/data-grid/store/types";
import { applyPivotWidths } from "./use-data-grid-views";

const ROW_COUNT = 100_000;
const CI_FACTOR = process.env["CI"] === "true" ? 2 : 1;

type Row = { id: string; region: string; team: string; year: number; qty: number; price: number; score: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "team", header: "Team", accessorKey: "team" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
  { id: "price", header: "Price", accessorKey: "price", type: "number", aggregate: "avg" },
  { id: "score", header: "Score", accessorKey: "score", type: "number", aggregate: "max" },
];

const data: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({ id: `r${i}`, region: `a${i % 40}`, team: `b${Math.trunc(i / 40) % 25}`, year: (i * 7) % 66, qty: i % 997, price: ((i * 13) % 101) / 7, score: i % 50 }));

const fastest = (runs: number, fn: () => void): number =>
  Math.min(...Array.from({ length: runs }, () => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }));

const within = (floor: number, cap: number, value: number) => Math.min(cap * CI_FACTOR, Math.max(floor * CI_FACTOR, value));

describe("restoring the generated widths of a saved view at 100k rows (1,040 group rows, 198 generated columns)", () => {
  const store = createDataGridStore({ data, columns, getRowId: (row: Row) => row.id, defaultGroupBy: ["region", "team"], defaultPivot: { columnIds: ["year"] } } as unknown as InternalSyncProps);

  it("applies every width within a twentieth of a same-run pivot switch", ({ annotate }) => {
    const ids = store.getState().pivot!.columns.map((column) => column.id);
    expect(ids).toHaveLength(198);
    let width = 100;
    const restore = () => {
      width = width === 100 ? 120 : 100;
      applyPivotWidths(store.getState, Object.fromEntries(ids.map((id) => [id, width])), true);
    };
    const switchPivot = () => {
      store.getState().actions.setPivot({ columnIds: [] });
      store.getState().actions.setPivot({ columnIds: ["year"] });
    };
    restore();
    expect(ids.every((id) => store.getState().columnWidths[id] === width)).toBe(true);
    const switchMs = fastest(3, switchPivot);
    const restoreMs = fastest(5, restore);
    const budget = within(2, 16, 0.05 * switchMs);
    annotate(`198 widths: ${restoreMs.toFixed(2)} ms, pivot switch ${switchMs.toFixed(1)} ms, budget ${budget.toFixed(1)} ms`);
    expect(restoreMs).toBeLessThan(budget);
  }, 60_000);
});
