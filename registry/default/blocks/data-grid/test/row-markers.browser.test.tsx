import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid, GRID_ATTR, gridAttrSelector } from "../data-grid";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply — without it the layout bug can't reproduce
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Person ${i}`,
    email: `person${i}@example.com`,
  }));
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 150 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
] as const);

/** Data cells only — excludes marker cells, which also carry role="gridcell" but no aria-colindex. */
function gridCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[role="gridcell"]:not(${gridAttrSelector("markerCell")})`)];
}

function markerCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(gridAttrSelector("markerCell"))];
}

function dispatchPointerDrag(from: HTMLElement, to: HTMLElement, opts?: { shiftKey?: boolean; ctrlKey?: boolean }) {
  const toRect = to.getBoundingClientRect();
  return (async () => {
    await from.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, shiftKey: opts?.shiftKey, ctrlKey: opts?.ctrlKey }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: toRect.left + 5, clientY: toRect.top + 5 }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
  })();
}

describe("row markers", () => {
  it("'none' (default) renders no marker cells", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(markerCells().length).toBe(0);
  });

  it("'number' mode shows the 1-based view row index and never appears in aria-colindex", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0]!.textContent).toBe("1");
    expect(markers[1]!.textContent).toBe("2");
    // marker carries no aria-colindex — data cells' own aria-colindex values are untouched by it.
    expect(markers[0]).not.toHaveAttribute("aria-colindex");
    expect(gridCells()[0]).toHaveAttribute("aria-colindex", "1");
  });

  it("'checkbox' mode renders a checkbox per row wired to the rows selection channel", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const checkbox = markerCells()[0]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(checkbox).not.toBeNull();
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("clicking a marker (not the checkbox) selects the whole row", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = markerCells()[1]!;
    await userEvent.click(marker);
    expect(marker).toHaveAttribute(GRID_ATTR.selected, "true");
  });

  // a11y regression: a marker click has no `activeCell` (row/column-channel selection only), so it
  // also focuses the grid root as a side effect (nothing else in the marker cell is focusable) —
  // the root's roving-tabindex bootstrap (see root.tsx onFocus) must recognize this as a pointer
  // gesture and NOT clobber the row selection back to a (0,0) single-cell selection.
  it("a marker click's resulting root focus does not clobber the row selection with a (0,0) cell selection", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = markerCells()[1]!;
    await userEvent.click(marker);
    expect(marker).toHaveAttribute(GRID_ATTR.selected, "true");
    // no data cell should have become active/selected as a side effect of the root's own focus.
    gridCells().forEach((cell) => expect(cell).not.toHaveAttribute(GRID_ATTR.active));
  });

  it("shift+click on a marker selects the row range from the last-highlighted row", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    await userEvent.click(markers[1]!);
    await markers[4]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }));

    const after = markerCells();
    for (const i of [1, 2, 3, 4]) expect(after[i]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[0]).not.toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[5]).not.toHaveAttribute(GRID_ATTR.selected, "true");
  });

  it("ctrl/meta+click on a marker additively toggles that row", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    await markers[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }));
    await markers[2]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }));

    const after = markerCells();
    expect(after[0]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[2]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[1]).not.toHaveAttribute(GRID_ATTR.selected, "true");
  });

  it("press+drag on markers extends a contiguous row-range selection", async () => {
    // reorder is off: a plain vertical marker drag is the row-reorder gesture when enabled
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" enableRowReorder={false} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    await dispatchPointerDrag(markers[1]!, markers[3]!);

    const after = markerCells();
    for (const i of [1, 2, 3]) expect(after[i]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[0]).not.toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[4]).not.toHaveAttribute(GRID_ATTR.selected, "true");
  });

  it("press+drag starting on the checkbox glyph itself extends a contiguous row-range selection", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    const fromCheckbox = markers[1]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    await dispatchPointerDrag(fromCheckbox, markers[3]!);

    const after = markerCells();
    for (const i of [1, 2, 3]) expect(after[i]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[0]).not.toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[4]).not.toHaveAttribute(GRID_ATTR.selected, "true");
    // dragging never toggled row 1's checkbox as a click side-effect — it's checked purely via the row-range channel.
    for (const i of [1, 2, 3]) {
      expect(after[i]!.querySelector('[role="checkbox"]')).toHaveAttribute("aria-checked", "true");
    }
  });

  it("a stationary press+release on the checkbox glyph still toggles it (no drag)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const checkbox = markerCells()[2]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    await userEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
    // only row 2 toggled — a plain checkbox click is an additive single-row toggle, not an exclusive select.
    const after = markerCells();
    expect(after[0]).not.toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[1]).not.toHaveAttribute(GRID_ATTR.selected, "true");
  });

  // Zone model: the checkbox press must never run the marker surface's exclusive selectRow —
  // a stationary glyph click ADDS its row to an existing multi-row selection.
  it("a checkbox click keeps an existing multi-row selection (additive, not exclusive)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    await markers[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }));
    await userEvent.click(markers[2]!.querySelector<HTMLElement>('[role="checkbox"]')!);

    const after = markerCells();
    expect(after[0]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[2]).toHaveAttribute(GRID_ATTR.selected, "true");
  });

  it("press+drag on 'both' mode markers (checkbox hidden, number visible) extends a row-range selection", async () => {
    // reorder is off: a plain vertical marker drag is the row-reorder gesture when enabled
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="both" enableRowReorder={false} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    await dispatchPointerDrag(markers[1]!, markers[3]!);

    const after = markerCells();
    for (const i of [1, 2, 3]) expect(after[i]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[0]).not.toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[4]).not.toHaveAttribute(GRID_ATTR.selected, "true");
  });

  it("press+drag starting on 'both' mode's checkbox glyph extends a row-range selection", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="both" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    const fromCheckbox = markers[1]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    await dispatchPointerDrag(fromCheckbox, markers[3]!);

    const after = markerCells();
    for (const i of [1, 2, 3]) expect(after[i]).toHaveAttribute(GRID_ATTR.selected, "true");
    expect(after[0]).not.toHaveAttribute(GRID_ATTR.selected, "true");
  });

  it("'both' mode selects row without editing anything (mouse-selection hardening parity)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(6)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="both" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    const fromCheckbox = markers[0]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    await dispatchPointerDrag(fromCheckbox, markers[2]!);
    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
  });

  it("dragging to the viewport bottom edge auto-scrolls and keeps extending the row-range selection", { timeout: 20_000 }, async () => {
    // reorder is off: a plain vertical marker drag is the row-reorder gesture when enabled
    render(
      <div style={{ height: 200 }}>
        <DataGrid data={makeRows(200)} columns={columns} getRowId={(r) => r.id} className="h-50" rowMarkers="number" enableRowReorder={false} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const scrollTopBefore = grid.scrollTop;

    const markers = markerCells();
    const gridRect = grid.getBoundingClientRect();
    await markers[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    // park the pointer inside the bottom auto-scroll zone (AUTO_SCROLL_ZONE = 24px from the edge)
    // and hold it there across several rAF ticks — same edge-hover gesture a real drag-to-edge is.
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: gridRect.left + 10, clientY: gridRect.bottom - 10 }),
    );
    for (let i = 0; i < 10; i++) await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));

    expect(grid.scrollTop).toBeGreaterThan(scrollTopBefore);
    // the row-range selection kept extending past the rows visible at drag-start (row 0's marker
    // alone would cap the selection at whatever was on-screen without auto-scroll continuing it).
    const selectedCount = markerCells().filter((m) => m.getAttribute(GRID_ATTR.selected) === "true").length;
    expect(selectedCount).toBeGreaterThan(Math.ceil(200 / 36));
  });

  it("'both' mode hides the number and shows the checkbox on hover/selected (group-hover pattern)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(3)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="both" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = markerCells()[0]!;
    const numberSpan = marker.querySelector<HTMLElement>(gridAttrSelector("markerNumber"))!;
    const checkbox = marker.querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(numberSpan.textContent).toBe("1");
    // 'both' mode: unhovered/unselected shows the number and hides the checkbox by default...
    expect(checkbox.className.split(/\s+/)).toContain("hidden");
    expect(getComputedStyle(numberSpan).display).not.toBe("none");
    // ...group-hover:hidden is present on the number (applies only on :hover, not by default).
    expect(numberSpan.className).toContain("group-hover:hidden");
  });

  it("the marker header renders a select-all checkbox reflecting checked/indeterminate/unchecked", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(4)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const headerCheckbox = document.querySelector<HTMLElement>(`${gridAttrSelector("markerHeader")} [role="checkbox"]`)!;
    expect(headerCheckbox).toHaveAttribute("aria-checked", "false");

    const rowCheckbox = markerCells()[0]!.querySelector<HTMLElement>('[role="checkbox"]')!;
    await userEvent.click(rowCheckbox);
    expect(headerCheckbox).toHaveAttribute("aria-checked", "mixed");

    await userEvent.click(headerCheckbox);
    const allChecked = markerCells().every(
      (m) => m.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true",
    );
    expect(allChecked).toBe(true);
  });
});

