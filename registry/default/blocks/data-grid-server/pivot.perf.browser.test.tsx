import { trackRenders } from "@/registry/default/blocks/data-grid/test/render-counter.test-helper";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, defineColumns, type ColumnDef, type ServerSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { budget, plainLoopMs } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";
import { measureScrollLongTasks } from "@/registry/default/blocks/data-grid/test/perf-probe.test-helper";
import { fakeServer, type Answer, type Row } from "./group-fake-server.test-helper";
import { MAX_PIVOT_CELLS } from "./group-lists";
import type { ServerRowsRequest } from "./read-answer";
import { useDataGridServerRows, type UseDataGridServerRowsScrollResult } from "./use-data-grid-server-rows";
import "@/app/global.css";

const GROUPS = 100_000;
const KEYS = 200;
const BLOCK = 200;
const IDLE_LOOP_MS = 3;
// Idle: 0ms of long tasks; perf.browser.test.tsx measured 585-6399ms on a healthy grid in CI, so CI widens the floor tenfold and the budget rises with the same-run loop slowdown.
// The baseline, a grouped grid without pivot of the same size, is recorded for comparison and holds no budget.
const longTaskBudgetMs = () => budget({ floor: 200, cap: 1000, k: 200 / IDLE_LOOP_MS, reference: plainLoopMs(), ciFactor: 10 });

const SUM = { columnId: "qty", reducer: "sum" } as const;
const pivotColumns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 160 },
  { id: "city", header: "City", accessorKey: "city", type: "text", width: 120 },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", width: 100, aggregate: "sum" },
] as const);
const baselineColumns: ColumnDef<Row>[] = [
  ...pivotColumns,
  ...Array.from({ length: KEYS - 1 }, (_, i): ColumnDef<Row> => ({ id: `c${i}`, header: `C${i}`, type: "number", width: 100, accessorFn: (row: Row) => row.qty })),
];

const keys = Array.from({ length: KEYS }, (_, i) => ({ path: [`k${i}`], valueIndex: 0 }));
const cells = Array.from({ length: KEYS }, (_, i) => i);

type Kind = "pivot" | "baseline";
const SPECS: Record<Kind, Partial<ServerSpec>> = {
  pivot: { groupBy: ["region"], aggregates: [SUM], pivot: { columnIds: ["city"] } },
  baseline: { groupBy: ["region"], aggregates: [SUM] },
};

function answerOf(kind: Kind, { start, end }: ServerRowsRequest<never>): Answer {
  const groups = Array.from({ length: Math.min(end, GROUPS) - start }, (_, i) => ({
    key: `g${String(start + i).padStart(6, "0")}`,
    childCount: kind === "pivot" ? 0 : 1,
    totalRowCount: 1,
    aggregates: { qty: start + i },
    ...(kind === "pivot" ? { pivotCells: cells } : null),
  }));
  return { groups, groupCount: GROUPS, totalRowCount: GROUPS, ...(kind === "pivot" ? { pivotColumns: keys, pivotOmitted: 0 } : null) };
}

const serverOf = (kind: Kind) => fakeServer<Row>([], (request) => answerOf(kind, request));
type Server = ReturnType<typeof serverOf>;

function Grid({ kind, server, onServer }: { kind: Kind; server: Server; onServer: (result: UseDataGridServerRowsScrollResult<Row>) => void }) {
  const result = useDataGridServerRows<Row>({ mode: "scroll", fetchRows: server.fetchRows as never, blockSize: BLOCK, loadDelayMs: 0, defaultSpec: SPECS[kind] });
  useEffect(() => {
    onServer(result);
  });
  return (
    <div style={{ height: 600, width: 1200 }}>
      <DataGridProvider {...result.providerProps} columns={kind === "pivot" ? pivotColumns : baselineColumns}>
        <DataGridRoot className="h-150 w-300" aria-label="Sales" {...result.rootProps}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>
  );
}

const treegrid = () => document.querySelector<HTMLElement>('[role="treegrid"]')!;
const groupRows = () => [...treegrid().querySelectorAll<HTMLElement>('[role="row"][data-grid-group-row]')];
const cellsOf = (row: Element) => row.querySelectorAll('[role="gridcell"]').length;
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(kind: Kind) {
  const server = serverOf(kind);
  let latest!: UseDataGridServerRowsScrollResult<Row>;
  const screen = await render(<Grid kind={kind} server={server} onServer={(result) => (latest = result)} />);
  await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(5));
  await settle();
  return { server, screen, latest: () => latest };
}

const heldBytes = (result: UseDataGridServerRowsScrollResult<Row>) => result.gridProps.groupLayout!.rows.reduce((total, slot) => total + (slot.pivotCells?.byteLength ?? 0), 0);

