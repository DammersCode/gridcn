import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name", type: "text" }];
const data: readonly Row[] = [{ id: "a", name: "A" }, { id: "b", name: "B" }];

const makeStore = (extra: Partial<InternalSyncProps> = {}) =>
  createDataGridStore({ data, columns, getRowId: (row: Row) => row.id, ...extra } as InternalSyncProps);

const warnings = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter((call) => String(call[0]).includes("is controlled"));

afterEach(() => vi.restoreAllMocks());

describe("controlled data without onDataChange", () => {
  it("warns once per grid on the first write", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = makeStore();
    store.getState().actions.commitCellValue({ rowId: "a", columnId: "name" }, "X");
    store.getState().actions.commitCellValue({ rowId: "b", columnId: "name" }, "Y");
    expect(warnings(warn)).toHaveLength(1);
  });

  it("stays quiet when onDataChange receives the change", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = makeStore({ onDataChange: vi.fn() });
    store.getState().actions.commitCellValue({ rowId: "a", columnId: "name" }, "X");
    expect(warnings(warn)).toHaveLength(0);
  });

  it("stays quiet when onSave receives the change", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = makeStore({ onSave: vi.fn() });
    store.getState().actions.commitCellValue({ rowId: "a", columnId: "name" }, "X");
    expect(warnings(warn)).toHaveLength(0);
  });

  it("stays quiet for uncontrolled data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = makeStore({ data: undefined, defaultData: data });
    store.getState().actions.commitCellValue({ rowId: "a", columnId: "name" }, "X");
    expect(warnings(warn)).toHaveLength(0);
  });
});
