import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

const ROW_COUNT = 100_000;
const TICK_ROWS = 20;
const TICKS = 50;
const CI_FACTOR = process.env["CI"] === "true" ? 2 : 1;
/** The tick budget in same-run grouped 100k-row builds, so suite load and coverage slow both alike; a tick takes 0.14 builds idle, up to 0.32 under suite load. */
const TICK_BUDGET_BUILDS = 0.45;

type Row = { id: string; region: string; team: string; label: string; qty: number };

const columns: ColumnDef<Row, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region", type: "text" },
  { id: "team", header: "Team", accessorKey: "team", type: "text" },
  { id: "label", header: "Label", accessorKey: "label", type: "text" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
];

const rows = (): Row[] => Array.from({ length: ROW_COUNT }, (_, i) => ({ id: `r${i}`, region: `a${i % 40}`, team: `b${Math.trunc(i / 40) % 25}`, label: `l${i}`, qty: i % 100 }));

function make(grouped: boolean, data = rows()) {
  return createDataGridStore({ defaultData: data, columns, getRowId: (row: Row) => row.id, ...(grouped ? { defaultGroupBy: ["region", "team"] } : {}) } as unknown as InternalSyncProps);
}

let sequence = 0;

function timeTicks(store: ReturnType<typeof make>, columnId: string): number {
  const { actions } = store.getState();
  const start = performance.now();
  for (let tick = 0; tick < TICKS; tick++) {
    const patches = Array.from({ length: TICK_ROWS }, (_, k) => ({ rowId: `r${(tick * 997 + k * 31) % ROW_COUNT}`, columnId, value: columnId === "qty" ? ++sequence : `x${++sequence}` }));
    actions.updateCells(patches, { source: "stream" });
  }
  return performance.now() - start;
}

describe("a stream tick on a grouped grid (100k rows, 20 rows per tick)", () => {
  const flat = make(false);
  const grouped = make(true);
  const best = (store: ReturnType<typeof make>, columnId: string) => Math.min(...Array.from({ length: 5 }, () => timeTicks(store, columnId)));

  it("costs about the same as a flat grid on a column that is no group, sort, filter, or aggregate column", () => {
    best(flat, "label");
    best(grouped, "label");
    const flatMs = best(flat, "label");
    const groupedMs = best(grouped, "label");
    expect(groupedMs).toBeLessThan(flatMs * 1.5 + 5 * CI_FACTOR);
  });

  it("re-reduces only the touched groups on an aggregate column, keeping the view", async ({ annotate }) => {
    const view = grouped.getState().viewIndex;
    const ms = best(grouped, "qty");
    expect(grouped.getState().viewIndex).toBe(view);
    const data = rows();
    const buildMs = Math.min(...Array.from({ length: 3 }, () => {
      const start = performance.now();
      make(true, data);
      return performance.now() - start;
    }));
    const budget = Math.min(CI_FACTOR * 30, Math.max(CI_FACTOR * 4, TICK_BUDGET_BUILDS * buildMs));
    await annotate(`grouped aggregate tick: ${(ms / TICKS).toFixed(2)} ms, budget ${budget.toFixed(1)} ms; grouped build ${buildMs.toFixed(1)} ms`);
    expect(ms / TICKS).toBeLessThan(budget);
  }, 30_000);
});
