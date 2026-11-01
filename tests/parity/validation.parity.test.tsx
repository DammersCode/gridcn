import { describe, expect, it } from "vitest";
import { pasteText } from "@/registry/default/blocks/data-grid/clipboard/use-grid-clipboard";
import { cellErrorKey } from "@/registry/default/blocks/data-grid/store";
import { ALL_MODES, mountMode, type Row } from "./modes";

type Grid = Awaited<ReturnType<typeof mountMode>>;

const edit = (grid: Grid, rowId: string, value: number) => {
  grid.act(() => grid.state().actions.startEditing({ rowId, columnId: "n" }));
  grid.act(() => grid.state().actions.commitCellEdit(value));
};
const error = (grid: Grid, rowId: string) => grid.state().cellErrors.get(cellErrorKey(rowId, "n"));
const noNegative = (row: Row) => (row.n < 0 ? { n: "no negatives" } : null);

describe.each(ALL_MODES)("validateRow in mode %s", (mode) => {
  it("an edit commits and a failing verdict marks the cell", async () => {
    const grid = await mountMode(mode, { props: { validateRow: noNegative } });
    edit(grid, "r1", -5);
    await grid.settle();
    expect(grid.cell("r1", "n")).toBe(-5);
    expect(error(grid, "r1")).toBe("no negatives");
  });

  it("a passing verdict leaves the cell clean", async () => {
    const grid = await mountMode(mode, { props: { validateRow: noNegative } });
    edit(grid, "r1", 7);
    await grid.settle();
    expect(error(grid, "r1")).toBeUndefined();
  });

  it("an async verdict merges when it settles", async () => {
    const grid = await mountMode(mode, { props: { validateRow: async (row: Row) => noNegative(row) } });
    edit(grid, "r1", -5);
    await grid.settle();
    expect(error(grid, "r1")).toBe("no negatives");
  });

  it("a paste is validated per row", async () => {
    const grid = await mountMode(mode, { props: { validateRow: noNegative } });
    grid.act(() => grid.state().actions.selectCellAt({ col: 1, row: 0 }));
    grid.act(() => void pasteText(grid.state(), grid.state().actions, "-1\n5"));
    await grid.settle();
    const [first, second] = grid.viewIds();
    expect(error(grid, first!)).toBe("no negatives");
    expect(error(grid, second!)).toBeUndefined();
  });

  it("a verdict for a deleted row is dropped", async () => {
    let release!: (value: Record<string, string> | null) => void;
    const grid = await mountMode(mode, { props: { validateRow: () => new Promise((resolve) => (release = resolve)) } });
    edit(grid, "r1", -5);
    grid.act(() => grid.state().actions.deleteRowsById(["r1"]));
    release({ n: "late" });
    await grid.settle();
    expect(grid.dataIds()).not.toContain("r1");
    expect(error(grid, "r1")).toBeUndefined();
  });
});
