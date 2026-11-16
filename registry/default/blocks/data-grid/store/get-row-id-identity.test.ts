import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import type { InternalSyncProps } from "./types";

type Row = { id: string; key: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "id", header: "ID", accessorKey: "id", type: "text" }];
const data: readonly Row[] = [
  { id: "a", key: "k-a" },
  { id: "b", key: "k-b" },
  { id: "c", key: "k-c" },
];

describe("syncing an inline getRowId", () => {
  it("keeps the store state when the new function returns the same ids", () => {
    const store = createDataGridStore({ data, columns, getRowId: (row: Row) => row.id } as InternalSyncProps);
    const before = store.getState();

    getInternalActions(store)._syncProps({ data, columns, getRowId: (row: Row) => row.id } as InternalSyncProps);

    expect(store.getState()).toBe(before);
  });

  it("adopts a new function that returns other ids", () => {
    const store = createDataGridStore({ data, columns, getRowId: (row: Row) => row.id } as InternalSyncProps);
    const swapped = (row: Row) => row.key;

    getInternalActions(store)._syncProps({ data, columns, getRowId: swapped } as InternalSyncProps);

    expect(store.getState().getRowId).toBe(swapped);
  });

  it("adopts a new function together with a new data array", () => {
    const store = createDataGridStore({ data, columns, getRowId: (row: Row) => row.id } as InternalSyncProps);
    const next = (row: Row) => row.id;

    getInternalActions(store)._syncProps({ data: [...data], columns, getRowId: next } as InternalSyncProps);

    expect(store.getState().getRowId).toBe(next);
  });
});

describe("the getRowId swap warning", () => {
  const swapWarning = (init: object) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createDataGridStore({ columns, getRowId: (row: Row) => row.id, ...init } as InternalSyncProps);
    getInternalActions(store)._syncProps({ ...init, columns, getRowId: (row: Row) => row.key } as InternalSyncProps);
    const message = warn.mock.calls.map(([m]) => String(m)).find((m) => m.includes("getRowId returns other ids"));
    warn.mockRestore();
    return message;
  };

  it("tells a controlled grid to pass a new data array", () => {
    expect(swapWarning({ data })).toContain("pass a new data array");
  });

  it("an uncontrolled getRowId swap warns with the remount advice", () => {
    expect(swapWarning({ defaultData: data })).toContain("remount the grid with a new `key`");
  });
});
