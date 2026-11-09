import { describe, expect, it } from "vitest";
import { useDataGridSelectionStats } from "@/registry/default/blocks/data-grid-status-bar/use-data-grid-selection-stats";
import type { SelectionStats } from "@/registry/default/blocks/data-grid-status-bar/compute-selection-stats";
import { mountMode } from "./modes";
import { viewIndex } from "@/registry/default/blocks/data-grid/types";

describe("checked rows with client pagination", () => {
  it("a page change drops the checks of the page left behind", async () => {
    const grid = await mountMode("PC");
    grid.act(() => grid.state().actions.setRowCheckedAt(viewIndex(1), true));
    expect([...grid.state().selection.rows.toArray()]).toEqual([1]);
    grid.goToPage(2);
    expect(grid.state().selection.rows.toArray()).toEqual([]);
  });

  it("across-filters remembers the row by id and checks it again when the page returns", async () => {
    const grid = await mountMode("PC", { props: { checkedRowsLifetime: "across-filters" } });
    grid.act(() => grid.state().actions.setRowCheckedAt(viewIndex(1), true));
    grid.goToPage(2);
    expect([...grid.state().hiddenCheckedRowIds]).toEqual(["r1"]);
    grid.goToPage(1);
    expect(grid.state().selection.rows.toArray()).toEqual([1]);
    expect(grid.state().hiddenCheckedRowIds.size).toBe(0);
  });

  it("across-filters checks a row again on the page a sort moved it to", async () => {
    const grid = await mountMode("PC", { props: { checkedRowsLifetime: "across-filters" } });
    grid.act(() => grid.state().actions.setRowCheckedAt(viewIndex(1), true));
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    expect([...grid.state().hiddenCheckedRowIds]).toEqual(["r1"]);
    grid.goToPage(2);
    expect(grid.state().selection.rows.toArray().map((i) => grid.viewIds()[i])).toEqual(["r1"]);
  });

  it("Ctrl/Cmd+A drops the remembered checks of the other pages", async () => {
    const grid = await mountMode("PC", { props: { checkedRowsLifetime: "across-filters" } });
    grid.act(() => grid.state().actions.setRowCheckedAt(viewIndex(1), true));
    grid.goToPage(2);
    grid.act(() => grid.state().actions.selectAll());
    expect(grid.state().hiddenCheckedRowIds.size).toBe(0);
    grid.goToPage(1);
    expect(grid.state().selection.rows.toArray()).toEqual([]);
  });

  it("a readOnly grid still checks rows because checking is not a write", async () => {
    const grid = await mountMode("PC", { props: { readOnly: true } });
    grid.act(() => grid.state().actions.setRowCheckedAt(viewIndex(2), true));
    expect(grid.state().selection.rows.toArray()).toEqual([2]);
  });
});

describe("selection stats with client pagination", () => {
  it("a column selection stays through a page change and covers the shown page only", async () => {
    let stats: SelectionStats | undefined;
    function Child() {
      stats = useDataGridSelectionStats();
      return null;
    }
    const grid = await mountMode("PC", { Child });
    grid.act(() => grid.state().actions.selectColumn(1));
    expect(stats).toMatchObject({ numeric: 4, sum: 0 + 1 + 2 + 3 });
    grid.goToPage(2);
    expect(grid.state().selection.columns.toArray()).toEqual([1]);
    expect(stats).toMatchObject({ numeric: 2, sum: 4 + 5 });
  });
});
