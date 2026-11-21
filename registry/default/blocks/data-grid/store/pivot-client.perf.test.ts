import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import { pivotCellText } from "./pivot-view";
import type { InternalSyncProps } from "./types";

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

const rows = (): Row[] =>
  Array.from({ length: ROW_COUNT }, (_, i) => ({ id: `r${i}`, region: `a${i % 40}`, team: `b${Math.trunc(i / 40) % 25}`, year: (i * 7) % 66, qty: i % 997, price: ((i * 13) % 101) / 7, score: i % 50 }));

const propsOf = (data: readonly Row[], pivot: boolean) =>
  ({ data, columns, getRowId: (row: Row) => row.id, defaultGroupBy: ["region", "team"], ...(pivot ? { defaultPivot: { columnIds: ["year"] } } : {}) }) as unknown as InternalSyncProps;

const make = (data: readonly Row[], pivot: boolean) => createDataGridStore(propsOf(data, pivot));

const fastest = (runs: number, fn: () => void): number => Math.min(...Array.from({ length: runs }, () => {
  const start = performance.now();
  fn();
  return performance.now() - start;
}));

const within = (floor: number, cap: number, value: number) => Math.min(cap * CI_FACTOR, Math.max(floor * CI_FACTOR, value));

describe("client pivot at 100k rows (1,040 group rows, 198 generated columns)", () => {
  const data = rows();
  const grouped = make(data, false);
  const pivoted = make(data, true);

  it("builds within 3.5 same-run grouped builds", ({ annotate }) => {
    expect(pivoted.getState().pivot?.columns).toHaveLength(198);
    const groupMs = fastest(3, () => make(data, false));
    const pivotMs = fastest(3, () => make(data, true));
    const budget = within(40, 400, 3.5 * groupMs);
    annotate(`first build: pivot ${pivotMs.toFixed(1)} ms, grouped ${groupMs.toFixed(1)} ms, budget ${budget.toFixed(0)} ms`);
    expect(pivotMs).toBeLessThan(budget);
  }, 60_000);

  it("refreshes one value edit within a frame, keeping the view and the generated columns", ({ annotate }) => {
    const { viewIndex, pivot } = pivoted.getState();
    let value = 0;
    const edit = (store: ReturnType<typeof make>) => () => store.getState().actions.updateCells([{ rowId: "r54321", columnId: "price", value: ++value / 3 }], { source: "stream" });
    const times = { group: Infinity, pivot: Infinity };
    for (let round = 0; round < 60; round++) {
      times.group = Math.min(times.group, fastest(1, edit(grouped)));
      times.pivot = Math.min(times.pivot, fastest(1, edit(pivoted)));
    }
    const { group: groupMs, pivot: pivotMs } = times;
    expect(pivoted.getState().viewIndex).toBe(viewIndex);
    expect(pivoted.getState().pivot).toBe(pivot);
    const budget = within(1.5, 8, 2.5 * groupMs);
    annotate(`one edit: pivot ${pivotMs.toFixed(2)} ms, grouped ${groupMs.toFixed(2)} ms, budget ${budget.toFixed(1)} ms`);
    expect(pivotMs).toBeLessThan(budget);
  }, 60_000);

  it("places one streamed row within half a same-run grouped rebuild, keeping the view and the generated columns", ({ annotate }) => {
    const generated = pivoted.getState().pivot!.columns;
    const view = pivoted.getState().viewIndex;
    const append = (store: ReturnType<typeof make>, pivot: boolean) => {
      let current = store.getState().data as readonly Row[];
      return () => {
        current = [...current, { ...data[current.length % ROW_COUNT]!, id: `s${current.length}` }];
        getInternalActions(store)._syncProps(propsOf(current, pivot));
      };
    };
    const groupMs = fastest(3, append(grouped, false));
    const pivotMs = fastest(3, append(pivoted, true));
    expect(pivoted.getState().data).toHaveLength(ROW_COUNT + 3);
    expect(pivoted.getState().groupLayout?.leafCount).toBe(ROW_COUNT + 3);
    expect(pivoted.getState().pivot!.columns).toBe(generated);
    expect(pivoted.getState().viewIndex).toBe(view);
    const budget = within(4, 16, 0.5 * groupMs);
    annotate(`one streamed row: pivot ${pivotMs.toFixed(1)} ms, grouped ${groupMs.toFixed(1)} ms, budget ${budget.toFixed(0)} ms`);
    expect(pivotMs).toBeLessThan(budget);
  }, 60_000);

  it("reads one scroll window of 40 rows by 198 cells within 3 same-run number formats of as many cells", ({ annotate }) => {
    const s = pivoted.getState();
    const read = () => {
      for (let row = 0; row < 40; row++) for (const column of s.visibleColumns) pivotCellText(s, row, column);
    };
    const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    const baseline = () => {
      for (let cell = 0; cell < 40 * 199; cell++) format.format(cell / 7);
    };
    read();
    baseline();
    const baseMs = fastest(10, baseline);
    const ms = fastest(10, read);
    const budget = within(3, 12, 3 * baseMs);
    annotate(`scroll window: ${ms.toFixed(2)} ms, formats ${baseMs.toFixed(2)} ms, budget ${budget.toFixed(1)} ms`);
    expect(ms).toBeLessThan(budget);
  });
});
