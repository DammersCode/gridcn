import { describe, expect, it, vi } from "vitest";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string; price: number };

const nonNegative = (value: unknown) => ((value as number) < 0 ? "must be >= 0" : null);

const asyncNonNegative = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: async (value: unknown) => ((value as number) < 0 ? { issues: [{ message: "must be >= 0" }] } : { value }),
  },
};

function makeStore(validate: unknown, overrides: Partial<InternalSyncProps> = {}) {
  const order: string[] = [];
  const onDataChange = vi.fn(() => order.push("data"));
  const onValidationError = vi.fn(() => order.push("validation"));
  const store = createDataGridStore({
    data: [
      { id: "a", name: "Alpha", price: 10 },
      { id: "b", name: "Bravo", price: 20 },
    ],
    columns: [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "price", header: "Price", accessorKey: "price", type: "number", validate },
    ],
    getRowId: (row) => (row as Row).id,
    onDataChange,
    onValidationError,
    ...overrides,
  } as InternalSyncProps);
  return { store, order, onDataChange, onValidationError };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("onValidationError for updateCells", () => {
  it("fires with source stream after the accepted cells apply", () => {
    const { store, order, onValidationError } = makeStore(nonNegative);

    store.getState().actions.updateCells([
      { rowId: "a", columnId: "price", value: -1 },
      { rowId: "b", columnId: "price", value: 5 },
    ]);

    expect(order).toEqual(["data", "validation"]);
    expect(onValidationError).toHaveBeenCalledWith({
      source: "stream",
      rejected: [{ rowId: "a", columnId: "price", viewRowIndex: 0, value: -1, message: "must be >= 0" }],
    });
  });

  it("does not fire when every patch passes", () => {
    const { store, onValidationError } = makeStore(nonNegative);

    store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: 1 }]);

    expect(onValidationError).not.toHaveBeenCalled();
  });

  it("reports viewRowIndex -1 for a row outside the view", () => {
    const { store, onValidationError } = makeStore(nonNegative, {
      filterState: [{ filterId: "f", columnId: "name", operator: "equals", value: "Bravo" }],
    });

    store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: -1 }]);

    expect(onValidationError).toHaveBeenCalledWith({
      source: "stream",
      rejected: [{ rowId: "a", columnId: "price", viewRowIndex: -1, value: -1, message: "must be >= 0" }],
    });
  });

  it("fires the async rejections after the held batch applies", async () => {
    const { store, order, onValidationError } = makeStore(asyncNonNegative);

    store.getState().actions.updateCells([
      { rowId: "a", columnId: "price", value: 7 },
      { rowId: "b", columnId: "price", value: -3 },
    ]);
    expect(onValidationError).not.toHaveBeenCalled();
    await settle();

    expect(order).toEqual(["data", "validation"]);
    expect(onValidationError).toHaveBeenCalledWith({
      source: "stream",
      rejected: [{ rowId: "b", columnId: "price", viewRowIndex: 1, value: -3, message: "must be >= 0" }],
    });
  });

  it("fires when an async batch rejects every patch", async () => {
    const { store, onDataChange, onValidationError } = makeStore(asyncNonNegative);

    store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: -1 }]);
    await settle();

    expect(onDataChange).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledTimes(1);
  });

  it("fires nothing for an async batch that a newer updateCells supersedes", async () => {
    const { store, onValidationError } = makeStore(asyncNonNegative);

    store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: -1 }]);
    store.getState().actions.updateCells([{ rowId: "b", columnId: "price", value: -2 }]);
    await settle();

    expect(onValidationError).toHaveBeenCalledTimes(1);
    expect(onValidationError).toHaveBeenCalledWith({
      source: "stream",
      rejected: [{ rowId: "b", columnId: "price", viewRowIndex: 1, value: -2, message: "must be >= 0" }],
    });
  });

  it("drops the async rejections of a batch that a read-only grid never applies", async () => {
    const { store, onValidationError } = makeStore(asyncNonNegative);

    store.getState().actions.updateCells([{ rowId: "a", columnId: "price", value: -1 }]);
    store.getState().actions._registerReadOnly(true);
    await settle();

    expect(onValidationError).not.toHaveBeenCalled();
  });
});

describe("onValidationError cost on a streaming tick", () => {
  // Shared CI runners are several times slower; the ceiling guards the order of magnitude.
  const CI_FACTOR = process.env["CI"] ? 3 : 1;

  it("resolves view rows only for the rejected cells (100k sorted rows)", () => {
    const data = Array.from({ length: 100_000 }, (_, i) => ({ id: `r${i}`, name: `n${i}`, price: i }));
    const store = createDataGridStore({
      data,
      columns: [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "price", header: "Price", accessorKey: "price", type: "number", validate: nonNegative },
      ],
      getRowId: (row) => (row as Row).id,
      sortState: [{ columnId: "name", direction: "desc" }],
      onValidationError: () => {},
    } as InternalSyncProps);
    const ticks = 100;
    const start = performance.now();
    for (let tick = 0; tick < ticks; tick++) {
      store.getState().actions.updateCells([
        { rowId: `r${tick}`, columnId: "price", value: -1 },
        { rowId: `r${tick + 1}`, columnId: "price", value: tick },
      ]);
    }
    const perTick = (performance.now() - start) / ticks;
    expect(perTick).toBeLessThan(2 * CI_FACTOR);
  });
});
