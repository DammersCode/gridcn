import { page, userEvent } from "vitest/browser";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { CSSProperties } from "react";
import { DataGrid, defineColumns } from "../data-grid";
import { expectNoPaintMismatch, type PaintState } from "./paint-parity.test-helper";
import "@/app/global.css";

type Sale = { id: string; customer: string; region: string; dealership: string; make: string; price: number; discount: number };

const makeColumns = (opts: { pinFirst?: boolean; width?: number }) =>
  defineColumns<Sale>()([
    { id: "customer", header: "Customer", accessorKey: "customer", type: "text", width: opts.width ?? 150, ...(opts.pinFirst ? { pin: "start" as const } : {}) },
    { id: "region", header: "Region", accessorKey: "region", type: "text", width: opts.width ?? 100 },
    { id: "dealership", header: "Dealership", accessorKey: "dealership", type: "text", width: opts.width ?? 170 },
    { id: "make", header: "Make", accessorKey: "make", type: "text", width: opts.width ?? 100 },
    { id: "price", header: "Price", accessorKey: "price", type: "number", width: 120, aggregate: "sum" },
    { id: "discount", header: "Discount", accessorKey: "discount", type: "number", width: 120, aggregate: "avg" },
  ] as const);

const data: Sale[] = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  customer: `Customer ${i}`,
  region: `Region ${i % 2}`,
  dealership: i % 4 < 2 ? "Eastbrook Cars" : "Westfield Motors",
  make: `Make ${i % 3}`,
  price: 1000 + i,
  discount: i,
}));

/** `theme` sets CSS variables on the root, where a shadcn preset sets them. */
type Variant = { pinFirst?: boolean; direction?: "ltr" | "rtl"; width?: number; gridWidth?: number; style?: CSSProperties; theme?: Record<string, string> };

async function renderGrid(variant: Variant = {}) {
  await page.viewport(1280, 800);
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(variant.theme ?? {})) {
    root.setProperty(name, value);
    onTestFinished(() => {
      root.removeProperty(name);
    });
  }
  await render(
    <div dir={variant.direction} style={{ width: variant.gridWidth ?? 900, ...variant.style }}>
      <DataGrid
        data={data}
        columns={makeColumns(variant)}
        getRowId={(r) => r.id}
        groupBy={["region", "dealership"]}
        defaultExpanded={{ mode: "expanded", ids: [] }}
        direction={variant.direction}
        className="h-[480px]"
        aria-label="Sales"
      />
    </div>,
  );
  await vi.waitFor(() => expect(groupRows().length).toBeGreaterThan(3));
  return document.querySelector<HTMLElement>('[role="treegrid"]')!;
}

const q = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
const groupRows = () => q('[role="row"][data-grid-group-row]');
const nestedGroupRow = () => groupRows().find((row) => row.getAttribute("aria-level") === "2")!;
const gridCells = (row: Element) => [...row.querySelectorAll<HTMLElement>('[role="gridcell"]:not([data-grid-marker-cell])')];
const rowBelow = (by = 1) => document.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${Number(nestedGroupRow().dataset["gridRowIndex"]) + by}"]`)!;
const label = () => gridCells(nestedGroupRow())[0]!;
const ring = () => document.querySelector<HTMLElement>("[data-grid-active-cell-overlay]");
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function shiftClick(el: HTMLElement) {
  await userEvent.keyboard("{Shift>}");
  await userEvent.click(el);
  await userEvent.keyboard("{/Shift}");
}

function expectSameRect(a: DOMRect, b: DOMRect) {
  expect([a.left, a.top, a.right, a.bottom].map(Math.round)).toEqual([b.left, b.top, b.right, b.bottom].map(Math.round));
}

/** The selection overlays a viewer sees at a point, pointer-events aside. */
function selectionOverlaysAt(x: number, y: number): Element[] {
  const guard = document.createElement("style");
  guard.textContent = "* { pointer-events: auto !important; }";
  document.head.append(guard);
  try {
    return document.elementsFromPoint(x, y).filter((el) => el.hasAttribute("data-grid-selection-overlay"));
  } finally {
    guard.remove();
  }
}

