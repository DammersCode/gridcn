import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { DataGridProvider, useDataGridApi, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { planReplace } from "./plan-replace";

const CI_FACTOR = process.env["CI"] ? 2 : 1;
const ROWS = 100_000;
const COLUMN_IDS = Array.from({ length: 10 }, (_, i) => `c${i}`);
const columns = COLUMN_IDS.map((id) => ({ id, header: id, accessorKey: id })) as AnyColumnDef[];

type Row = Record<string, string>;

function makeRows(): Row[] {
  return Array.from({ length: ROWS }, (_, r) => {
    const row: Row = { id: String(r) };
    for (const id of COLUMN_IDS) row[id] = `value ${r} ${id}`;
    return row;
  });
}

function wrapperFor(data: Row[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DataGridProvider data={data} columns={columns} getRowId={(r: unknown) => (r as Row)["id"]!}>
        {children}
      </DataGridProvider>
    );
  };
}

function useHarness() {
  const api = useDataGridApi();
  return { actions: api.actions, store: api.store };
}

describe("find and replace performance at 100k rows", () => {
  it("scans every cell without a match within budget", () => {
    const { result } = renderHook(useHarness, { wrapper: wrapperFor(makeRows()) });
    const state = result.current.store.getState();
    const start = performance.now();
    const plan = planReplace(state, "zzz-not-found", "x", {});
    const elapsed = performance.now() - start;
    expect(plan.patches).toHaveLength(0);
    expect(elapsed).toBeLessThan(BUDGET_SCAN_MS * CI_FACTOR);
  });

  it("plans and writes 10,000 replacements within budget", () => {
    const { result } = renderHook(useHarness, { wrapper: wrapperFor(makeRows()) });
    const state = result.current.store.getState();
    const start = performance.now();
    const plan = planReplace(state, "value 1", "item 1", { replaceAllLimit: 10_000 });
    const planned = performance.now() - start;
    expect(plan.patches).toHaveLength(10_000);
    expect(plan.remaining).toBe(true);
    let applied = 0;
    const writeStart = performance.now();
    act(() => {
      applied = result.current.actions.updateCells(plan.patches, { source: "replace", reorder: "defer" }).applied;
    });
    const written = performance.now() - writeStart;
    expect(applied).toBe(10_000);
    expect(planned + written).toBeLessThan(BUDGET_REPLACE_MS * CI_FACTOR);
  });
});

const BUDGET_SCAN_MS = 700;
const BUDGET_REPLACE_MS = 250;
