import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { createDataGridStore } from "./create-store";
import { getInternalActions } from "./internal-actions";
import type { InternalSyncProps } from "./types";

type Row = { id: string; name: string };

const columns = (name: Partial<ColumnDef<Row, unknown>> = {}): readonly ColumnDef<Row, unknown>[] => [
  { id: "id", header: "ID", accessorKey: "id", type: "text" },
  { id: "name", header: "Name", accessorKey: "name", type: "text", ...name },
];

const props = (cols: readonly ColumnDef<Row, unknown>[], extra: object = {}) =>
  ({ data: [{ id: "1", name: "a" }], columns: cols, getRowId: (r: Row) => r.id, ...extra }) as unknown as InternalSyncProps;

const setup = (initial: readonly ColumnDef<Row, unknown>[], extra: object = {}) => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const store = createDataGridStore(props(initial, extra) as never);
  const sync = (cols: readonly ColumnDef<Row, unknown>[]) => getInternalActions(store)._syncProps(props(cols, extra));
  const seedWarnings = () => warn.mock.calls.filter((call) => String(call[0]).includes("keeps its runtime"));
  return { store, sync, seedWarnings };
};

afterEach(() => vi.restoreAllMocks());

describe("a changed def pin or hidden on a known column id", () => {
  it("warns once with the column id and the action to use", () => {
    const { sync, seedWarnings } = setup(columns({ pin: "start" }));
    sync(columns());
    sync(columns({ pin: "end" }));
    expect(seedWarnings()).toHaveLength(1);
    expect(String(seedWarnings()[0]![0])).toContain('"name"');
    expect(String(seedWarnings()[0]![0])).toContain("setColumnPin");
  });

  it("stays silent for a new array with equal pins", () => {
    const { sync, seedWarnings } = setup(columns({ pin: "start" }));
    sync(columns({ pin: "start" }));
    expect(seedWarnings()).toHaveLength(0);
  });

  it("stays silent after setColumnPin, because the defs are compared with each other", () => {
    const { store, sync, seedWarnings } = setup(columns({ pin: "start" }));
    store.getState().actions.setColumnPin("name", null);
    sync(columns({ pin: "start" }));
    expect(seedWarnings()).toHaveLength(0);
  });

  it("stays silent under a controlled columnLayout", () => {
    const { sync, seedWarnings } = setup(columns({ pin: "start" }), { columnLayout: { pins: { name: "start" } } });
    sync(columns());
    expect(seedWarnings()).toHaveLength(0);
  });

  it("warns for a changed hidden with setColumnHidden", () => {
    const { sync, seedWarnings } = setup(columns({ hidden: true }));
    sync(columns({ hidden: false }));
    expect(seedWarnings()).toHaveLength(1);
    expect(String(seedWarnings()[0]![0])).toContain("setColumnHidden");
  });
});