describe("the active outline of a group label", () => {
  it.each<[string, Variant]>([
    ["ltr", {}],
    ["rtl", { direction: "rtl" }],
    ["a pinned first column", { pinFirst: true }],
  ])("covers the whole label span in %s", async (_, variant) => {
    await renderGrid(variant);
    await userEvent.click(label());
    await frames();
    expect(label().getAttribute("aria-colspan")).toBe("4");
    expectSameRect(ring()!.getBoundingClientRect(), label().getBoundingClientRect());
  });

  it("follows the label while a grid with a pinned first column scrolls", async () => {
    const grid = await renderGrid({ pinFirst: true, gridWidth: 500 });
    await userEvent.click(label());
    grid.scrollLeft = 120;
    grid.dispatchEvent(new Event("scroll"));
    await frames();
    expectSameRect(ring()!.getBoundingClientRect(), label().getBoundingClientRect());
  });

  it("covers one column on a data row", async () => {
    await renderGrid();
    const cell = gridCells(rowBelow())[1]!;
    await userEvent.click(cell);
    await frames();
    expectSameRect(ring()!.getBoundingClientRect(), cell.getBoundingClientRect());
  });
});

describe("the selected look of a group label", () => {
  it("tints the whole label span for the active label and for a range down from it", async () => {
    await renderGrid();
    await userEvent.click(label());
    await frames();
    const end = () => {
      const rect = label().getBoundingClientRect();
      return selectionOverlaysAt(rect.right - 6, rect.top + rect.height / 2);
    };
    expect(end()).toHaveLength(1);
    await shiftClick(gridCells(rowBelow(2))[0]!);
    await frames();
    expect(label().getAttribute("aria-selected")).toBe("true");
    expect(end()).toHaveLength(1);
  });
});

describe("the label text", () => {
  const text = () => label().querySelector<HTMLElement>("[data-grid-group-label] > span:last-child")!;

  it("shows whole when the span is wider than the text", async () => {
    await renderGrid();
    expect(text().scrollWidth).toBeLessThanOrEqual(text().clientWidth);
    expect(text().getBoundingClientRect().right).toBeLessThanOrEqual(label().getBoundingClientRect().right);
  });

  it("ends in an ellipsis when the span is narrower than the text", async () => {
    await renderGrid({ width: 40 });
    expect(text().scrollWidth).toBeGreaterThan(text().clientWidth);
    expect(getComputedStyle(text()).textOverflow).toBe("ellipsis");
  });
});

describe("paint parity of a group label", () => {
  it.each<[string, Variant]>([
    ["unpinned, radius 0", { theme: { "--radius": "0rem" } }],
    ["unpinned, radius 1rem, tinted primary, larger font", { theme: { "--radius": "1rem", "--primary": "oklch(0.55 0.2 260)" }, style: { fontSize: "20px" } }],
    ["pinned first column, radius 0", { pinFirst: true, theme: { "--radius": "0rem" } }],
    ["pinned first column, radius 1rem, tinted primary", { pinFirst: true, theme: { "--radius": "1rem", "--primary": "oklch(0.55 0.2 260)" } }],
  ])("paints nothing that differs from the row and selection layers, %s", async (_, variant) => {
    const grid = await renderGrid(variant);
    const states: PaintState[] = [
      { name: "default", apply: () => {} },
      { name: "hovered", apply: () => userEvent.hover(label()) },
      { name: "active", apply: () => userEvent.click(label()) },
      { name: "selected along the row", apply: () => shiftClick(gridCells(nestedGroupRow())[2]!) },
      { name: "selected down from the label", apply: async () => {
        await userEvent.click(label());
        await shiftClick(gridCells(rowBelow())[1]!);
      } },
      { name: "hovered inside the range", apply: () => userEvent.hover(label()) },
    ];
    await expectNoPaintMismatch(grid, states);
  });
});
