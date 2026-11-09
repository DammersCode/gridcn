import { describe, expect, it } from "vitest";
import type { ColumnDef, DataChange } from "../types";
import { buildRollback, rebaseOntoCurrent } from "./rollback";

type Row = { id: string; name: string };

const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];
const getRowId = (row: Row) => row.id;
const data: (Row | undefined)[] = [{ id: "a", name: "new" }, undefined, { id: "c", name: "c" }];
const source = { data, getRowId, columns };

const change: DataChange<Row> = {
  source: "edit",
  ops: [{ type: "update", rowId: "a", row: { id: "a", name: "new" }, prev: { id: "a", name: "old" }, cells: [{ columnId: "name", value: "new", prev: "old" }] }],
};

describe("lazy holes in the rows the history reads", () => {
  it("buildRollback skips an unloaded slot and reverts the loaded row", () => {
    const rollback = buildRollback(change, source);
    expect(rollback.ops).toMatchObject([{ type: "update", rowId: "a", row: { name: "old" } }]);
  });

  it("rebaseOntoCurrent skips an unloaded slot", () => {
    expect(rebaseOntoCurrent(change, source).ops).toMatchObject([{ type: "update", rowId: "a" }]);
  });
});
