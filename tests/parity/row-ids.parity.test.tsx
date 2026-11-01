import { describe, expect, it } from "vitest";
import { ALL_MODES, mountMode } from "./modes";

describe.each(ALL_MODES)("row ids in mode %s", (mode) => {
  it("the active cell and the checked rows follow their row id through a sort", async () => {
    const grid = await mountMode(mode);
    const startView = grid.viewIds();
    const row = startView.indexOf("r1");
    grid.act(() => grid.state().actions.selectCellAt({ col: 1, row }));
    grid.act(() => grid.state().actions.setRowSelected(row, true));
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    const view = grid.viewIds();
    expect(view[grid.state().activeCell!.row]).toBe("r1");
    expect(grid.state().selection.rows.toArray().map((i) => view[i])).toEqual(["r1"]);
  });

  it("an edit by row id lands on that row whatever the view order", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    grid.act(() => grid.state().actions.commitCellValue({ rowId: "r2", columnId: "n" }, 123));
    expect(grid.cell("r2", "n")).toBe(123);
    expect(grid.cell("r1", "n")).toBe(1);
  });

  it("a delete by row id removes that row even after the view changed", async () => {
    const grid = await mountMode(mode);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    grid.act(() => grid.state().actions.deleteRowsById(["r0"]));
    expect(grid.dataIds()).not.toContain("r0");
    expect(grid.dataIds()).toContain("r1");
  });
});

describe.each(["PS", "C", "SS", "FS", "API"] as const)("a new page or server order in mode %s", (mode) => {
  it("the active cell and the checked row follow their row id when the rows are replaced in a new order", async () => {
    const grid = await mountMode(mode);
    const row = grid.viewIds().indexOf("r1");
    grid.act(() => grid.state().actions.selectCellAt({ col: 1, row }));
    grid.act(() => grid.state().actions.setRowSelected(row, true));
    const reordered = [...grid.held()].reverse();
    grid.replaceData(reordered);
    const view = grid.viewIds();
    expect(view[grid.state().activeCell!.row]).toBe("r1");
    expect(grid.state().selection.rows.toArray().map((i) => view[i])).toEqual(["r1"]);
  });
});
