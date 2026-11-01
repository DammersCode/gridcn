import { describe, expect, it } from "vitest";
import { distinctColumnValues } from "@/registry/default/blocks/data-grid-toolbar/distinct-values";
import { ALL_MODES, mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;

describe.each(ALL_MODES)("set values in mode %s", (mode) => {
  const names = (grid: Awaited<ReturnType<typeof mountMode>>) => distinctColumnValues(grid.state(), "name").values.map((v) => v.text);

  it("lists the values of the rows the grid holds", async () => {
    const grid = await mountMode(mode);
    expect(names(grid)).toHaveLength(mode === "PC" || mode === "PS" ? 4 : 6);
  });

  it("narrows by the other columns' client filters and ignores a server filter", async () => {
    const grid = await mountMode(mode);
    grid.setFilters([...gt1] as never);
    const held = mode === "PC" || mode === "PS" ? 4 : 6;
    const narrowed = mode === "FS" ? held : held - 2;
    expect(names(grid)).toHaveLength(narrowed);
  });

  it("an unloaded lazy row marks the list as partial", async () => {
    const grid = await mountMode(mode, { initialLoad: 3 });
    const { hasHoles } = distinctColumnValues(grid.state(), "name");
    expect(hasHoles).toBe(mode === "Z");
  });
});
