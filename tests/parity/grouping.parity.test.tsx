import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DataGridBody } from "@/registry/default/blocks/data-grid/data-grid";
import { fullViewOf } from "@/registry/default/blocks/data-grid/store/compute";
import { matchingRowTotal } from "@/registry/default/blocks/data-grid/store/matching-total";
import { pageUnitsOf } from "@/registry/default/blocks/data-grid/store/group-pages";
import { isGroupRowId } from "@/registry/default/blocks/data-grid/store/group-state";
import { rowIdAtViewRow } from "@/registry/default/blocks/data-grid/store/view-rows";
import { mountMode, type ModeId, type MountOptions, type Mounted, type Row } from "./modes";

const MOUNT: Partial<Record<ModeId, (options: MountOptions) => Promise<Mounted>>> = {
  L: (options) => mountMode("L", options),
  C: (options) => mountMode("C", options),
  API: (options) => mountMode("API", options),
  PC: (options) => mountMode("PC", options),
};
const GROUPING_MODES = Object.keys(MOUNT) as ModeId[];

const rows: Row[] = [
  { id: "r0", name: "alpha", n: 1 },
  { id: "r1", name: "beta", n: 2 },
  { id: "r2", name: "alpha", n: 3 },
  { id: "r3", name: "beta", n: 4 },
  { id: "r4", name: "alpha", n: 5 },
];

const groupColumns = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "n", header: "N", accessorKey: "n", type: "number", aggregate: "sum" },
];

const idsOf = (grid: Mounted) => grid.state().viewIndex.map((_, row) => rowIdAtViewRow(grid.state(), row));

const groupRows = () => [...document.querySelectorAll<HTMLElement>("[data-grid-group-row]")];

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 360 });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
});

afterEach(cleanup);

describe.each(GROUPING_MODES)("row grouping in mode %s", (mode) => {
  const mount = () => MOUNT[mode]!({ rows, Child: DataGridBody, props: { columns: groupColumns, defaultGroupBy: ["name"], defaultExpanded: { mode: "expanded", ids: [] } } });

  it("shows the same group ids, labels, counts, and aggregates", async () => {
    const grid = await mount();
    expect(idsOf(grid)).toEqual(["__group:name=alpha", "r0", "r2", "r4", "__group:name=beta", "r1", "r3"]);
    expect(groupRows().map((row) => row.textContent)).toEqual(["Name: alpha (3)9", "Name: beta (2)6"]);
  });

  it("describes the tree through ARIA", async () => {
    await mount();
    expect(document.querySelector('[role="treegrid"]')).not.toBeNull();
    expect(groupRows().map((row) => [row.getAttribute("aria-level"), row.getAttribute("aria-expanded"), row.getAttribute("aria-posinset"), row.getAttribute("aria-setsize")])).toEqual([
      ["1", "true", "1", "2"],
      ["1", "true", "2", "2"],
    ]);
    const dataRows = [...document.querySelectorAll('[role="row"][data-grid-row-index]:not([data-grid-group-row])')];
    expect(dataRows.map((row) => row.getAttribute("aria-level"))).toEqual(["2", "2", "2", "2", "2"]);
    expect(dataRows.map((row) => row.getAttribute("aria-posinset"))).toEqual(["1", "2", "3", "1", "2"]);
  });

  it("closes a group through toggleGroup and keeps the rows of the other group", async () => {
    const grid = await mount();
    grid.act(() => grid.state().actions.toggleGroup("__group:name=alpha"));
    expect(idsOf(grid)).toEqual(["__group:name=alpha", "__group:name=beta", "r1", "r3"]);
    expect(groupRows()[0]!.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("row grouping in mode PC", () => {
  const paged: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, name: `g${Math.floor(i / 2)}`, n: i }));
  const mountPaged = (props: Record<string, unknown> = {}) =>
    mountMode("PC", { rows: paged, Child: DataGridBody, props: { columns: groupColumns, defaultGroupBy: ["name"], ...props } });

  it("pages top-level groups, with the rows opened under them", async () => {
    const grid = await mountPaged({ defaultExpanded: { mode: "expanded", ids: [] } });
    expect(idsOf(grid).filter((id) => id !== undefined && isGroupRowId(id))).toEqual(["__group:name=g0", "__group:name=g1", "__group:name=g2", "__group:name=g3"]);
    expect(idsOf(grid)).toHaveLength(12);
    grid.goToPage(2);
    expect(idsOf(grid).filter((id) => id !== undefined && isGroupRowId(id))).toEqual(["__group:name=g4", "__group:name=g5"]);
    expect(fullViewOf(grid.state().viewIndex)).toHaveLength(18);
  });

  it("keeps a closed group as one entry of its page", async () => {
    const grid = await mountPaged();
    expect(idsOf(grid)).toEqual(["__group:name=g0", "__group:name=g1", "__group:name=g2", "__group:name=g3"]);
    grid.act(() => grid.state().actions.toggleGroup("__group:name=g1"));
    expect(idsOf(grid)).toEqual(["__group:name=g0", "__group:name=g1", "p2", "p3", "__group:name=g2", "__group:name=g3"]);
  });

  it("counts groups in the pager and rows in the all-matching total", async () => {
    const grid = await mountPaged();
    expect(pageUnitsOf(fullViewOf(grid.state().viewIndex))).toBe(6);
    expect(matchingRowTotal(grid.state())).toBe(12);
  });

  it("goes back to page 1 when the group columns change", async () => {
    const grid = await mountPaged();
    grid.goToPage(2);
    expect(grid.state().page).toBe(2);
    grid.act(() => grid.state().actions.setGroupBy(["n"]));
    expect(grid.state().page).toBe(1);
  });
});