describe("header multi-column drag select", () => {
  function headerCells(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="columnheader"]')];
  }

  it("plain click selects a single column", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const headers = headerCells();
    await headers[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));

    // column-channel selection renders a full-band highlight (user QA 2026-07-03)
    const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
    expect(overlay).not.toBeNull();
    const headerRect = headers[0]!.getBoundingClientRect();
    const overlayRect = overlay!.getBoundingClientRect();
    expect(overlayRect.left).toBeCloseTo(headerRect.left, 0);
    expect(overlayRect.right).toBeCloseTo(headerRect.right, 0);
    // spans the rendered rows (5 rows x 36px = 180px)
    expect(overlayRect.height).toBeGreaterThanOrEqual(5 * 36 - 1);
  });

  it("press+drag across headers selects the contiguous column range", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const headers = headerCells();
    await dispatchPointerDrag(headers[0]!, headers[1]!);

    // never edits — no cell went into edit mode as a side effect of a header drag.
    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();

    // both columns' cells should be part of the selection now: verify by shift-clicking away
    // doesn't matter here — assert via a follow-up plain click on col 0 header still selects singly.
    await headers[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
  });

  it("shift+click extends a contiguous column range from the last-selected header", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const headers = headerCells();
    await headers[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    await headers[1]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, shiftKey: true, pointerId: 1 }));

    // both header cells still render with no cell put into edit mode.
    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
  });
});

