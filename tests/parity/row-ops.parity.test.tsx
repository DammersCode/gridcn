import { describe, expect, it } from "vitest";
import { ALL_MODES, mountMode } from "./modes";

const loaded = (ids: string[]) => ids.filter((id) => id !== "");

describe.each(ALL_MODES)("row operations in mode %s", (mode) => {
  it("insertRow adds one created row below the anchor", async () => {
    const grid = await mountMode(mode);
    const before = loaded(grid.dataIds());
    grid.act(() => grid.state().actions.insertRow(0, "below"));
    const after = loaded(grid.dataIds());
    expect(after).toHaveLength(mode === "PC" ? before.length : before.length + 1); // the pager shows a fixed page of rows
    expect(after[1]).toMatch(/^new/);
    expect(grid.changes.at(-1)?.ops.map((op) => op.type)).toEqual(["insert"]);
  });

  it("deleteRowsById removes exactly the named row", async () => {
    const grid = await mountMode(mode);
    grid.act(() => grid.state().actions.deleteRowsById(["r1"]));
    const ids = grid.dataIds();
    expect(ids).not.toContain("r1");
    expect(ids).toContain("r0");
    expect(grid.changes.at(-1)?.ops).toEqual([expect.objectContaining({ type: "delete", rowId: "r1" })]);
  });

  it("duplicateRows puts the copy right after its source", async () => {
    const grid = await mountMode(mode);
    grid.act(() => grid.state().actions.duplicateRows([0]));
    expect(loaded(grid.dataIds()).slice(0, 2)).toEqual(["r0", "r0-copy"]);
  });

  it("reorderRows moves a row to the target index", async () => {
    const grid = await mountMode(mode);
    grid.act(() => void grid.state().actions.reorderRows(0, 2));
    expect(loaded(grid.dataIds()).slice(0, 3)).toEqual(["r1", "r2", "r0"]);
    expect(grid.changes.at(-1)?.ops.some((op) => op.type === "move")).toBe(true);
  });

  it("onBeforeDeleteRows can veto a delete", async () => {
    const grid = await mountMode(mode, { props: { onBeforeDeleteRows: () => false } });
    grid.act(() => grid.state().actions.deleteRows([0]));
    await grid.settle();
    expect(grid.dataIds()).toContain("r0");
    expect(grid.changes).toHaveLength(0);
  });

  it("readOnly blocks insert, delete, duplicate, and reorder", async () => {
    const grid = await mountMode(mode, { props: { readOnly: true } });
    grid.act(() => {
      const a = grid.state().actions;
      a.insertRow(0, "below");
      a.deleteRowsById(["r1"]);
      a.duplicateRows([0]);
      a.reorderRows(0, 2);
    });
    expect(grid.changes).toHaveLength(0);
  });
});
