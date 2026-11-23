import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { StoreApi } from "zustand/vanilla";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataGridBody, DataGridProvider, DataGridRoot } from "@/registry/default/blocks/data-grid/data-grid";
import { groupIdOf, groupKeyText, useDataGridStoreApi, type GroupKey } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { groupKeyOf } from "@/registry/default/blocks/data-grid/store/group-state";
import type { DataGridStoreState } from "@/registry/default/blocks/data-grid/store";
import { pivotCellOf } from "@/registry/default/blocks/data-grid/store/pivot-view";
import { useDataGridServerRows, type UseDataGridServerRowsResult } from "@/registry/default/blocks/data-grid-server/use-data-grid-server-rows";
import type { ServerRowsRequest } from "@/registry/default/blocks/data-grid-server/read-answer";
import { oracleClientPivot, type OraclePath } from "../server-query/client-oracle";
import type { FixtureRow } from "../server-query/fixture";
import { mountMode, type Row as ModeRow } from "./modes";

type PivotRow = { id: string; name: string | null; tag: string; score: number | null; qty: number; active: boolean | null; price: number };

const columns = [
  { id: "tag", header: "Tag", accessorKey: "tag" },
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number", aggregate: "sum" },
  { id: "score", header: "Score", accessorKey: "score", type: "number", aggregate: "avg" },
  { id: "qtyMin", header: "Qty min", accessorFn: (row: PivotRow) => row.qty, type: "number", aggregate: "min" },
  { id: "qtyMax", header: "Qty max", accessorFn: (row: PivotRow) => row.qty, type: "number", aggregate: "max" },
  { id: "nameCount", header: "Names", accessorKey: "name", aggregate: "count" },
];
const VALUES = [
  { columnId: "qty", reducer: "sum" },
  { columnId: "score", reducer: "avg" },
  { columnId: "qtyMin", reducer: "min" },
  { columnId: "qtyMax", reducer: "max" },
  { columnId: "nameCount", reducer: "count" },
] as const;

const NAMES = ["ada", "", "bob", null, "Cleo", "dan"] as const;
const makeRows = (count: number, qtyOf: (i: number) => number): PivotRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    name: NAMES[i % NAMES.length]!,
    tag: ["red", "green", "blue"][i % 3]!,
    score: i % 7 === 0 ? null : ((i * 37) % 101) / 3,
    qty: qtyOf(i),
    active: i % 5 === 0 ? null : i % 2 === 0,
    price: i,
  }));

type Scenario = { title: string; groupBy: string[]; pivot: string; rows: PivotRow[]; textKeys?: boolean };
const SCENARIOS: Scenario[] = [
  { title: "1 level by a checkbox key", groupBy: ["tag"], pivot: "active", rows: makeRows(60, (i) => i % 4) },
  { title: "3 levels by a number key", groupBy: ["tag", "active", "name"], pivot: "qty", rows: makeRows(90, (i) => (i * 3) % 5) },
  { title: "a key set past the cap", groupBy: ["tag"], pivot: "qty", rows: makeRows(250, (i) => i) },
  { title: "empty and null text keys", groupBy: ["tag"], pivot: "name", rows: makeRows(48, (i) => i % 3), textKeys: true },
];

/** Every group row's cells by generated column id, keyed by group id. */
type CellMap = Record<string, Record<string, number | null>>;

function gridCells(s: DataGridStoreState): CellMap {
  const out: CellMap = {};
  for (const node of s.groupLayout?.rows ?? []) out[node.id] = Object.fromEntries((s.pivot?.columns ?? []).map((column) => [column.id, pivotCellOf(node, column)]));
  return out;
}

function oracleCells(scenario: Scenario, depth = scenario.groupBy.length): { cells: CellMap; omitted: number } {
  const cells: CellMap = {};
  let omitted = 0;
  const generatedIds: string[] = [];
  const visit = (path: OraclePath): void => {
    const answer = oracleClientPivot({ filters: [], groupBy: scenario.groupBy, path, aggregates: VALUES, pivot: scenario.pivot, rows: scenario.rows as unknown as FixtureRow[] });
    if (path.length === 0) {
      omitted = answer.pivotOmitted;
      for (const descriptor of answer.pivotColumns) generatedIds.push(pivotId(scenario.pivot, descriptor.path[0]!, VALUES[descriptor.valueIndex]!));
    }
    for (const group of answer.groups) {
      const here = [...path, { columnId: scenario.groupBy[path.length]!, key: group.key }];
      cells[groupIdOf(here)] = Object.fromEntries(group.pivotCells.map((cell, i) => [generatedIds[i]!, cell]));
      if (here.length < depth) visit(here);
    }
  };
  visit([]);
  return { cells, omitted };
}

const pivotId = (columnId: string, key: GroupKey, value: (typeof VALUES)[number]) => `__pivot:${encodeURIComponent(columnId)}=${encodeURIComponent(groupKeyText(key))}|${encodeURIComponent(value.columnId)}=${value.reducer}`;