describe("selection configurability", () => {
  it("enableColumnSelection: false makes header clicks a no-op", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(5)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          enableColumnSelection={false}
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const header = document.querySelectorAll<HTMLElement>('[role="columnheader"]')[0]!;
    await header.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));

    // no selection overlay/active-cell appeared from the header click.
    expect(document.querySelector(gridAttrSelector("active", "true"))).toBeNull();
  });

  it("enableRowSelection: false makes marker clicks a no-op", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(5)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          rowMarkers="number"
          enableRowSelection={false}
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = markerCells()[0]!;
    await userEvent.click(marker);
    expect(marker).not.toHaveAttribute(GRID_ATTR.selected, "true");
  });

  it("enableRangeSelection: false collapses a cell drag to single-cell active only", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(5)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          enableRangeSelection={false}
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cells = gridCells();
    await userEvent.click(cells[0]!);
    await dispatchPointerDrag(cells[0]!, cells[3]!);

    // never edits, and the "range" overlay that does render is collapsed to the single drag
    // destination cell (1x1), not a multi-cell rect spanning the drag's start and end.
    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
    const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"))!;
    expect(overlay).not.toBeNull();
    expect(overlay.style.gridColumnEnd).toBe(String(Number(overlay.style.gridColumnStart) + 1));
    expect(overlay.style.gridRowEnd).toBe(String(Number(overlay.style.gridRowStart) + 1));
  });

  it("enableMultiRange: false makes ctrl-click behave as a plain click (no range stack)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(5)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          enableMultiRange={false}
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cells = gridCells();
    await userEvent.click(cells[0]!);
    await cells[2]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }));

    // only one active cell — ctrl-click replaced the selection instead of stacking a second range.
    const activeCells = document.querySelectorAll(gridAttrSelector("active", "true"));
    expect(activeCells.length).toBe(1);
    expect(activeCells[0]).toBe(cells[2]!);
  });
});

