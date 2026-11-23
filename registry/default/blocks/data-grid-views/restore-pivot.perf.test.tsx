import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { useDataGridViews, type UseDataGridViewsResult } from "./use-data-grid-views";
import { createMemoryViewsStorage } from "./view-storage";
import { emptyViewState, type DataGridViewState } from "./view-state";

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

const timed = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

const within = (floor: number, cap: number, value: number) => Math.min(cap * CI_FACTOR, Math.max(floor * CI_FACTOR, value));

describe("restoring a saved pivot view on a mounted grid at 100k rows (1,040 group rows, 198 generated columns)", () => {
  it("writes every generated width within 3 same-run single width writes", async ({ annotate }) => {
    const handle: { views: UseDataGridViewsResult | null; store: ReturnType<typeof useDataGridStoreApi> | null } = { views: null, store: null };
    const view = (width: number): DataGridViewState => ({ ...emptyViewState(), groupBy: ["region", "team"], pivotColumnId: "year", pivotWidths: Object.fromEntries(ids.map((id) => [id, width])) });
    let ids: string[] = [];
    function Views() {
      handle.views = useDataGridViews({ storage: createMemoryViewsStorage(), enableDefaultView: false });
      handle.store = useDataGridStoreApi();
      return null;
    }
    const screen = render(
      <DataGridProvider data={data} columns={columns} getRowId={(row) => row.id} defaultGroupBy={["region", "team"]} defaultPivot={{ columnIds: ["year"] }}>
        <DataGridRoot aria-label="Perf">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <Views />
      </DataGridProvider>,
    );
    await waitFor(() => expect(handle.views?.loading).toBe(false));
    ids = handle.store!.getState().pivot!.columns.map((column) => column.id);
    expect(ids).toHaveLength(198);
    const imported = [view(110), view(130)].map((state) => {
      let id = "";
      act(() => {
        const result = handle.views!.importView(JSON.stringify({ format: "gridcn-view", version: 1, name: "P", state }));
        id = result.ok ? result.view.id : "";
      });
      return id;
    });
    let width = 100;
    const one = () => {
      width = width === 100 ? 101 : 100;
      act(() => handle.store!.getState().actions.setColumnWidth(ids[0]!, width));
    };
    let turn = 0;
    const restore = () => act(() => handle.views!.selectView(imported[turn++ % 2]!));
    restore();
    expect(handle.store!.getState().columnWidths[ids[5]!]).toBe(110);
    let oneMs = Infinity;
    let restoreMs = Infinity;
    for (let round = 0; round < 5; round++) {
      oneMs = Math.min(oneMs, timed(one));
      restoreMs = Math.min(restoreMs, timed(restore));
    }
    const budget = within(2, 600, 3 * oneMs);
    annotate(`198 widths: ${restoreMs.toFixed(2)} ms, one width ${oneMs.toFixed(2)} ms, budget ${budget.toFixed(1)} ms`);
    expect(restoreMs).toBeLessThan(budget);
    screen.unmount();
  }, 120_000);
});