const topLevel = (cells: CellMap): CellMap => Object.fromEntries(Object.entries(cells).filter(([id]) => !id.includes("/")));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});

afterEach(cleanup);

async function mountClient(mode: "L" | "PC", scenario: Scenario) {
  return mountMode(mode, {
    rows: scenario.rows as unknown as ModeRow[],
    Child: DataGridBody,
    props: { columns, defaultGroupBy: scenario.groupBy, defaultPivot: { columnIds: [scenario.pivot] }, defaultExpanded: { mode: "expanded", ids: [] } },
  });
}

function oracleServer(rows: readonly PivotRow[]) {
  const textOf = (row: PivotRow, columnId: string) => groupKeyText(groupKeyOf((row as Record<string, unknown>)[columnId]));
  return vi.fn((request: ServerRowsRequest<never>) => {
    const { spec, start, end, groupPath = [] } = request;
    const groupBy = spec.groupBy ?? [];
    const path = groupPath.map(({ columnId, key }) => ({ columnId, key }));
    const answer = oracleClientPivot({ filters: [], groupBy, path, aggregates: spec.aggregates as never, pivot: spec.pivot!.columnIds[0]!, rows: rows as unknown as FixtureRow[] });
    const inside = rows.filter((row) => path.every((segment) => textOf(row, segment.columnId) === groupKeyText(segment.key)));
    const level = path.length;
    const groups = answer.groups.slice(start, end).map((group) => {
      const members = inside.filter((row) => textOf(row, groupBy[level]!) === groupKeyText(group.key));
      const childCount = level + 1 === groupBy.length ? 0 : new Set(members.map((row) => textOf(row, groupBy[level + 1]!))).size;
      return { key: group.key, childCount, totalRowCount: members.length, pivotCells: group.pivotCells };
    });
    return Promise.resolve({ groups, groupCount: answer.groups.length, ...(level === 0 ? { totalRowCount: inside.length } : null), pivotColumns: answer.pivotColumns, pivotOmitted: answer.pivotOmitted });
  });
}

async function mountServer(scenario: Scenario) {
  const fetchRows = oracleServer(scenario.rows);
  let store!: StoreApi<DataGridStoreState>;
  let hook!: UseDataGridServerRowsResult<PivotRow>;
  function Probe() {
    store = useDataGridStoreApi() as unknown as StoreApi<DataGridStoreState>;
    return null;
  }
  function Harness() {
    hook = useDataGridServerRows<PivotRow>({
      defaultPageSize: 10,
      fetchRows: fetchRows as never,
      defaultSpec: { groupBy: scenario.groupBy, aggregates: VALUES, pivot: { columnIds: [scenario.pivot] } },
    } as never) as unknown as UseDataGridServerRowsResult<PivotRow>;
    return (
      <DataGridProvider {...hook.providerProps} columns={columns as never}>
        <DataGridRoot aria-label="Rows" {...hook.rootProps}>
          <DataGridBody />
          <Probe />
        </DataGridRoot>
      </DataGridProvider>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(fetchRows).toHaveBeenCalled());
  act(() => hook.providerProps.onRenderedRowsChange?.({ start: 0, end: 12 }));
  await waitFor(() => expect(store.getState().pivot, JSON.stringify({ calls: fetchRows.mock.calls.length, error: String(hook.error), layout: hook.providerProps.groupLayout ?? null }).slice(0, 600)).not.toBeNull());
  return { state: () => store.getState() };
}

describe.each(SCENARIOS)("client pivot parity: $title", (scenario) => {
  const oracle = oracleCells(scenario);

  it.each(["L", "PC"] as const)("mode %s matches the oracle at every level", async (mode) => {
    const grid = await mountClient(mode, scenario);
    const s = grid.state();
    expect(gridCells(s)).toEqual(oracle.cells);
    expect(s.pivot!.omitted).toBe(oracle.omitted);
    expect(s.viewIndex.every((entry) => entry < 0)).toBe(true);
  });

  it("modes L and PC hold the same generated columns in the same order", async () => {
    const local = (await mountClient("L", scenario)).state().pivot!.columns.map((column) => column.id);
    cleanup();
    const paged = (await mountClient("PC", scenario)).state().pivot!.columns.map((column) => column.id);
    expect(paged).toEqual(local);
  });

  it("the server mode shows the same top-level cells as the client modes", async () => {
    const server = await mountServer(scenario);
    const serverIds = server.state().pivot!.columns.map((column) => column.id);
    const serverCells = gridCells(server.state());
    cleanup();
    const local = (await mountClient("L", scenario)).state();
    const localIds = local.pivot!.columns.map((column) => column.id);
    if (scenario.textKeys) expect(new Set(serverIds)).toEqual(new Set(localIds));
    else expect(serverIds).toEqual(localIds);
    expect(serverCells).toEqual(topLevel(gridCells(local)));
  });
});
