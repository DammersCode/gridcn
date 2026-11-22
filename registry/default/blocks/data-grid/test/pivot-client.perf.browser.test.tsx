import { trackRenders } from "./render-counter.test-helper";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, type DataGridApi } from "../data-grid";
import { budget, plainLoopMs } from "./perf-budget.test-helper";
import { measureScrollLongTasks } from "./perf-probe.test-helper";
import "@/app/global.css";

const ROWS = 100_000;
const GROUPS = 5_000;
const KEYS = 200;
const IDLE_LOOP_MS = 3;
// Idle: 0ms of long tasks; perf.browser.test.tsx measured 585-6399ms on a healthy grid in CI, so CI widens the floor tenfold and the budget rises with the same-run loop slowdown.
const longTaskBudgetMs = () => budget({ floor: 200, cap: 1000, k: 200 / IDLE_LOOP_MS, reference: plainLoopMs(), ciFactor: 10 });

type Row = { id: string; region: string; year: string; qty: number };

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 160 },
  { id: "year", header: "Year", accessorKey: "year", type: "text", width: 100 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100, aggregate: "sum" },
] as const);

const data: Row[] = Array.from({ length: ROWS }, (_, i) => ({ id: `r${i}`, region: `g${String(i % GROUPS).padStart(4, "0")}`, year: `k${String(Math.trunc(i / GROUPS) * 10 + (i % 10)).padStart(3, "0")}`, qty: i % 97 }));

const treegrid = () => document.querySelector<HTMLElement>('[role="treegrid"]')!;
const groupRows = () => [...treegrid().querySelectorAll<HTMLElement>('[role="row"][data-grid-group-row]')];
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount() {
  const ref = createRef<DataGridApi<Row>>();
  const start = performance.now();
  const screen = await render(
    <div style={{ height: 600, width: 1200 }}>
      <DataGrid ref={ref} columns={columns} data={data} getRowId={(row) => row.id} groupBy={["region"]} defaultPivot={{ columnIds: ["year"] }} className="h-150 w-300" aria-label="Sales" />
    </div>,
  );
  await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(5));
  const mountMs = performance.now() - start;
  await settle();
  return { screen, api: () => ref.current!, mountMs };
}

describe("a client pivot of 100,000 rows into 5,000 group rows x 200 generated columns", () => {
  it("mounts with the held set at the cell cap", { timeout: 120_000 }, async ({ annotate }) => {
    const { screen, api, mountMs } = await mount();
    const s = api().store.getState();
    expect(s.pivot?.columns).toHaveLength(KEYS);
    expect(s.viewIndex).toHaveLength(GROUPS);
    await annotate(`perf client pivot mount: ${Math.round(mountMs)}ms`);
    await screen.unmount();
  });

  it.for<"vertical" | "horizontal">(["vertical", "horizontal"])("keeps a %s fling within the long-task budget", { timeout: 120_000 }, async (direction, { annotate }) => {
    const { screen } = await mount();
    const grid = treegrid();
    await measureScrollLongTasks(grid, 240, 30, direction);
    const { count, totalMs } = await measureScrollLongTasks(grid, 240, 240, direction);
    await settle();
    await annotate(`perf client pivot ${direction} fling: longTasks=${count} total=${Math.round(totalMs)}ms`);
    expect(totalMs).toBeLessThan(longTaskBudgetMs());
    expect(direction === "vertical" ? grid.scrollTop : grid.scrollLeft).toBeGreaterThan(0);
    await screen.unmount();
  });

  it("re-renders only the group row that holds an edited row, and no header cell", { timeout: 120_000 }, async ({ annotate }) => {
    const tracker = trackRenders();
    const { screen, api } = await mount();
    const generated = api().store.getState().pivot!.columns;
    tracker.reset();
    api().actions.updateCells([{ rowId: "r2", columnId: "qty", value: 1_000 }], { source: "stream" });
    await settle();
    const snapshot = tracker.snapshot();
    await annotate(`perf client pivot one edit: renders=${JSON.stringify(snapshot)}`);
    expect(tracker.count("DataGridGroupRow")).toBe(1);
    expect(Object.entries(snapshot).filter(([name]) => /Header/.test(name))).toEqual([]);
    expect(api().store.getState().pivot!.columns).toBe(generated);
    await screen.unmount();
  });
});
