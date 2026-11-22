import { describe, expect, it } from "vitest";
import { createDataGridStore } from "./create-store";
import type { DataChange } from "../types";
import type { InternalSyncProps } from "./types";
import { bestMs, budget } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

type Row = { id: string; name: string };

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

/** The store's Map and row-copy mix for `count` pending saves, without its code. */
function plainSaveCycle(count: number): number {
  const rows = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `n${i}` }));
  const status = new Map<string, string>();
  for (const row of rows) status.set(row.id, "saving");
  const next = rows.map((row) => ({ ...row, name: `x${row.name}` }));
  for (const row of next) status.delete(row.id);
  return next.length + status.size;
}

function setup(count: number, onSave: (change: DataChange<unknown>) => Promise<unknown>) {
  const data: Row[] = Array.from({ length: count }, (_, i) => ({ id: `r${i}`, name: `n${i}` }));
  const store = createDataGridStore({ data, columns: [{ id: "name", header: "Name", accessorKey: "name" }], getRowId: (row: unknown) => (row as Row).id, onSave } as InternalSyncProps);
  return store;
}

describe("save settle at scale", () => {
  it("settles a fully refused 20k-row change in linear time", async () => {
    const store = setup(20_000, () => Promise.reject(new Error("no")));
    const plainSettleMs = bestMs(() => plainSaveCycle(20_000));
    const start = performance.now();
    store.getState().actions.applyCellUpdates(
      Array.from({ length: 20_000 }, (_, i) => ({ viewRowIndex: i, columnId: "name", value: `x${i}` })),
      "paste",
    );
    await flush();
    await flush();
    const elapsed = performance.now() - start;
    expect((store.getState().data[0] as Row).name).toBe("n0");
    expect(elapsed).toBeLessThan(budget({ floor: 650, cap: 1950, k: 100, reference: plainSettleMs }));
  });

  it("swaps 5k rows while their save is in flight in linear time", async () => {
    let release!: () => void;
    const store = setup(20_000, () => new Promise((res) => void (release = () => res(undefined))));
    store.getState().actions.applyCellUpdates(
      Array.from({ length: 5000 }, (_, i) => ({ viewRowIndex: i, columnId: "name", value: `x${i}` })),
      "paste",
    );
    const plainSettleMs = bestMs(() => plainSaveCycle(5000));
    const start = performance.now();
    store.getState().actions.replaceRowIds(Array.from({ length: 5000 }, (_, i) => ({ oldId: `r${i}`, row: { id: `s${i}`, name: `x${i}` } })));
    const elapsed = performance.now() - start;
    release();
    await flush();
    expect(store.getState().pendingSaveCount).toBe(0);
    expect(store.getState().saveStatus.size).toBe(0);
    expect(elapsed).toBeLessThan(budget({ floor: 45, cap: 135, k: 30, reference: plainSettleMs }));
  });
});
