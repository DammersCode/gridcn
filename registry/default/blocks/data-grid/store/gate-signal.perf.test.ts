import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import { EMPTY_GATES_PENDING } from "./gate-signal";
import type { InternalSyncProps } from "./types";

const ROW_COUNT = 100_000;
const CI_FACTOR = process.env["CI"] ? 2 : 1;

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
    store.getState().actions.updateCells(updates);
    const elapsed = performance.now() - start;
    controllers.mockRestore();
    expect(validateRow).toHaveBeenCalledTimes(ROW_COUNT);
    expect(controllers).not.toHaveBeenCalled();
    expect(store.getState().gatesPending).toBe(EMPTY_GATES_PENDING);
    expect(elapsed).toBeLessThan(4000 * CI_FACTOR);
  });
});
