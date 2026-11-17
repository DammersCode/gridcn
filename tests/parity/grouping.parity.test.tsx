import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DataGridBody } from "@/registry/default/blocks/data-grid/data-grid";
import { rowIdAtViewRow } from "@/registry/default/blocks/data-grid/store/view-rows";
import { mountMode, type ModeId, type MountOptions, type Mounted, type Row } from "./modes";

const MOUNT: Partial<Record<ModeId, (options: MountOptions) => Promise<Mounted>>> = {
  L: (options) => mountMode("L", options),
  C: (options) => mountMode("C", options),
  API: (options) => mountMode("API", options),
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

describe("row grouping in a mode that does not group", () => {
  it("leaves a client-paged grid ungrouped until the pager groups pages", async () => {
    const grid = await mountMode("PC", { rows, Child: DataGridBody });
    expect(document.querySelector('[role="treegrid"]')).toBeNull();
    expect(grid.state().groupLayout).toBeNull();
  });
});
