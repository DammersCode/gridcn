import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import { EMPTY_GATES_PENDING } from "./gate-signal";
import type { InternalSyncProps } from "./types";
import { ciFactor } from "@/registry/default/blocks/data-grid/test/perf-budget.test-helper";

const ROW_COUNT = 100_000;
const CI_FACTOR = ciFactor(2);

type Row = { id: string; name: string };

describe("validateRow on the sync path", () => {
  it("creates no AbortController and publishes no pending state for 100k touched rows", () => {
    const data: Row[] = Array.from({ length: ROW_COUNT }, (_, i) => ({ id: `r${i}`, name: "" }));
    const validateRow = vi.fn(() => null);
    const store = createDataGridStore({
      data,
      columns: [{ id: "name", header: "Name", accessorKey: "name" }],
      getRowId: (row: unknown) => (row as Row).id,
      validateRow,
    } as InternalSyncProps);
    const controllers = vi.spyOn(globalThis, "AbortController");
    const updates = data.map((row) => ({ rowId: row.id, columnId: "name", value: "x" }));
    const start = performance.now();
    store.getState().actions.updateCells(updates, { source: "stream" });
    const elapsed = performance.now() - start;
    controllers.mockRestore();
    expect(validateRow).toHaveBeenCalledTimes(ROW_COUNT);
    expect(controllers).not.toHaveBeenCalled();
    expect(store.getState().gatesPending).toBe(EMPTY_GATES_PENDING);
    expect(elapsed).toBeLessThan(4000 * CI_FACTOR);
  });
});
