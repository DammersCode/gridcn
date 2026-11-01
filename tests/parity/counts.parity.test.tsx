import { describe, expect, it } from "vitest";
import { ALL_MODES, mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;

describe.each(ALL_MODES)("row counts in mode %s", (mode) => {
  it("totalRowCount declares the size of the whole result", async () => {
    const grid = await mountMode(mode, { props: { totalRowCount: 240 } });
    expect(grid.state().totalRowCount).toBe(240);
  });

  it("a null totalRowCount declares an unknown size", async () => {
    const grid = await mountMode(mode, { props: { totalRowCount: null } });
    expect(grid.state().totalRowCount).toBeNull();
  });

  it("the view count shrinks with a client filter and stays whole under filterMode server", async () => {
    const grid = await mountMode(mode);
    const before = grid.viewIds().length;
    grid.setFilters([...gt1] as never);
    const serverFiltered = mode === "FS";
    expect(grid.viewIds().length).toBe(serverFiltered ? before : before - 2);
  });
});
