import { describe, expect, it } from "vitest";
import { planReplace } from "@/registry/default/blocks/data-grid-find-replace/plan-replace";
import { ALL_MODES, mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;

describe.each(ALL_MODES)("replace in mode %s", (mode) => {
  it("plans the cells of the displayed rows and writes them by row id", async () => {
    const grid = await mountMode(mode);
    grid.setFilters([...gt1] as never);
    const shown = grid.viewIds();
    const plan = planReplace(grid.state(), "Name", "Item");
    expect(plan.patches.map((patch) => patch.rowId).sort()).toEqual([...shown].sort());
    grid.act(() => void grid.state().actions.updateCells(plan.patches));
    for (const id of shown) expect(grid.cell(id, "name")).toBe(`Item ${id.slice(1)}`);
    const hidden = grid.dataIds().filter((id) => id !== "" && !shown.includes(id));
    for (const id of hidden) expect(grid.cell(id, "name")).toBe(`Name ${id.slice(1)}`);
  });

  it("a readOnly column is skipped", async () => {
    const grid = await mountMode(mode);
    const readOnlyState = { ...grid.state(), visibleColumns: grid.state().visibleColumns.map((c) => (c.id === "name" ? { ...c, readOnly: true } : c)) };
    const plan = planReplace(readOnlyState, "Name", "Item");
    expect(plan.patches).toHaveLength(0);
    expect(plan.skipped.every((skip) => skip.reason === "readonly")).toBe(true);
  });

  it("a readOnly grid ignores the replacement", async () => {
    const grid = await mountMode(mode, { props: { readOnly: true } });
    const plan = planReplace(grid.state(), "Name", "Item");
    grid.act(() => void grid.state().actions.updateCells(plan.patches));
    expect(grid.changes).toHaveLength(0);
  });
});
