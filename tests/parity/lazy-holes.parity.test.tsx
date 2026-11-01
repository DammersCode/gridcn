import { describe, expect, it, vi } from "vitest";
import { pasteText } from "@/registry/default/blocks/data-grid/clipboard/use-grid-clipboard";
import { buildExportRows } from "@/registry/default/blocks/data-grid-io/export-grid";
import { mountMode } from "./modes";

describe("unloaded rows in mode Z (lazy rows)", () => {
  it("a paste that reaches a hole writes the loaded rows or nothing, never a phantom row", async () => {
    const grid = await mountMode("Z", { initialLoad: 3 });
    grid.act(() => grid.state().actions.selectCellAt({ col: 1, row: 2 }));
    grid.act(() => void pasteText(grid.state(), grid.state().actions, "70\n80\n90"));
    await grid.settle();
    expect(grid.dataIds().filter((id) => id !== "")).toEqual(["r0", "r1", "r2"]);
    expect(grid.state().data).toHaveLength(6);
  });

  it("updateCells skips an unloaded row id", async () => {
    const grid = await mountMode("Z", { initialLoad: 3 });
    let verdict: { applied: number } | undefined;
    grid.act(() => {
      verdict = grid.state().actions.updateCells([{ rowId: "r4", columnId: "n", value: 1 }]);
    });
    expect(verdict?.applied).toBe(0);
    expect(grid.changes).toHaveLength(0);
  });

  it("export and print leave the holes out", async () => {
    const grid = await mountMode("Z", { initialLoad: 3 });
    expect(buildExportRows(grid.state(), "all")).toHaveLength(3);
    expect(buildExportRows(grid.state(), "view", { text: "display" })).toHaveLength(3);
  });

  it("an edit of a loaded row saves while rows below it are unloaded", async () => {
    const onSave = vi.fn(async () => undefined);
    const grid = await mountMode("Z", { initialLoad: 3, props: { onSave } });
    grid.act(() => grid.state().actions.startEditing({ rowId: "r1", columnId: "n" }));
    grid.act(() => grid.state().actions.commitCellEdit(41));
    await grid.settle();
    expect(grid.cell("r1", "n")).toBe(41);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("validateRow runs for a loaded row and never for a hole", async () => {
    const validateRow = vi.fn(() => null);
    const grid = await mountMode("Z", { initialLoad: 3, props: { validateRow } });
    grid.act(() => grid.state().actions.startEditing({ rowId: "r1", columnId: "n" }));
    grid.act(() => grid.state().actions.commitCellEdit(5));
    await grid.settle();
    expect(validateRow).toHaveBeenCalledTimes(1);
    expect(validateRow).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }), "r1");
  });
});