describe("a pivot grid at 100,000 groups x 200 generated columns", () => {
  it.for<Kind>(["pivot", "baseline"])("keeps a vertical fling with group-block eviction within the long-task budget (%s)", { timeout: 120_000 }, async (kind, { annotate }) => {
    const { server, screen, latest } = await mount(kind);
    const grid = treegrid();
    const rowHeight = groupRows()[0]!.getBoundingClientRect().height;
    const holds = (viewRow: number) => latest().gridProps.groupLayout!.rows.some((slot) => slot.viewRow === viewRow);
    await measureScrollLongTasks(grid, 240, 30);
    // Fill the cache to the cap with far blocks, so every block the fling lands evicts one.
    const farBlocks = Array.from({ length: MAX_PIVOT_CELLS / (KEYS * BLOCK) - 2 }, (_, i) => (100 + i) * BLOCK);
    for (const viewRow of farBlocks) {
      grid.scrollTop = (viewRow + BLOCK / 2) * rowHeight;
      await vi.waitFor(() => expect(holds(viewRow)).toBe(true));
    }
    await settle();
    expect(holds(farBlocks[0]!)).toBe(true);
    const callsBefore = server.calls.length;
    const { count, totalMs } = await measureScrollLongTasks(grid, 240, 240);
    await settle();
    const landings = server.calls.length - callsBefore;
    await annotate(`perf ${kind} vertical fling: longTasks=${count} total=${Math.round(totalMs)}ms landings=${landings} heldBytes=${heldBytes(latest())}`);
    if (kind === "pivot") expect(totalMs).toBeLessThan(longTaskBudgetMs());
    expect(landings).toBeGreaterThan(1);
    expect(server.calls.every((call) => call.childKind === "groups")).toBe(true);
    if (kind === "pivot") {
      expect(heldBytes(latest())).toBeLessThanOrEqual(MAX_PIVOT_CELLS * 8);
      expect(holds(farBlocks[0]!)).toBe(false);
    }
    await screen.unmount();
  });

  it.for<Kind>(["pivot", "baseline"])("keeps a horizontal fling within the long-task budget and mounts only the visible columns (%s)", { timeout: 120_000 }, async (kind, { annotate }) => {
    const { screen } = await mount(kind);
    const grid = treegrid();
    const headers = () => grid.querySelectorAll('[role="columnheader"]');
    const cellWidth = headers()[headers().length - 1]!.getBoundingClientRect().width;
    const bound = Math.ceil(grid.clientWidth / cellWidth) + 5;
    const expectOnlyVisibleColumns = () => {
      expect(headers().length).toBeLessThanOrEqual(bound);
      for (const row of groupRows()) expect(cellsOf(row)).toBeLessThanOrEqual(bound);
    };
    expectOnlyVisibleColumns();
    await measureScrollLongTasks(grid, 240, 30, "horizontal");
    const { count, totalMs } = await measureScrollLongTasks(grid, 240, 240, "horizontal");
    await settle();
    await annotate(`perf ${kind} horizontal fling: longTasks=${count} total=${Math.round(totalMs)}ms mountedHeaders=${headers().length} bound=${bound}`);
    if (kind === "pivot") expect(totalMs).toBeLessThan(longTaskBudgetMs());
    expect(grid.scrollLeft).toBeGreaterThan(0);
    expectOnlyVisibleColumns();
    await screen.unmount();
  });

  // The baseline rows re-render on a landing: their aria-setsize counts the loaded groups, because an open group would need the list count.
  it.for<Kind>(["pivot", "baseline"])("re-renders no header cell on one landing, and under pivot only the landed rows (%s)", async (kind, { annotate }) => {
    const tracker = trackRenders();
    const { server, screen } = await mount(kind);
    const grid = treegrid();
    const rowHeight = groupRows()[0]!.getBoundingClientRect().height;
    let held: ServerRowsRequest<never> | undefined;
    let release: () => void = () => {};
    server.fetchRows.mockImplementationOnce((request) => ((held = request), new Promise<Answer>((resolve) => (release = () => resolve(answerOf(kind, request))))));
    grid.scrollTop = (BLOCK - 5) * rowHeight;
    await vi.waitFor(() => expect(held?.start).toBe(BLOCK));
    await settle();
    const before = groupRows().length;
    const lastLoaded = () => groupRows().find((row) => row.getAttribute("aria-posinset") === String(BLOCK))!;
    const setSizeBefore = lastLoaded().getAttribute("aria-setsize");
    tracker.reset();
    release();
    await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(before));
    await settle();
    const landed = groupRows().length - before;
    const snapshot = tracker.snapshot();
    await annotate(`perf ${kind} one landing: landedRows=${landed} groupRowRenders=${tracker.count("DataGridGroupRow")} renders=${JSON.stringify(snapshot)}`);
    // The header layer re-renders with its parent; its memoized cells skip that render.
    expect(Object.entries(snapshot).filter(([name]) => /Header/.test(name) && name !== "DataGridHeader")).toEqual([]);
    if (kind === "pivot") {
      expect(tracker.count("DataGridGroupRow")).toBe(landed);
      expect([setSizeBefore, lastLoaded().getAttribute("aria-setsize")]).toEqual([String(GROUPS), String(GROUPS)]);
    }
    await screen.unmount();
  });
});
