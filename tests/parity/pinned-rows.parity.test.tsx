import { describe, expect, it } from "vitest";
import { useDataGridAggregate } from "@/registry/default/blocks/data-grid-pinned-rows/use-data-grid-aggregate";
import { ALL_MODES, mountMode } from "./modes";

const gt1 = [{ filterId: "f", columnId: "n", operator: "gt", value: "1" }] as const;
const specs = { n: "sum" } as const;

function withAggregate() {
  let sums: Record<string, unknown> = {};
  let sumsAll: Record<string, unknown> = {};
  function Child() {
    sums = useDataGridAggregate(specs);
    sumsAll = useDataGridAggregate(specs, { scope: "all" });
    return null;
  }
  return { Child, view: () => sums["n"], all: () => sumsAll["n"] };
}

describe.each(ALL_MODES)("aggregate band in mode %s", (mode) => {
  it("the view scope sums what the view shows and the all scope sums the held rows", async () => {
    const aggregate = withAggregate();
    const grid = await mountMode(mode, { Child: aggregate.Child });
    const held = mode === "PC" || mode === "PS" ? 0 + 1 + 2 + 3 : 15;
    expect(aggregate.all()).toBe(held);
    grid.setFilters([...gt1] as never);
    const filtered = mode === "FS" ? held : mode === "PC" || mode === "PS" ? 5 : 14;
    expect(aggregate.view()).toBe(filtered);
    expect(aggregate.all()).toBe(held);
  });

  it("a streamed value reaches the band", async () => {
    const aggregate = withAggregate();
    const grid = await mountMode(mode, { Child: aggregate.Child });
    const before = aggregate.view() as number;
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r1", columnId: "n", value: 101 }]));
    expect(aggregate.view()).toBe(before + 100);
  });
});
