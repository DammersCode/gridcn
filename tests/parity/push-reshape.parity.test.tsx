import { describe, expect, it } from "vitest";
import type { FilterNode } from "@/registry/default/blocks/data-grid/types";
import { mountMode, type ModeId } from "./modes";

const SORT = [{ columnId: "n", direction: "desc" as const }];
const FILTER: FilterNode[] = [{ filterId: "f", columnId: "n", operator: "gte", value: "0" }];

/** A push into the column the server spec reads: the row keeps its place and carries a stale mark. */
function suite(mode: ModeId) {
  const mount = () => mountMode(mode, { props: { sortMode: "server", filterMode: "server" } });
  const useSpec = (grid: Awaited<ReturnType<typeof mount>>) => (mode === "FS" ? grid.setFilters(FILTER) : grid.setSorts(SORT));

  it("marks a pushed row stale and keeps the view order", async () => {
    const grid = await mount();
    useSpec(grid);
    const order = grid.viewIds();
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r2", columnId: "n", value: 99 }]));
    expect([...grid.state().staleRowIds]).toEqual(["r2"]);
    expect(grid.state().viewStale).toBe(true);
    expect(grid.viewIds()).toEqual(order);
    expect(grid.cell("r2", "n")).toBe(99);
  });

  it("marks nothing for a column the server spec does not read", async () => {
    const grid = await mount();
    useSpec(grid);
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r2", columnId: "name", value: "Renamed" }]));
    expect(grid.state().staleRowIds.size).toBe(0);
    expect(grid.state().viewStale).toBe(false);
  });

  it("clears the marks on reconcileView() when no server rows hook is mounted", async () => {
    const grid = await mount();
    useSpec(grid);
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r2", columnId: "n", value: 99 }]));
    grid.act(() => grid.state().actions.reconcileView());
    expect(grid.state().staleRowIds.size).toBe(0);
    expect(grid.state().viewStale).toBe(false);
  });

  it("deletes a row on a stream delete without onBeforeDeleteRows or onSave", async () => {
    let asked = 0;
    const grid = await mountMode(mode, { props: { sortMode: "server", filterMode: "server", onBeforeDeleteRows: () => (asked++, true) } });
    grid.act(() => grid.state().actions.deleteRowsById(["r1"], { source: "stream" }));
    await grid.settle();
    expect(grid.dataIds()).not.toContain("r1");
    expect(grid.changes.at(-1)?.source).toBe("stream");
    expect(grid.saves).toHaveLength(0);
    expect(asked).toBe(0);
  });
}

describe("pushes in mode PS (server pagination)", () => suite("PS"));
describe("pushes in mode Z (scroll rows)", () => suite("Z"));
describe("pushes in mode C (controlled state)", () => suite("C"));
describe("pushes in mode SS (sortMode server)", () => suite("SS"));
describe("pushes in mode FS (filterMode server)", () => suite("FS"));
describe("pushes in mode API (onSave write-through)", () => suite("API"));

describe("a consumer that delivers a new row object in mode C (controlled state)", () => {
  it("unmarks the stale row", async () => {
    const grid = await mountMode("C", { props: { sortMode: "server" } });
    grid.setSorts(SORT);
    grid.act(() => void grid.state().actions.updateCells([{ rowId: "r2", columnId: "n", value: 99 }]));
    expect([...grid.state().staleRowIds]).toEqual(["r2"]);
    grid.replaceData(grid.held().map((row) => ({ ...row })));
    expect(grid.state().staleRowIds.size).toBe(0);
  });
});
