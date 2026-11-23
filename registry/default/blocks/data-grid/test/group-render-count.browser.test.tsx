import { trackRenders, type RenderTracker } from "./render-counter.test-helper";
import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "../data-grid";
import type { ServerGroupLayout } from "../data-grid-sdk";
import { groupIdOf } from "../store/group-state";
import "@/app/global.css";

type Row = { id: string; region: string; country: string; year: number; amount: number };

const columns = defineColumns<Row>()([
  { id: "region", header: "Region", accessorKey: "region", type: "text", width: 180 },
  { id: "country", header: "Country", accessorKey: "country", type: "text" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
] as const);

const TREE = [
  ["EU", ["DE", "FR", "IT"]],
  ["US", ["CA", "NY"]],
  ["APAC", ["JP", "AU"]],
] as const;
const GROUP_BY = ["region", "country"];
const KEYS = [2023, 2024, 2025];

const data: Row[] = TREE.flatMap(([region, countries]) => countries.flatMap((country) => KEYS.map((year, i) => ({ id: `${country}-${year}`, region, country, year, amount: i + 1 }))));

// Every region open but the last, so a toggle opens a closed row in each grid.
const shown = TREE.flatMap(([region, countries], i) => [
  { path: [{ columnId: "region", key: region }], childCount: countries.length },
  ...(i === TREE.length - 1 ? [] : countries.map((country) => ({ path: [{ columnId: "region", key: region }, { columnId: "country", key: country }], childCount: 0 }))),
]);
const OPEN = { mode: "collapsed" as const, ids: TREE.slice(0, -1).map(([region]) => groupIdOf([{ columnId: "region", key: region }])) };

const serverLayout = (pivot: boolean): ServerGroupLayout => ({
  rows: shown.map((slot, viewRow) => ({ ...slot, viewRow, count: 3, ...(pivot ? { pivotCells: Float64Array.from(KEYS, (_, i) => viewRow * 10 + i) } : null) })),
  leafCount: data.length,
  ...(pivot ? { pivot: { columnId: "year", values: [{ columnId: "amount", reducer: "sum" }], columns: KEYS.map((key) => ({ path: [key], valueIndex: 0 })), omitted: 0 } } : null),
});

const placeholder: Row = { id: "", region: "", country: "", year: 0, amount: 0 };
const RENDERED = ["DataGridGroupRow", "GroupCell", "DataGridGroupToggle", "DataGridRow", "DataGridCellImpl"];

const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const groupRows = () => [...document.querySelectorAll<HTMLElement>('[role="row"][data-grid-group-row]')];
const total = (tracker: RenderTracker) => RENDERED.reduce((sum, name) => sum + tracker.count(name), 0);

type Kind = "client groups" | "server groups" | "nested pivot" | "client pivot";

function Grid({ kind }: { kind: Kind }) {
  const common = { columns, getRowId: (row: Row, i: number) => row.id || `slot-${i}`, groupBy: GROUP_BY, className: "h-[480px]", "aria-label": kind } as const;
  if (kind === "client groups") return <DataGrid {...common} data={data} defaultExpanded={OPEN} />;
  if (kind === "client pivot") return <DataGrid {...common} data={data} defaultExpanded={OPEN} defaultPivot={{ columnIds: ["year"] }} />;
  const layout = serverLayout(kind === "nested pivot");
  return <DataGrid {...common} data={layout.rows.map(() => placeholder)} groupLayout={layout} defaultExpanded={OPEN} />;
}

/** Renders per step, each relative to the mount of the same grid in the same run. */
async function measure(kind: Kind) {
  const tracker = trackRenders();
  const screen = await render(<Grid kind={kind} />);
  await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(TREE.length));
  await frames();
  const mount = total(tracker);

  tracker.reset();
  const toggleButton = groupRows().findLast((row) => row.querySelector("[data-grid-group-toggle]"))?.querySelector<HTMLElement>("[data-grid-group-toggle]");
  if (!toggleButton) throw new Error(`${kind}: no group row has a toggle`);
  toggleButton.click();
  await frames();
  const toggle = total(tracker);

  groupRows()[0]!.querySelectorAll<HTMLElement>('[role="gridcell"]')[1]!.click();
  await frames();
  tracker.reset();
  await userEvent.keyboard("{ArrowDown}");
  await frames();
  const move = total(tracker);

  groupRows()[0]!.querySelectorAll<HTMLElement>('[role="gridcell"]')[1]!.click();
  await frames();
  tracker.reset();
  await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
  await frames();
  const labelMove = total(tracker);
  await screen.unmount();
  return { mount, toggle: toggle / mount, move: move / mount, labelMove: labelMove / mount };
}

// Each bound is a share of the same grid's mount renders; the compiled build sets the move bounds.
const BOUNDS = {
  // A client toggle rebuilds the view: at most 19 of the 32 mount renders.
  clientToggle: 19 / 32,
  // A server toggle re-renders the toggled row, its cells, and its toggle only.
  serverToggle: 4 / 32,
  pivotToggle: 6 / 43,
  // A move re-renders the row the cursor leaves and the row it enters.
  groupMove: 8 / 32,
  pivotMove: 11 / 43,
  // A client pivot toggle lays out the kept tree again; its rows keep their nodes, so only the toggled row re-renders.
  clientPivotToggle: 6 / 43,
  clientPivotMove: 12 / 43,
  // Three generated columns and the toggles of the outer rows.
  pivotMountPerServerMount: 43 / 32,
};

describe("render counts of grouped grids", () => {
  it("stay within their share of the same grid's mount for a toggle and a move", async () => {
    const client = await measure("client groups");
    const server = await measure("server groups");
    const pivot = await measure("nested pivot");
    const clientPivot = await measure("client pivot");
    expect([client.toggle, server.toggle, pivot.toggle, client.move, server.move, pivot.move].every((share) => share > 0)).toBe(true);
    expect(client.toggle).toBeLessThanOrEqual(BOUNDS.clientToggle);
    expect(server.toggle).toBeLessThanOrEqual(BOUNDS.serverToggle);
    expect(pivot.toggle).toBeLessThanOrEqual(BOUNDS.pivotToggle);
    expect(Math.max(client.move, server.move)).toBeLessThanOrEqual(BOUNDS.groupMove);
    expect(Math.min(client.labelMove, server.labelMove)).toBeGreaterThan(0);
    expect(Math.max(client.labelMove, server.labelMove)).toBeLessThanOrEqual(BOUNDS.groupMove);
    expect(pivot.move).toBeLessThanOrEqual(BOUNDS.pivotMove);
    expect(client.mount).toBeLessThanOrEqual(server.mount);
    expect(pivot.mount / server.mount).toBeLessThanOrEqual(BOUNDS.pivotMountPerServerMount);
    expect(clientPivot.toggle).toBeGreaterThan(0);
    expect(clientPivot.toggle).toBeLessThanOrEqual(BOUNDS.clientPivotToggle);
    expect(clientPivot.move).toBeLessThanOrEqual(BOUNDS.clientPivotMove);
    expect(clientPivot.mount).toBeLessThanOrEqual(pivot.mount);
  });
});
