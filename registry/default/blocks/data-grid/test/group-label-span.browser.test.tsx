import { page, userEvent } from "vitest/browser";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "../data-grid";
import { gridAttrSelector } from "../data-grid-sdk";
import { DEFAULT_ALLOW, expectNoPaintMismatch, type PaintState } from "./paint-parity.test-helper";
import "@/app/global.css";

type Sale = { id: string; customer: string; region: string; dealership: string; make: string; price: number; discount: number };

const makeColumns = (opts: { pinFirst?: boolean; pinLastEnd?: boolean; width?: number; firstWidth?: number }) =>
  defineColumns<Sale>()([
    { id: "customer", header: "Customer", accessorKey: "customer", type: "text", width: opts.firstWidth ?? opts.width ?? 150, ...(opts.pinFirst ? { pin: "start" as const } : {}) },
    { id: "region", header: "Region", accessorKey: "region", type: "text", width: opts.width ?? 100 },
    { id: "dealership", header: "Dealership", accessorKey: "dealership", type: "text", width: opts.width ?? 170 },
    { id: "make", header: "Make", accessorKey: "make", type: "text", width: opts.width ?? 100 },
    { id: "price", header: "Price", accessorKey: "price", type: "number", width: 120, aggregate: "sum" },
    { id: "discount", header: "Discount", accessorKey: "discount", type: "number", width: 120, aggregate: "avg", ...(opts.pinLastEnd ? { pin: "end" as const } : {}) },
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
type Variant = { pinFirst?: boolean; pinLastEnd?: boolean; markers?: boolean; direction?: "ltr" | "rtl"; width?: number; firstWidth?: number; gridWidth?: number; theme?: Record<string, string> };

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
    <div dir={variant.direction} style={{ width: variant.gridWidth ?? 900 }}>
      <DataGrid
        data={data}
        columns={makeColumns(variant)}
        getRowId={(r) => r.id}
        groupBy={["region", "dealership"]}
        defaultExpanded={{ mode: "expanded", ids: [] }}
        direction={variant.direction}
        rowMarkers={variant.markers ? "checkbox" : "none"}
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
/** The active outline: the ring overlay, or the active cell that draws its own ring. */
function activeOutlineRect(): DOMRect {
  const overlay = document.querySelector<HTMLElement>("[data-grid-active-cell-overlay]");
  if (overlay) return overlay.getBoundingClientRect();
  const cell = document.querySelector<HTMLElement>('[role="gridcell"][data-active]')!;
  const after = getComputedStyle(cell, "::after");
  expect(after.boxShadow).not.toBe("none");
  expect([after.position, after.inset]).toEqual(["absolute", "0px"]);
  return cell.getBoundingClientRect();
}
const outlines = () => q("[data-grid-selection-overlay]").filter((el) => getComputedStyle(el).borderLeftWidth !== "0px");
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

async function shiftClick(el: HTMLElement) {
  await userEvent.keyboard("{Shift>}");
  await userEvent.click(el);
  await userEvent.keyboard("{/Shift}");
}

function expectSameRect(a: DOMRect, b: DOMRect) {
  expect([a.left, a.top, a.right, a.bottom].map(Math.round)).toEqual([b.left, b.top, b.right, b.bottom].map(Math.round));
}

/** The selection fills a viewer sees at a point, pointer-events aside. */
function selectionOverlaysAt(x: number, y: number): Element[] {
  const guard = document.createElement("style");
  guard.textContent = "* { pointer-events: auto !important; }";
  document.head.append(guard);
  try {
    return document.elementsFromPoint(x, y).filter((el) => el.hasAttribute("data-grid-selection-overlay") && getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)");
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
    expectSameRect(activeOutlineRect(), label().getBoundingClientRect());
  });

  it("follows the label while a grid with a pinned first column scrolls", async () => {
    const grid = await renderGrid({ pinFirst: true, gridWidth: 500 });
    await userEvent.click(label());
    grid.scrollLeft = 120;
    grid.dispatchEvent(new Event("scroll"));
    await frames();
    expectSameRect(activeOutlineRect(), label().getBoundingClientRect());
  });

  it("stays under a pinned-end column that covers the label", async () => {
    await renderGrid({ pinLastEnd: true, gridWidth: 500 });
    await userEvent.click(label());
    await frames();
    const pinnedEnd = gridCells(nestedGroupRow()).at(-1)!;
    const rect = pinnedEnd.getBoundingClientRect();
    expect(rect.left).toBeLessThan(label().getBoundingClientRect().right);
    const guard = document.createElement("style");
    guard.textContent = "* { pointer-events: auto !important; }";
    document.head.append(guard);
    const top = document.elementFromPoint(rect.left + rect.width / 2, label().getBoundingClientRect().top + 1);
    guard.remove();
    expect(pinnedEnd.contains(top)).toBe(true);
  });

  it("puts the touch handles at the label corners", async () => {
    await renderGrid({ pinFirst: true });
    const rect = label().getBoundingClientRect();
    const point = { clientX: rect.left + 20, clientY: rect.top + rect.height / 2 };
    label().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, ...point }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, ...point }));
    await frames();
    const end = document.querySelector<HTMLElement>(`${gridAttrSelector("selectionHandle")}[data-grid-selection-handle="end"]`)!.getBoundingClientRect();
    expect(Math.abs(end.left + end.width / 2 - rect.right)).toBeLessThan(2);
    expect(Math.abs(end.top + end.height / 2 - rect.bottom)).toBeLessThan(2);
  });

  it("covers one column on a data row", async () => {
    await renderGrid();
    const cell = gridCells(rowBelow())[1]!;
    await userEvent.click(cell);
    await frames();
    expectSameRect(activeOutlineRect(), cell.getBoundingClientRect());
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

describe("the outline of a selection across group rows", () => {
  const overlaps = (r: DOMRect, l: DOMRect) => r.left < l.right - 1 && r.right > l.left + 1 && r.top < l.bottom - 1 && r.bottom > l.top + 1;
  /** The bordered selection overlays over the label of `row`. */
  const outlinesOver = (row = nestedGroupRow()) => {
    const rect = gridCells(row)[0]!.getBoundingClientRect();
    return outlines().filter((el) => overlaps(el.getBoundingClientRect(), rect));
  };
  /** One bordered overlay on the group row, and it is the label rect. */
  function expectOneLabelOutline(row = nestedGroupRow()) {
    const over = outlinesOver(row);
    expect(over).toHaveLength(1);
    expectSameRect(over[0]!.getBoundingClientRect(), gridCells(row)[0]!.getBoundingClientRect());
  }
  /** No bordered overlay draws an edge inside a label. */
  function expectNoEdgeInsideLabels() {
    for (const row of groupRows()) {
      const rect = gridCells(row)[0]!.getBoundingClientRect();
      for (const el of outlinesOver(row)) {
        const r = el.getBoundingClientRect();
        expect([r.left <= rect.left + 1, r.right >= rect.right - 1]).toEqual([true, true]);
      }
    }
  }
  const secondNestedGroupRow = () => groupRows().filter((row) => row.getAttribute("aria-level") === "2")[1]!;
  const rowAt = (index: number) => document.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${index}"]`)!;

  it.each<[string, Variant, number]>([
    ["from the Region column", {}, 1],
    ["from the Make column", {}, 3],
    ["with a pinned first column", { pinFirst: true }, 1],
    ["under RTL", { direction: "rtl" }, 1],
  ])("draws one outline over the whole label for ArrowUp onto it %s", async (_, variant, col) => {
    await renderGrid(variant);
    await userEvent.click(gridCells(rowBelow())[col]!);
    await userEvent.keyboard("{ArrowUp}");
    await frames();
    expectOneLabelOutline();
  });

  it("draws one outline over the whole label for ArrowDown onto it", async () => {
    await renderGrid();
    const target = secondNestedGroupRow();
    await userEvent.click(gridCells(rowAt(Number(target.dataset["gridRowIndex"]) - 1))[2]!);
    await userEvent.keyboard("{ArrowDown}");
    await frames();
    expectOneLabelOutline(secondNestedGroupRow());
  });

  it("draws one outline over the whole label for a click inside it", async () => {
    await renderGrid();
    const rect = label().getBoundingClientRect();
    await userEvent.click(label(), { position: { x: rect.width - 20, y: rect.height / 2 } });
    await frames();
    expectOneLabelOutline();
  });

  it.each<[string, Variant]>([
    ["unpinned", {}],
    ["with a pinned first column", { pinFirst: true }],
  ])("draws one outline over the whole label for Shift+ArrowUp from a data row, %s", async (_, variant) => {
    await renderGrid(variant);
    await userEvent.click(gridCells(rowBelow())[1]!);
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await frames();
    expectOneLabelOutline();
    expectNoEdgeInsideLabels();
  });

  it.each<[string, Variant]>([
    ["unpinned", {}],
    ["with a pinned first column", { pinFirst: true }],
  ])("draws no edge inside a label for select all and a row band, %s", async (_, variant) => {
    await renderGrid(variant);
    await userEvent.click(label());
    await userEvent.keyboard("{Control>}a{/Control}");
    await userEvent.keyboard("{Control>}a{/Control}");
    await frames();
    expectNoEdgeInsideLabels();
    await userEvent.click(gridCells(rowBelow())[2]!);
    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}{Shift>} {/Shift}");
    await frames();
    expectNoEdgeInsideLabels();
  });

  it("shows no frame with a box inside the label across ArrowUp", async () => {
    await renderGrid();
    await userEvent.click(gridCells(rowBelow())[1]!);
    await frames();
    const partial: string[] = [];
    const sample = () => {
      const rect = label().getBoundingClientRect();
      for (const el of outlinesOver()) {
        const r = el.getBoundingClientRect();
        if (r.left > rect.left + 1 || r.right < rect.right - 1) partial.push(`${Math.round(r.left)}-${Math.round(r.right)}`);
      }
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    let running = true;
    const tick = () => {
      if (!running) return;
      sample();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    for (let i = 0; i < 6; i++) await frames();
    running = false;
    observer.disconnect();
    expect(label().hasAttribute("data-active")).toBe(true);
    expect(partial).toEqual([]);
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
    ["unpinned, radius 1rem, tinted primary, larger font", { theme: { "--radius": "1rem", "--primary": "oklch(0.55 0.2 260)", "font-size": "20px" } }],
    ["a first column narrower than the label text", { firstWidth: 60 }],
    ["pinned first column, radius 0", { pinFirst: true, theme: { "--radius": "0rem" } }],
    ["pinned first column, radius 1rem, tinted primary", { pinFirst: true, theme: { "--radius": "1rem", "--primary": "oklch(0.55 0.2 260)" } }],
    ["row markers, unpinned", { markers: true }],
    ["row markers, pinned first column", { markers: true, pinFirst: true }],
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
      { name: "ArrowUp onto the label from the Region column", apply: async () => {
        await userEvent.click(gridCells(rowBelow())[1]!);
        await userEvent.keyboard("{ArrowUp}");
      } },
      { name: "row band over the label", apply: async () => {
        await userEvent.click(label());
        await userEvent.keyboard("{Shift>} {/Shift}");
      } },
      { name: "column band over the label", apply: async () => {
        await userEvent.click(label());
        await userEvent.keyboard("{Control>} {/Control}");
      } },
      { name: "two ranges over the label", apply: async () => {
        await userEvent.click(label());
        await userEvent.keyboard("{Control>}");
        await userEvent.click(gridCells(rowBelow())[1]!);
        await userEvent.keyboard("{/Control}");
        await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
      } },
      ...(variant.markers
        ? [{ name: "checked rows", apply: async () => {
            await userEvent.keyboard("{Escape}");
            await userEvent.click(rowBelow().querySelector<HTMLElement>('[role="checkbox"]')!);
            await userEvent.click(rowBelow(2).querySelector<HTMLElement>('[role="checkbox"]')!);
          } }]
        : []),
    ];
    // A selected marker paints the selection tint itself: the overlay does not reach the marker column.
    await expectNoPaintMismatch(grid, states, { allow: `${DEFAULT_ALLOW}, [data-grid-marker-cell][data-row-selected]` });
  });
});
