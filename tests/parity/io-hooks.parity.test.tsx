import { describe, expect, it } from "vitest";
import { planReplace } from "@/registry/default/blocks/data-grid-find-replace/plan-replace";
import { buildImportedRows } from "@/registry/default/blocks/data-grid-io/build-imported-rows";
import { ALL_MODES, mountMode } from "./modes";

describe.each(ALL_MODES)("the import and replace hook points in mode %s", (mode) => {
  it("a cell hook parses import cells with the mode's columns and cell types", async () => {
    const grid = await mountMode(mode);
    const state = grid.state();
    const built = await buildImportedRows({
      dataRows: [["Imported", "7"]],
      mapping: [
        { importColumnIndex: 0, gridColumnId: "name" },
        { importColumnIndex: 1, gridColumnId: "n" },
      ],
      columns: state.visibleColumns as never,
      cellTypes: state.cellTypes as never,
      createRow: (index) => ({ id: `new-${index}`, name: "", n: 0 }),
      processCellFromText: (text, ctx) => ((ctx.column as { id: string }).id === "name" ? text.toUpperCase() : (undefined as never)),
    });
    expect(built.rows[0]).toMatchObject({ id: "new-0", name: "IMPORTED" });
    expect(grid.changes).toHaveLength(0);
  });

  it("a plan the replace hook cut down writes only its patches, by row id", async () => {
    const grid = await mountMode(mode);
    const plan = planReplace(grid.state(), "Name", "Item");
    const kept = plan.patches.slice(0, 1);
    expect(kept).toHaveLength(1);
    grid.act(() => void grid.state().actions.updateCells(kept, { source: "replace", reorder: "defer" }));
    await grid.settle();
    if (mode === "API") expect(grid.saves).toHaveLength(1);
    expect(grid.cell(kept[0]!.rowId, "name")).toBe(`Item ${kept[0]!.rowId.slice(1)}`);
    const untouched = grid.dataIds().find((id) => id !== "" && id !== kept[0]!.rowId)!;
    expect(grid.cell(untouched, "name")).toBe(`Name ${untouched.slice(1)}`);
  });
});
