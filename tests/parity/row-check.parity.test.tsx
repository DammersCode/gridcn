import { describe, expect, it } from "vitest";
import { mountMode } from "./modes";

describe("checked rows with client pagination", () => {
  it("a page change drops the checks of the page left behind", async () => {
    const grid = await mountMode("PC");
    grid.act(() => grid.state().actions.setRowSelected(1, true));
    expect([...grid.state().selection.rows.toArray()]).toEqual([1]);
    grid.goToPage(2);
    expect(grid.state().selection.rows.toArray()).toEqual([]);
  });

  it("keepCheckedRows remembers the row by id and checks it again when the page returns", async () => {
    const grid = await mountMode("PC", { props: { keepCheckedRows: true, keepHiddenCheckedRows: true } });
    grid.act(() => grid.state().actions.setRowSelected(1, true));
    grid.goToPage(2);
    expect([...grid.state().hiddenCheckedRowIds]).toEqual(["r1"]);
    grid.goToPage(1);
    expect(grid.state().selection.rows.toArray()).toEqual([1]);
    expect(grid.state().hiddenCheckedRowIds.size).toBe(0);
  });

  it("a readOnly grid still checks rows because checking is not a write", async () => {
    const grid = await mountMode("PC", { props: { readOnly: true } });
    grid.act(() => grid.state().actions.setRowSelected(2, true));
    expect(grid.state().selection.rows.toArray()).toEqual([2]);
  });
});
