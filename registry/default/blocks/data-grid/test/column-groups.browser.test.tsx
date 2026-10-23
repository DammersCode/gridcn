import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import axe from "axe-core";
import { gridAttrSelector } from "../data-grid-sdk";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnGroupDef } from "../data-grid";
import { useDataGridPinnedRows } from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
// real stylesheet so Tailwind's grid, sticky, and CSS vars apply; alignment math is unverifiable without layout
import "@/app/global.css";

type Row = { id: string; v: number };

const COLUMN_WIDTH = 100;
const ROW_HEIGHT = 36;
const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, v: i }));

function makeColumns(count: number, pins: Record<number, "left" | "right"> = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    header: `Col ${i}`,
    accessorFn: (r: Row) => r.v + i,
    type: "number" as const,
    width: COLUMN_WIDTH,
    pin: pins[i],
  }));
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `c${from + i}`);

const groups: ColumnGroupDef[] = [
  { id: "g1", header: "Group 1", children: [...range(0, 2), { id: "g1a", header: "Group 1a", children: range(2, 6) }, ...range(6, 10)] },
  {
    id: "g2",
    header: "Group 2",
    children: [...range(10, 20), { id: "g2a", header: "Group 2a", children: [...range(20, 22), { id: "g2a1", header: "Group 2a1", children: range(22, 25) }, ...range(25, 30)] }, ...range(30, 50)],
  },
];

async function renderGroups(opts: { columns?: ReturnType<typeof makeColumns>; dir?: "ltr" | "rtl"; groups?: ColumnGroupDef[]; topRow?: boolean } = {}) {
  function Grid() {
    const { plugin } = useDataGridPinnedRows({ topRows: opts.topRow ? [{ id: "pin", v: -1 }] : [] });
    return (
      <div style={{ height: 500, width: 900 }}>
        <DataGridProvider data={rows} columns={opts.columns ?? makeColumns(60)} columnGroups={opts.groups ?? groups} getRowId={(r) => r.id} plugins={opts.topRow ? [plugin] : undefined}>
          <DataGridRoot className="h-[500px] w-[900px]" direction={opts.dir}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>
    );
  }
  const utils = await render(<Grid />);
  await expect.element(page.getByRole("grid")).toBeInTheDocument();
  return utils;
}

const scroller = () => document.querySelector<HTMLElement>('[role="grid"]')!;

