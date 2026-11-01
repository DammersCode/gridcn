import { describe, expect, it, vi } from "vitest";
import { ALL_MODES, mountMode, type Row } from "./modes";
import type { DataChange } from "@/registry/default/blocks/data-grid/types";

const edit = (grid: Awaited<ReturnType<typeof mountMode>>, rowId: string, value: number) => {
  grid.act(() => grid.state().actions.startEditing({ rowId, columnId: "n" }));
  grid.act(() => grid.state().actions.commitCellEdit(value));
};

describe.each(ALL_MODES)("onSave write-through in mode %s", (mode) => {
  it("an accepted save keeps the edit and sends one change", async () => {
    const onSave = vi.fn(async (_change: DataChange<Row>) => undefined);
    const grid = await mountMode(mode, { props: { onSave } });
    edit(grid, "r1", 31);
    await grid.settle();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(grid.cell("r1", "n")).toBe(31);
  });

  it("a refused save reverts only the refused row and reports it", async () => {
    const onSaveRejected = vi.fn();
    const onSave = vi.fn(async () => ({ rejected: [{ rowId: "r1", message: "no" }] }));
    const grid = await mountMode(mode, { props: { onSave, onSaveRejected } });
    edit(grid, "r1", 31);
    await grid.settle();
    expect(grid.cell("r1", "n")).toBe(1);
    expect(onSaveRejected).toHaveBeenCalledTimes(1);
    expect(grid.changes.at(-1)?.source).toBe("rollback");
  });

  it("a rejected promise refuses the whole change", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("offline");
    });
    const grid = await mountMode(mode, { props: { onSave } });
    edit(grid, "r2", 77);
    await grid.settle();
    expect(grid.cell("r2", "n")).toBe(2);
  });

  it("a readOnly grid writes and saves nothing", async () => {
    const onSave = vi.fn();
    const grid = await mountMode(mode, { props: { onSave, readOnly: true } });
    edit(grid, "r1", 31);
    await grid.settle();
    expect(onSave).not.toHaveBeenCalled();
    expect(grid.cell("r1", "n")).toBe(1);
  });
});
