import { describe, expect, it } from "vitest";
import type { ColumnDef } from "../types";
import type { ServerGroupLayout } from "../group-types";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

type Row = { id: string; region: string };
const columns: ColumnDef<Row, unknown>[] = [{ id: "region", header: "Region", accessorKey: "region", type: "text" }];
const placeholder: Row = { id: "", region: "" };
const layout: ServerGroupLayout = { rows: [{ viewRow: 0, path: [{ columnId: "region", key: "EU" }], count: 2, childCount: 2 }], leafCount: 2 };

function make(props: Partial<InternalSyncProps> = {}) {
  const store = createDataGridStore({
    data: [placeholder, { id: "1", region: "EU" }, { id: "2", region: "EU" }],
    columns,
    getRowId: (row: Row, index: number) => row.id || `slot-${index}`,
    createRow: () => ({ id: "n", region: "EU" }),
    groupBy: ["region"],
    groupLayout: layout,
    ...props,
  } as unknown as InternalSyncProps);
  return store.getState().actions;
}

describe("row operations while the server lays out the groups", () => {
  it("refuses every one with server-groups", () => {
    const actions = make();
    expect(actions.insertRows(1, 1, "below")).toEqual({ ok: false, reason: "server-groups" });
    expect(actions.duplicateRowsAt([1])).toEqual({ ok: false, reason: "server-groups" });
    expect(actions.deleteRowsAt([1])).toEqual({ ok: false, reason: "server-groups" });
    expect(actions.reorderRows(1, 2)).toBe(false);
    expect(actions.moveRowsBy([1], 1)).toBe(false);
  });

  it("reports the skip through onRowActionSkipped", () => {
    const skipped: unknown[] = [];
    const actions = make({ onRowActionSkipped: (event: unknown) => skipped.push(event) } as never);
    actions.deleteRowsAt([1]);
    expect(skipped).toMatchObject([{ action: "deleteRows", reason: "server-groups" }]);
  });

  it("leaves a grid without a server layout alone", () => {
    const actions = make({ groupBy: undefined, groupLayout: undefined });
    expect(actions.insertRows(1, 1, "below")).not.toMatchObject({ reason: "server-groups" });
  });
});
