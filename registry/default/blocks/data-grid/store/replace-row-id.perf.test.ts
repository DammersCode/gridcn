import { describe, expect, it } from "vitest";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";
import { bestMs, budget } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

type Row = { id: string; name: string };

describe("replaceRowIds at 100k rows", () => {
  it("swaps 1,000 rows in one write well under the per-call cost times 1,000", () => {
    const data: Row[] = Array.from({ length: 100_000 }, (_, i) => ({ id: `r${i}`, name: `n${i}` }));
    const store = createDataGridStore({ data, columns: [{ id: "name", header: "Name", accessorKey: "name" }], getRowId: (row: unknown) => (row as Row).id } as InternalSyncProps);
    const swaps = Array.from({ length: 1000 }, (_, i) => ({ oldId: `r${i * 50}`, row: { id: `s${i}`, name: "x" } }));
    const plainSwapMs = bestMs(() => {
      const indexById = new Map(data.map((row, index) => [row.id, index]));
      const next = data.slice();
      for (const swap of swaps) next[indexById.get(swap.oldId)!] = swap.row;
      return next;
    });
    const start = performance.now();
    store.getState().actions.replaceRowIds(swaps);
    const elapsed = performance.now() - start;
    expect((store.getState().data[0] as Row).id).toBe("s0");
    expect((store.getState().data[1] as Row).id).toBe("r1");
    expect(elapsed).toBeLessThan(budget({ floor: 70, cap: 210, k: 4, reference: plainSwapMs }));
  });
});
