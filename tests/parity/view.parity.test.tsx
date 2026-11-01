import { describe, expect, it } from "vitest";
import { mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;

describe("sort, filter, and search with client pagination", () => {
  it("sort orders the rows of the current page", async () => {
    const grid = await mountMode("PC");
    grid.setSorts([{ columnId: "n", direction: "desc" }]);
    expect(grid.viewIds()).toEqual(["r3", "r2", "r1", "r0"]);
  });

  it("filter narrows the current page and leaves the other pages out of reach", async () => {
    const grid = await mountMode("PC");
    grid.setFilters([...gt1] as never);
    expect(grid.viewIds()).toEqual(["r2", "r3"]);
  });

  it("search highlights matches on the current page only", async () => {
    const grid = await mountMode("PC");
    grid.act(() => grid.state().actions.setSearch("Name 5"));
    expect(grid.state().searchMatches?.length ?? 0).toBe(0);
    grid.act(() => grid.state().actions.setSearch("Name 3"));
    expect(grid.state().searchMatches?.length).toBe(1);
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