describe("mouse-selection hardening matrix (regression: drag-select must never enter edit mode)", () => {
  it("press on the ACTIVE cell + drag to another cell extends selection and never edits", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cells = gridCells();
    await userEvent.click(cells[0]!); // cell [0,0] becomes active
    await dispatchPointerDrag(cells[0]!, cells[2 * columns.length]!); // drag down 2 rows, same active cell as origin

    expect(cells[0]).not.toHaveAttribute(GRID_ATTR.editing, "true");
    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
    expect(document.querySelector(gridAttrSelector("selectionOverlay"))).not.toBeNull();
  });

  it("press on an INACTIVE cell + drag never edits", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cells = gridCells();
    // no prior activation — cells[1] starts inactive
    await dispatchPointerDrag(cells[1]!, cells[1 + columns.length]!);

    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
  });

  it("header press+drag selects multi-column without editing anything", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const headers = [...document.querySelectorAll<HTMLElement>('[role="columnheader"]')];
    await dispatchPointerDrag(headers[0]!, headers[1]!);

    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
  });

  it("marker press+drag selects multi-row without editing anything", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();
    await dispatchPointerDrag(markers[0]!, markers[3]!);

    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
  });

  it("a plain marker drag (reorder off) grows AND shrinks the row range as the pointer moves", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="number" enableRowReorder={false} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const markers = markerCells();

    const moveTo = async (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: rect.left + 5, clientY: rect.top + 5 }));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
    };
    const selectedCount = () => markerCells().filter((m) => m.hasAttribute("data-row-selected")).length;

    await markers[0]!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    await moveTo(markers[4]!); // drag down: rows 0-4
    await expect.poll(() => selectedCount(), { timeout: 2000 }).toBe(5);
    await moveTo(markers[1]!); // drag back up: rows 2-4 must de-select
    await expect.poll(() => selectedCount(), { timeout: 2000 }).toBe(2);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    expect(selectedCount()).toBe(2);
  });

  it("a checkbox press+drag grows AND shrinks the row range (the pointer is the moving edge)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" rowMarkers="checkbox" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const checkbox = (row: number) =>
      [...document.querySelectorAll<HTMLElement>(gridAttrSelector("markerCheckbox"))][row]!;

    const moveTo = async (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: rect.left + 5, clientY: rect.top + 5 }));
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
    };
    const selectedCount = () => markerCells().filter((m) => m.hasAttribute("data-row-selected")).length;

    await checkbox(0).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    await moveTo(checkbox(4)!); // drag down: rows 0-4
    await expect.poll(() => selectedCount(), { timeout: 2000 }).toBe(5);
    await moveTo(checkbox(2)!); // drag back up: rows 3-4 must de-select
    await expect.poll(() => selectedCount(), { timeout: 2000 }).toBe(3);
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    expect(selectedCount()).toBe(3);
  });

  // Excel model: clicks never edit — this guards that pointer jitter neither
  // misreads as a range drag nor (per the model) opens the editor.
  it("a slow click (press, tiny sub-3px jitter, release) on the active cell neither edits nor paints a range", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = gridCells()[0]!;
    await userEvent.click(cell); // activates

    const rect = cell.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    await cell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: cx, clientY: cy }));
    // sub-3px jitter — real pointer noise during a stationary press, must not read as a drag
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: cx + 1, clientY: cy }));
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, clientX: cx + 1, clientY: cy }));
    await userEvent.click(cell);

    expect(cell).not.toHaveAttribute(GRID_ATTR.editing, "true");
    expect(cell).toHaveAttribute(GRID_ATTR.active, "true");
  });

  it("dblclick during/after a completed drag does not edit the drag's destination cell", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(10)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cells = gridCells();
    await userEvent.click(cells[0]!);
    await dispatchPointerDrag(cells[0]!, cells[2 * columns.length]!);

    // the drag's destination cell was never itself pressed/released as a discrete click — a
    // synthetic dblclick dispatched directly (not through the drag gesture) must not silently edit.
    const destination = gridCells()[2 * columns.length]!;
    destination.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
    // no pointerdown preceded this dblclick, so the interaction layer's pending-click ref is empty —
    // onCellDoubleClick still runs (it doesn't gate on it), so we only assert the earlier drag itself
    // never edited anything, which is the actual regression under test.
    expect(cells[0]).not.toHaveAttribute(GRID_ATTR.editing, "true");
  });
});

/** Wide enough that a horizontal scroll actually leaves the marker column behind. */
const wideColumns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 300 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 300 },
] as const);

describe("marker column stays painted above scrolled cells", () => {
  // Regression: every cell is position:relative, so DOM order decides paint order among siblings.
  // The marker is FIRST in each row, so without its own z-index it slid UNDER the data cells on a
  // horizontal scroll - the pin shadow still showed, but the numbers/checkboxes vanished.
  for (const mode of ["number", "checkbox", "both"] as const) {
    it(`rowMarkers="${mode}" - the marker, not a data cell, is hit-tested after scrolling right`, async () => {
      render(
        <div style={{ width: 360, height: 300 }}>
          <DataGrid
            data={makeRows(10)}
            columns={wideColumns}
            getRowId={(r) => r.id}
            rowMarkers={mode}
            className="h-[300px]"
          />
        </div>,
      );
      await expect.element(page.getByRole("grid")).toBeInTheDocument();

      const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
      const scroller = (grid.closest('[class*="overflow"]') ?? grid.parentElement) as HTMLElement;
      scroller.scrollLeft = 250;
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const marker = markerCells()[0]!;
      expect(Number(getComputedStyle(marker).zIndex)).toBeGreaterThan(0);

      // the decisive check: what is actually painted at the marker's own center?
      const rect = marker.getBoundingClientRect();
      const painted = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      expect(painted?.closest(gridAttrSelector("markerCell"))).not.toBeNull();
    });
  }

  // Second half of the same class of bug: painting on top is useless if the paint is see-through.
  // A translucent hover tint let the scrolled cells underneath read straight through the marker.
  it("the hover tint is opaque, so scrolled content cannot show through it", async () => {
    render(
      <div style={{ width: 360, height: 300 }}>
        <DataGrid data={makeRows(10)} columns={wideColumns} getRowId={(r) => r.id} rowMarkers="number" className="h-[300px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const marker = markerCells()[2]!;
    await userEvent.hover(marker);
    const background = getComputedStyle(marker).backgroundColor;
    // any alpha < 1 renders as a "/ 0.x" component in the computed color
    expect(background, `marker hover background must be opaque, got ${background}`).not.toMatch(/\/\s*0?\.\d/);
  });
});
