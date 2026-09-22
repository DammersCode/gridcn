import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid, gridAttrSelector } from "../data-grid";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply (same convention as column-ux.browser.test.tsx)
import "@/app/global.css";

type Row = { id: string; name: string };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}` }));
}

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 }] as const);

/** All rendered data rows (the header layer has role="row" too, but never the row-index attribute). */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[role="row"]${gridAttrSelector("rowIndex")}`)];
}

/** The row's first data cell (the marker cell is a gridcell too — exclude it). */
function dataCell(row: HTMLElement): HTMLElement {
  return row.querySelector(`[role="gridcell"]:not(${gridAttrSelector("markerCell")})`)!;
}

/** Visual top-to-bottom order of the rows, by their first data cell's text. */
function visualOrder(): string[] {
  return [...rows()]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .map((r) => dataCell(r).textContent!);
}

function markerCell(viewRowIndex: number): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-grid-row-index="${viewRowIndex}"]`)!;
  return row.querySelector<HTMLElement>(gridAttrSelector("markerCell"))!;
}

async function markerDrag(viewRowIndex: number, toX: number, toY: number, opts?: { steps?: number; shift?: boolean }) {
  const from = markerCell(viewRowIndex);
  const rect = from.getBoundingClientRect();
  await from.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      pointerId: 1,
      shiftKey: opts?.shift ?? false,
      clientX: rect.left + 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
  const steps = opts?.steps ?? 1;
  for (let i = 1; i <= steps; i++) {
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, shiftKey: opts?.shift ?? false, clientX: toX, clientY: toY }));
    await new Promise((r) => requestAnimationFrame(r));
  }
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, shiftKey: opts?.shift ?? false }));
  await new Promise((r) => requestAnimationFrame(r));
}

describe("row reorder (marker drag)", () => {
  it("dragging a marker vertically past other rows reorders the rows (DOM identity preserved)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="reorder" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(visualOrder()).toEqual(["Person 0", "Person 1", "Person 2", "Person 3", "Person 4", "Person 5", "Person 6", "Person 7"]);

    // the same DOM node must survive the move (rows are keyed by getRowId)
    const draggedNode = document.querySelector('[data-grid-row-index="0"]')!;

    const target = rows().find((r) => dataCell(r).textContent === "Person 3")!;
    const targetRect = target.getBoundingClientRect();
    const startX = markerCell(0).getBoundingClientRect().left + 2;

    // drop on the BOTTOM half of row 3: row 0 lands at final position 3
    await markerDrag(0, startX, targetRect.top + targetRect.height - 5, { steps: 3 });

    expect(visualOrder()).toEqual(["Person 1", "Person 2", "Person 3", "Person 0", "Person 4", "Person 5", "Person 6", "Person 7"]);
    // re-keyed in place, not remounted: the pre-drag node still owns "Person 0"
    expect(draggedNode.isConnected).toBe(true);
    expect(dataCell(draggedNode).textContent).toBe("Person 0");
  });

  it("a plain click on the marker still selects the row and never reorders", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = markerCell(2);
    const markerRect = marker.getBoundingClientRect();
    marker.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: markerRect.left + 2, clientY: markerRect.top + 2 }));
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, clientX: markerRect.left + 2, clientY: markerRect.top + 2 }));
    await new Promise((r) => requestAnimationFrame(r));

    expect(marker).toHaveAttribute("data-row-selected");
    expect(visualOrder()[0]).toBe("Person 0");
    expect(document.querySelectorAll(gridAttrSelector("dropIndicator"))).toHaveLength(0);
  });

  it("shift+drag from the marker always extends the row selection, never reorders", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const target = rows().find((r) => dataCell(r).textContent === "Person 3")!;
    const targetRect = target.getBoundingClientRect();
    const startX = markerCell(0).getBoundingClientRect().left + 2;

    await markerDrag(0, startX, targetRect.top + targetRect.height - 5, { steps: 3, shift: true });

    // order must be unchanged — shift+drag never reorders regardless of movement
    expect(visualOrder()[0]).toBe("Person 0");
    // the shift+drag extended the row selection over rows 0..3
    const selected = rows().filter((r) => r.querySelector<HTMLElement>(gridAttrSelector("markerCell"))!.hasAttribute("data-row-selected"));
    expect(selected).toHaveLength(4);
  });

  it("a drag from the checkbox glyph stays the row-select gesture (no reorder)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const checkbox = markerCell(0).querySelector(gridAttrSelector("markerCheckbox"))!;
    const checkboxRect = checkbox.getBoundingClientRect();
    const target = rows().find((r) => dataCell(r).textContent === "Person 2")!;
    const targetRect = target.getBoundingClientRect();

    await checkbox.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: checkboxRect.left + 2, clientY: checkboxRect.top + 2 }),
    );
    for (let i = 1; i <= 3; i++) {
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: checkboxRect.left + 2, clientY: targetRect.top + targetRect.height / 2 }));
      await new Promise((r) => requestAnimationFrame(r));
    }
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));

    expect(visualOrder()[0]).toBe("Person 0");
    const selected = rows().filter((r) => r.querySelector<HTMLElement>(gridAttrSelector("markerCell"))!.hasAttribute("data-row-selected"));
    expect(selected).toHaveLength(3);
  });

  it("shows exactly one drop indicator at the boundary row's edge during the drag", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="reorder" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const dragged = markerCell(0);
    const rect = dragged.getBoundingClientRect();
    const target = rows().find((r) => dataCell(r).textContent === "Person 3")!;
    const targetRect = target.getBoundingClientRect();

    // arm the drag by hovering the TOP half of row 3 (indicator above row 3)
    await dragged.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }));
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: rect.left + 2, clientY: targetRect.top + 4 }));
    await new Promise((r) => requestAnimationFrame(r));

    const indicators = document.querySelectorAll(gridAttrSelector("dropIndicator"));
    expect(indicators).toHaveLength(1);
    const indicatorRect = indicators[0]!.getBoundingClientRect();
    expect(Math.abs(indicatorRect.top - targetRect.top)).toBeLessThan(2);
    expect(indicators[0]).toHaveAttribute("aria-hidden", "true");

    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.querySelectorAll(gridAttrSelector("dropIndicator"))).toHaveLength(0);
  });

  it("enableRowReorder=false leaves a marker drag as pure row selection", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" enableRowReorder={false} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const target = rows().find((r) => dataCell(r).textContent === "Person 3")!;
    const targetRect = target.getBoundingClientRect();
    const startX = markerCell(0).getBoundingClientRect().left + 2;

    await markerDrag(0, startX, targetRect.top + targetRect.height - 5, { steps: 3 });

    expect(visualOrder()[0]).toBe("Person 0");
    expect(document.querySelectorAll(gridAttrSelector("dropIndicator"))).toHaveLength(0);
  });

  it("renders a grip handle with an a11y label in reorder mode and announces the move", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="reorder" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const marker = markerCell(0);
    expect(marker.querySelector(gridAttrSelector("reorderHandle"))).not.toBeNull();
    expect(marker).toHaveAttribute("aria-label", "Reorder row 1");

    const target = rows().find((r) => dataCell(r).textContent === "Person 2")!;
    const targetRect = target.getBoundingClientRect();
    const startX = marker.getBoundingClientRect().left + 2;
    await markerDrag(0, startX, targetRect.top + targetRect.height - 5, { steps: 3 });

    // row 1 (1-based) dropped onto row 3's bottom half lands at final position 3
    expect(visualOrder()[0]).toBe("Person 1");
    const liveRegion = [...document.querySelectorAll('[role="status"]')].find((el) => el.textContent?.includes("moved to position"));
    expect(liveRegion?.textContent).toBe("Row 1 moved to position 3 of 8");
  });
});