async function scrollTo(left: number) {
  scroller().scrollLeft = scroller().dir === "rtl" ? -left : left;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const leaf = (id: string) => document.querySelector<HTMLElement>(`[role="columnheader"][data-column-id="${id}"]`);
const groupCells = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-grid-group-header][data-group-id="${id}"]`)];
const bodyCell = (id: string) => document.querySelector<HTMLElement>(`[role="gridcell"][data-column-id="${id}"]`);
const rect = (el: Element) => el.getBoundingClientRect();

describe("column groups: header structure and ARIA", () => {
  it("renders one row per level with row indexes, spans, and a shifted data row index", async () => {
    await renderGroups();
    const headerRows = [...document.querySelectorAll<HTMLElement>('[data-grid-header-layer] > [role="row"]')];
    expect(headerRows.map((r) => r.getAttribute("aria-rowindex"))).toEqual(["1", "2", "3", "4"]);

    const g1 = groupCells("g1")[0]!;
    expect(g1.getAttribute("role")).toBe("columnheader");
    expect(g1.getAttribute("aria-colindex")).toBe("1");
    expect(g1.getAttribute("aria-colspan")).toBe("10");
    expect(g1.closest('[role="row"]')!.getAttribute("aria-rowindex")).toBe("1");
    expect(groupCells("g1a")[0]!.closest('[role="row"]')!.getAttribute("aria-rowindex")).toBe("2");
    expect(groupCells("g2a1")).toHaveLength(0);

    expect(leaf("c0")!.closest('[role="row"]')!.getAttribute("aria-rowindex")).toBe("2");

    expect(scroller().getAttribute("aria-rowcount")).toBe(String(rows.length + 4));
    expect(scroller().getAttribute("aria-colcount")).toBe("60");
    const firstDataRow = document.querySelector<HTMLElement>('[data-grid-row-index="0"]')!;
    expect(firstDataRow.getAttribute("aria-rowindex")).toBe("5");
  });

  it("lets an ungrouped column span every header row", async () => {
    await renderGroups({ columns: makeColumns(12), groups: [{ id: "g", header: "Group", children: range(2, 6) }] });
    expect(leaf("c0")!.getAttribute("aria-rowspan")).toBe("2");
    expect(leaf("c0")!.closest('[role="row"]')!.getAttribute("aria-rowindex")).toBe("1");
    expect(Math.round(rect(leaf("c0")!).height)).toBe(2 * ROW_HEIGHT);
    expect(leaf("c3")!.getAttribute("aria-rowspan")).toBeNull();
  });

  it("has no axe violations with groups", async () => {
    await renderGroups({ columns: makeColumns(12), groups: [{ id: "g", header: "Group", children: [...range(0, 4), { id: "h", header: "Sub", children: range(4, 8) }] }] });
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  });

  it("puts the first data row under the whole header block and the pinned-top band", async () => {
    await renderGroups({ topRow: true, columns: makeColumns(12), groups: [{ id: "g", header: "Group", children: [{ id: "h", header: "Sub", children: range(0, 6) }] }] });
    const gridTop = rect(scroller()).top + scroller().clientTop;
    const pinnedRow = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRow"))!;
    expect(Math.abs(rect(pinnedRow).top - (gridTop + 3 * ROW_HEIGHT))).toBeLessThan(1.5);
    expect(pinnedRow.closest('[role="row"]')!.getAttribute("aria-rowindex")).toBe("4");
    const first = document.querySelector<HTMLElement>('[data-grid-row-index="0"]')!;
    expect(first.getAttribute("aria-rowindex")).toBe("5");
    expect(Math.abs(rect(bodyCell("c0")!).top - (gridTop + 4 * ROW_HEIGHT))).toBeLessThan(1.5);
  });
});

describe.each(["ltr", "rtl"] as const)("column groups: alignment while scrolling (%s)", (dir) => {
  const edge = (el: Element, side: "start" | "end") => {
    const r = rect(el);
    return (side === "start") === (dir === "ltr") ? r.left : r.right;
  };

  it.each([0, 1500, 3000, 99999])("keeps group and leaf headers over the body cells at scroll %i", async (left) => {
    await renderGroups({ dir });
    await scrollTo(left);

    for (const id of ["c0", "c4", "c12", "c23", "c27", "c40", "c55"]) {
      const header = leaf(id);
      const cell = bodyCell(id);
      if (!header || !cell) continue;
      expect(Math.abs(rect(header).left - rect(cell).left)).toBeLessThan(1.5);
      expect(Math.abs(rect(header).width - rect(cell).width)).toBeLessThan(1.5);
    }

    for (const [groupId, first, last] of [["g1", "c0", "c9"], ["g1a", "c2", "c5"], ["g2", "c10", "c49"], ["g2a", "c20", "c29"]] as const) {
      const cells = groupCells(groupId);
      if (cells.length === 0) continue;
      const cell = cells[0]!;
      const firstLeaf = leaf(first);
      const lastLeaf = leaf(last);
      if (firstLeaf) expect(Math.abs(edge(cell, "start") - edge(firstLeaf, "start"))).toBeLessThan(1.5);
      if (lastLeaf) expect(Math.abs(edge(cell, "end") - edge(lastLeaf, "end"))).toBeLessThan(1.5);
    }
  });

  it("renders a wide group with its full width while its first column is virtualized away", async () => {
    await renderGroups({ dir });
    await scrollTo(3000);
    const ids = [...document.querySelectorAll<HTMLElement>("[role=columnheader][data-column-id]")].map((e) => e.dataset["columnId"]);
    expect(ids.includes("c10")).toBe(false);
    expect(ids.length).toBeLessThan(60);
    const cell = groupCells("g2")[0]!;
    expect(cell).toBeDefined();
    expect(Math.round(rect(cell).width)).toBe(40 * COLUMN_WIDTH);
    expect(cell.getAttribute("aria-colspan")).toBe("40");
  });
});

describe("column groups: pinned columns", () => {
  it("splits a group at a pin boundary and keeps the pinned segment in place while the rest scrolls", async () => {
    const columns = makeColumns(30, { 0: "left", 1: "left", 29: "right" });
    await renderGroups({ columns, groups: [{ id: "all", header: "All", children: range(0, 30) }] });
    const segments = groupCells("all");
    expect(segments.length).toBeGreaterThanOrEqual(2);
    const pinnedLeft = segments.find((s) => s.dataset["pinned"] === "left")!;
    const middle = segments.find((s) => s.dataset["pinned"] === undefined)!;
    expect(pinnedLeft.getAttribute("aria-colspan")).toBe("2");
    expect(middle.getAttribute("aria-colspan")).toBe("27");

    const before = rect(pinnedLeft).left;
    await scrollTo(800);
    expect(Math.abs(rect(pinnedLeft).left - before)).toBeLessThan(1.5);
    expect(Math.abs(rect(pinnedLeft).width - 2 * COLUMN_WIDTH)).toBeLessThan(1.5);
    expect(rect(middle).left).toBeLessThan(before + 1);
    const pinnedRight = groupCells("all").find((s) => s.dataset["pinned"] === "right")!;
    expect(pinnedRight.getAttribute("aria-colspan")).toBe("1");
    expect(Math.abs(rect(pinnedRight).right - rect(leaf("c29")!).right)).toBeLessThan(1.5);
  });
});

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function press(el: HTMLElement, init: PointerEventInit = {}) {
  const r = rect(el);
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: r.left + 4, clientY: r.top + r.height / 2, ...init }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
  await frame();
}

async function dragTo(from: HTMLElement, toX: number, toY: number) {
  const r = rect(from);
  from.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: r.left + 4, clientY: r.top + r.height / 2 }));
  for (let i = 0; i < 3; i++) {
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: toX, clientY: toY }));
    await frame();
  }
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
  await frame();
  await frame();
}

const selectedColumns = () => new Set([...document.querySelectorAll<HTMLElement>('[role="gridcell"][aria-selected="true"]')].map((c) => c.dataset["columnId"]));
const headerOrder = () =>
  [...document.querySelectorAll<HTMLElement>("[role=columnheader][data-column-id]")].sort((a, b) => rect(a).left - rect(b).left).map((e) => e.dataset["columnId"]);

const neighbours: ColumnGroupDef[] = [
  { id: "left", header: "Left", children: range(0, 4) },
  { id: "right", header: "Right", children: range(4, 8) },
];

describe("column groups: gestures", () => {
  it("selects the group's visible columns on a press", async () => {
    await renderGroups();
    await press(groupCells("g1a")[0]!);
    expect([...selectedColumns()].sort()).toEqual(["c2", "c3", "c4", "c5"]);
  });

  it("adds a second group with the multi-select key", async () => {
    await renderGroups({ groups: neighbours });
    await press(groupCells("left")[0]!);
    await press(groupCells("right")[0]!, { ctrlKey: true });
    expect([...selectedColumns()].sort()).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
  });

  it("does nothing on a group press when a header press sorts", async () => {
    function Sorting() {
      return (
        <DataGridProvider data={rows} columns={makeColumns(12)} columnGroups={[{ id: "g", header: "Group", children: range(0, 4) }]} getRowId={(r) => r.id} headerClickBehavior="sort">
          <DataGridRoot className="h-[400px] w-[900px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }
    await render(<Sorting />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await press(groupCells("g")[0]!);
    expect(selectedColumns().size).toBe(0);
    expect(leaf("c0")!.getAttribute("aria-sort")).toBe("none");
  });

  it("drags a nested group as a block within its parent", async () => {
    await renderGroups();
    const t = rect(leaf("c0")!);
    await dragTo(groupCells("g1a")[0]!, t.left + 10, t.top + t.height / 2);
    expect(headerOrder().slice(0, 6)).toEqual(["c2", "c3", "c4", "c5", "c0", "c1"]);
  });

  it("ignores a column dropped into another group", async () => {
    await renderGroups({ groups: neighbours });
    const t = rect(leaf("c5")!);
    await dragTo(leaf("c0")!, t.left + 10, t.top + t.height / 2);
    expect(headerOrder().slice(0, 8)).toEqual(range(0, 8));
  });

  it("keeps a dragged column inside its group", async () => {
    await renderGroups();
    const t = rect(leaf("c1")!);
    await dragTo(leaf("c0")!, t.right - 10, t.top + t.height / 2);
    expect(headerOrder().slice(0, 4)).toEqual(["c1", "c0", "c2", "c3"]);
  });
});
