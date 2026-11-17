import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataGridSearch } from "@/registry/default/blocks/data-grid-toolbar/search";
import { mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;

const gt0 = [{ filterId: "f", columnId: "n", operator: "gt", value: "0" }] as const;

describe("sort, filter, and search with client pagination", () => {
  it("sort orders every page, not only the shown one", async () => {
    const grid = await mountMode("PC");
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    expect(grid.viewIds()).toEqual(["r5", "r4", "r3", "r2"]);
    grid.goToPage(2);
    expect(grid.viewIds()).toEqual(["r1", "r0"]);
  });

  it("filter narrows every page and keeps the rows of the other pages in reach", async () => {
    const grid = await mountMode("PC");
    grid.goToPage(2);
    grid.setFilters([...gt0] as never);
    expect(grid.state().page).toBe(1);
    expect(grid.fullViewIds()).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(grid.viewIds()).toEqual(["r1", "r2", "r3", "r4"]);
    grid.goToPage(2);
    expect(grid.viewIds()).toEqual(["r5"]);
  });

  it("search counts the matches on every page and highlights the shown page", async () => {
    const grid = await mountMode("PC");
    grid.act(() => grid.state().actions.setSearch("Name 5"));
    expect(grid.state().searchMatches).toHaveLength(1);
    expect(grid.state().searchMatchSet.size).toBe(0);
    grid.goToPage(2);
    expect(grid.state().searchMatchSet.size).toBe(1);
    expect(grid.viewIds()).toEqual(["r4", "r5"]);
  });

  it("next match jumps to the page of the match", async () => {
    const grid = await mountMode("PC", { Child: () => <DataGridSearch /> });
    grid.act(() => grid.state().actions.setSearch("Name 5"));
    grid.act(() => fireEvent.click(screen.getByRole("button", { name: "Next match" })));
    expect(grid.state().page).toBe(2);
    expect(grid.viewIds()[grid.state().activeCell!.row]).toBe("r5");
  });
});

describe("writes with client pagination", () => {
  it("an edit on page 2 lands on its row and leaves page 1 alone", async () => {
    const grid = await mountMode("PC");
    grid.goToPage(2);
    expect(grid.viewIds()).toEqual(["r4", "r5"]);
    grid.act(() => grid.state().actions.commitCellValue({ rowId: "r5", columnId: "n" }, 55));
    grid.goToPage(1);
    expect(grid.viewIds()).toEqual(["r0", "r1", "r2", "r3"]);
    expect(grid.cell("r0", "n")).toBe(0);
    grid.goToPage(2);
    expect(grid.cell("r5", "n")).toBe(55);
    expect(grid.cell("r4", "n")).toBe(4);
  });
});

describe("the top-level join with client pagination", () => {
  const or = [{ filterId: "a", columnId: "n", operator: "lt", value: "1" }, { filterId: "b", columnId: "n", operator: "gt", value: "3" }] as const;
  it("or narrows every page and resets to page 1", async () => {
    const grid = await mountMode("PC");
    grid.setFilters([...or] as never);
    expect(grid.fullViewIds()).toEqual([]);
    grid.goToPage(2);
    grid.act(() => grid.state().actions.setFilterJoin("or"));
    expect(grid.state().page).toBe(1);
    expect(grid.fullViewIds()).toEqual(["r0", "r4", "r5"]);
  });
});

describe("the top-level join with server pagination", () => {
  it("filterMode server keeps the page whole and tracks the join", async () => {
    const grid = await mountMode("PS", { props: { filterMode: "server" } });
    grid.act(() => grid.state().actions.setFilterJoin("or"));
    expect(grid.state().filterJoin).toBe("or");
    expect(grid.viewIds()).toEqual(["r0", "r1", "r2", "r3"]);
  });
});

describe("sort, filter, and search with server pagination", () => {
  it("filterMode server keeps the page whole and tracks the spec", async () => {
    const grid = await mountMode("PS", { props: { filterMode: "server", sortMode: "server" } });
    grid.setFilters([...gt1] as never);
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    expect(grid.viewIds()).toEqual(["r0", "r1", "r2", "r3"]);
    expect(grid.state().filterState).toHaveLength(1);
    expect(grid.state().sortState).toEqual([{ columnId: "n", direction: "desc" }]);
  });

  it("without the server modes the grid treats the page as the whole result", async () => {
    const grid = await mountMode("PS");
    grid.setFilters([...gt1] as never);
    expect(grid.viewIds()).toEqual(["r2", "r3"]);
  });

  it("search under filterMode server never hides a row of the page", async () => {
    const grid = await mountMode("PS", { props: { filterMode: "server" } });
    grid.act(() => grid.state().actions.setSearch("Name 3"));
    expect(grid.viewIds()).toEqual(["r0", "r1", "r2", "r3"]);
    expect(grid.state().searchText).toBe("Name 3");
  });
});
