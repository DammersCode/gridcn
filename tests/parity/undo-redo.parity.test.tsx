import { describe, expect, it } from "vitest";
import { useDataGridHistory } from "@/registry/default/blocks/data-grid-history/use-data-grid-history";
import { ALL_MODES, mountMode, type MountOptions } from "./modes";

type Undo = ReturnType<typeof useDataGridHistory>;

function withHistory(): { options: MountOptions; history: () => Undo } {
  let current: Undo | null = null;
  return {
    options: {
      useExtra: () => {
        const history = useDataGridHistory();
        current = history;
        return { plugins: [history.plugin] };
      },
    },
    history: () => current!,
  };
}

describe.each(ALL_MODES)("undo and redo in mode %s", (mode) => {
  it("undo restores an edit and redo applies it again", async () => {
    const { options, history } = withHistory();
    const grid = await mountMode(mode, options);
    grid.act(() => grid.state().actions.commitCellValue({ rowId: "r0", columnId: "n" }, 99));
    expect(grid.cell("r0", "n")).toBe(99);
    grid.act(() => history().undo());
    expect(grid.cell("r0", "n")).toBe(0);
    grid.act(() => history().redo());
    expect(grid.cell("r0", "n")).toBe(99);
  });

  it("undo reaches the edited row after the sort or the filter changed the view", async () => {
    const { options, history } = withHistory();
    const grid = await mountMode(mode, options);
    grid.act(() => grid.state().actions.commitCellValue({ rowId: "r1", columnId: "n" }, 50));
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    grid.setFilters([{ filterId: "f", columnId: "name", operator: "gt", value: "1" }]);
    grid.act(() => history().undo());
    expect(grid.cell("r1", "n")).toBe(1);
    expect(grid.cell("r0", "n")).toBe(0);
  });

  it("a readOnly grid does not undo", async () => {
    const { options, history } = withHistory();
    const grid = await mountMode(mode, options);
    grid.act(() => grid.state().actions.commitCellValue({ rowId: "r0", columnId: "n" }, 99));
    grid.setProps({ readOnly: true });
    grid.act(() => history().undo());
    expect(grid.cell("r0", "n")).toBe(99);
  });
});
