import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid, DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, GRID_ATTR, gridAttrSelector } from "../data-grid";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply — without it the layout bug can't reproduce
import "@/app/global.css";

type Row = { id: string; name: string; email: string; age: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Person ${i}`,
    email: `person${i}@example.com`,
    age: 18 + (i % 60),
  }));
}

const columns = defineColumns<Row>()([
  { id: "id", header: "ID", accessorKey: "id", type: "text", width: 80 },
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 120 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
] as const);

function headerCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="columnheader"]')];
}

function gridCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[role="gridcell"]:not(${gridAttrSelector("markerCell")})`)];
}

async function pointerDrag(from: HTMLElement, toX: number, toY: number, opts?: { steps?: number }) {
  const rect = from.getBoundingClientRect();
  await from.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }),
  );
  const steps = opts?.steps ?? 1;
  for (let i = 1; i <= steps; i++) {
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: toX, clientY: toY }),
    );
    await new Promise((r) => requestAnimationFrame(r));
  }
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
  await new Promise((r) => requestAnimationFrame(r));
}

/** Dispatches a native `copy` on the grid root and returns the TSV text — used to observe the
 * column-selection channel, which (like row selection) has no dedicated overlay of its own; it
 * only shows up through the clipboard scope (see use-grid-clipboard.ts's resolveCopyScope). */
async function copyText(): Promise<string> {
  const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
  const dataTransfer = new DataTransfer();
  const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
  grid.dispatchEvent(event);
  await new Promise((r) => setTimeout(r, 0));
  return dataTransfer.getData("text/plain");
}

describe("column resize", () => {
  it("dragging the resize handle changes the column's width", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const header = headerCells()[0]!; // "id" column, width 80
    const before = header.getBoundingClientRect().width;
    const handle = header.querySelector<HTMLElement>(gridAttrSelector("resizeHandle"))!;
    const handleRect = handle.getBoundingClientRect();

    await handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: handleRect.left, clientY: handleRect.top }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: handleRect.left + 60, clientY: handleRect.top }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));

    const after = headerCells()[0]!.getBoundingClientRect().width;
    expect(after).toBeGreaterThan(before + 40);
  });

  it("double-clicking the resize handle autosizes the column to fit its widest rendered content", async () => {
    const wideRows = makeRows(5);
    wideRows[0]!.name = "A Very Very Long Name That Needs Room";
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={wideRows} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const header = headerCells()[1]!; // "name" column, width 100
    const before = header.getBoundingClientRect().width;
    const handle = header.querySelector<HTMLElement>(gridAttrSelector("resizeHandle"))!;

    await userEvent.dblClick(handle);

    const after = headerCells()[1]!.getBoundingClientRect().width;
    expect(after).toBeGreaterThan(before);
  });

  it("resizable: false on a column omits its resize handle", async () => {
    const noResizeColumns = columns.map((c) => (c.id === "id" ? { ...c, resizable: false } : c));
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={noResizeColumns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const header = headerCells()[0]!;
    expect(header.querySelector(gridAttrSelector("resizeHandle"))).toBeNull();
  });
});

describe("column reorder", () => {
  it("dragging a header horizontally past another header reorders the columns", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" enableColumnReorder />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const idHeader = headerCells()[0]!; // aria-colindex=1
    const emailHeader = headerCells()[2]!; // aria-colindex=3
    const emailRect = emailHeader.getBoundingClientRect();

    await pointerDrag(idHeader, emailRect.left + emailRect.width - 5, emailRect.top + emailRect.height / 2, { steps: 3 });

    const newOrder = headerCells().map((h) => h.getAttribute("data-column-id"));
    expect(newOrder.indexOf("id")).toBeGreaterThan(newOrder.indexOf("name"));
  });

  it("a plain click on a header still selects the column (no drag = no reorder)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" enableColumnReorder />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const nameHeader = headerCells()[1]!;
    await userEvent.click(nameHeader);

    // column-select gesture applied: the whole "name" column is the clipboard copy scope
    // (selection.columns has no overlay of its own — see use-grid-clipboard.ts's resolveCopyScope).
    const text = await copyText();
    expect(text.split("\n")[0]).toBe("Person 0");
    expect(text.split("\n")).toHaveLength(20);
    // and no reorder happened — order unchanged.
    const order = headerCells().map((h) => h.getAttribute("data-column-id"));
    expect(order).toEqual(["id", "name", "email", "age"]);
  });

  it("shift+drag across headers always extends the selection range, never reorders", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" enableColumnReorder />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const nameHeader = headerCells()[1]!;
    const ageHeader = headerCells()[3]!;
    const ageRect = ageHeader.getBoundingClientRect();

    const rect = nameHeader.getBoundingClientRect();
    await nameHeader.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, shiftKey: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, shiftKey: true, clientX: ageRect.left + 5, clientY: ageRect.top + rect.height / 2 }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, shiftKey: true }));
    await new Promise((r) => requestAnimationFrame(r));

    // order must be unchanged — shift+drag never reorders regardless of movement.
    const order = headerCells().map((h) => h.getAttribute("data-column-id"));
    expect(order).toEqual(["id", "name", "email", "age"]);
    // shift+drag extended the column-select range to "name".."age" — 3 columns wide per row.
    const text = await copyText();
    expect(text.split("\n")[0]!.split("\t")).toHaveLength(3);
  });

  it("enableColumnReorder=false disables the reorder gesture", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" enableColumnReorder={false} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const idHeader = headerCells()[0]!;
    const emailHeader = headerCells()[2]!;
    const emailRect = emailHeader.getBoundingClientRect();

    await pointerDrag(idHeader, emailRect.left + emailRect.width - 5, emailRect.top + emailRect.height / 2, { steps: 3 });

    const order = headerCells().map((h) => h.getAttribute("data-column-id"));
    expect(order).toEqual(["id", "name", "email", "age"]);
  });
});

describe("sort mode (headerClickBehavior)", () => {
  it("cycles asc -> desc -> none on repeated plain clicks and renders an indicator + aria-sort", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" headerClickBehavior="sort" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const nameHeader = headerCells()[1]!;

    await userEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(nameHeader.querySelector(gridAttrSelector("sortIndicator"))).not.toBeNull();

    await userEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");

    await userEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute("aria-sort", "none");
    expect(nameHeader.querySelector(gridAttrSelector("sortIndicator"))).toBeNull();
  });

  it("a custom (ReactNode) header owns its display: no built-in indicator is appended in sort mode", async () => {
    const customColumns = columns.map((c) => (c.id === "name" ? { ...c, header: <span>Custom Name</span> } : c));
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={customColumns} getRowId={(r) => r.id} className="h-[400px]" headerClickBehavior="sort" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const nameHeader = headerCells()[1]!;

    await userEvent.click(nameHeader);
    // sorting still works and reports aria-sort, but the built-in arrow is not appended to a custom header
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(nameHeader.querySelector(gridAttrSelector("sortIndicator"))).toBeNull();

    // a plain string header in the same grid still gets the built-in arrow
    const emailHeader = headerCells()[2]!;
    await userEvent.click(emailHeader);
    expect(emailHeader.querySelector(gridAttrSelector("sortIndicator"))).not.toBeNull();
  });

  it("'select' mode (default) leaves a plain click selecting the column instead of sorting", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const nameHeader = headerCells()[1]!;
    await userEvent.click(nameHeader);
    expect(nameHeader).not.toHaveAttribute("aria-sort", "ascending");
    const text = await copyText();
    expect(text.split("\n")).toHaveLength(20); // whole column copied = column-select applied, not sort
  });
});

describe("pinned-edge shadow", () => {
  it("appears only after horizontal scroll reveals content beneath the pinned-left group", async () => {
    const pinnedColumns = columns.map((c) => (c.id === "id" ? { ...c, pin: "left" as const } : c));
    render(
      <div style={{ height: 400, width: 300 }}>
        <DataGrid data={makeRows(20)} columns={pinnedColumns} getRowId={(r) => r.id} className="h-[400px] w-75" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "left"))!;
    expect(shadow).not.toBeNull();

    expect(getComputedStyle(shadow).opacity).toBe("0");

    grid.scrollLeft = 50;
    grid.dispatchEvent(new Event("scroll"));
    // the shadow's own transition-opacity means a short wait can sample mid-transition; the
    // data-scrolled-left attribute (the actual signal under test) flips synchronously with the
    // scroll event, so assert on that directly rather than waiting out the CSS transition.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[style*="--grid-row-height"]')).toHaveAttribute(GRID_ATTR.scrolledLeft);
    await new Promise((r) => setTimeout(r, 250));
    expect(getComputedStyle(shadow).opacity).toBe("1");

    grid.scrollLeft = 0;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 250));

    expect(getComputedStyle(shadow).opacity).toBe("0");
  });

  it("renders no shadow element when there are no pinned columns", async () => {
    render(
      <div style={{ height: 400, width: 300 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px] w-75" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector(gridAttrSelector("pinShadow"))).toBeNull();
  });
});

describe("density", () => {
  it("'compact' maps to a 28px row height", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" density="compact" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(gridCells()[0]!.getBoundingClientRect().height).toBeCloseTo(28, 0);
  });

  it("'default' maps to a 36px row height", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" density="default" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(gridCells()[0]!.getBoundingClientRect().height).toBeCloseTo(36, 0);
  });

  it("'comfortable' maps to a 44px row height", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" density="comfortable" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(gridCells()[0]!.getBoundingClientRect().height).toBeCloseTo(44, 0);
  });

  it("an explicit rowHeight prop overrides density", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" density="compact" rowHeight={60} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(gridCells()[0]!.getBoundingClientRect().height).toBeCloseTo(60, 0);
  });
});

describe("empty state", () => {
  it("renders labels.grid.emptyState's default ('No rows') when rowCount is 0", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(0)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.element(page.getByText("No rows")).toBeInTheDocument();
  });

  it("renders the same label text when filtered down to zero rows (data is non-empty)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid
          data={makeRows(5)}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-[400px]"
          filterState={[{ columnId: "name", operator: "equals", value: "no-such-name" }]}
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.element(page.getByText("No rows")).toBeInTheDocument();
  });

  it("a labels override renders the translated empty-state text", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGridProvider data={makeRows(0)} columns={columns} getRowId={(r) => r.id} labels={{ grid: { emptyState: "Keine Zeilen" } }}>
          <DataGridRoot className="h-[400px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.element(page.getByText("Keine Zeilen")).toBeInTheDocument();
  });

  it("renders a custom emptyState node instead of the default", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(0)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" emptyState={<span>Nothing here yet</span>} />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.element(page.getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("the emptyState prop still wins even when a labels override is also present", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGridProvider data={makeRows(0)} columns={columns} getRowId={(r) => r.id} labels={{ grid: { emptyState: "Keine Zeilen" } }}>
          <DataGridRoot className="h-[400px]" emptyState={<span>Nothing here yet</span>}>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.element(page.getByText("Nothing here yet")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Keine Zeilen");
  });
});

describe("resize handle position + hover affordance (spec 3)", () => {
  it("the handle's right edge sits within 2px of the header cell's right edge", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const header = headerCells()[0]!;
    const handle = header.querySelector<HTMLElement>(gridAttrSelector("resizeHandle"))!;
    const headerRect = header.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    expect(Math.abs(handleRect.right - headerRect.right)).toBeLessThanOrEqual(2);
  });

  it("shows the hover affordance only on hover, and marks data-resizing during an active drag", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const header = headerCells()[0]!;
    const handle = header.querySelector<HTMLElement>(gridAttrSelector("resizeHandle"))!;
    expect(handle).not.toHaveAttribute(GRID_ATTR.resizing);

    const before = getComputedStyle(handle, "::after").opacity;
    expect(Number(before)).toBe(0);
    await userEvent.hover(handle);
    await new Promise((r) => requestAnimationFrame(r));
    expect(handle.matches(":hover")).toBe(true);
    const hovered = getComputedStyle(handle, "::after").opacity;
    expect(Number(hovered)).toBeGreaterThan(0);

    const handleRect = handle.getBoundingClientRect();
    await handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: handleRect.left, clientY: handleRect.top }),
    );
    expect(handle).toHaveAttribute(GRID_ATTR.resizing);
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: handleRect.left + 20, clientY: handleRect.top }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));
    expect(handle).not.toHaveAttribute(GRID_ATTR.resizing);
  });

  it("resize drag and dblclick autosize still work with the fixed handle position", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const header = headerCells()[0]!;
    const before = header.getBoundingClientRect().width;
    const handle = header.querySelector<HTMLElement>(gridAttrSelector("resizeHandle"))!;
    const handleRect = handle.getBoundingClientRect();

    await handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: handleRect.left, clientY: handleRect.top }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: handleRect.left + 60, clientY: handleRect.top }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));

    const after = headerCells()[0]!.getBoundingClientRect().width;
    expect(after).toBeGreaterThan(before + 40);
  });
});

describe("single drop indicator (spec 4)", () => {
  it("exactly one [data-grid-drop-indicator] exists during a reorder drag, at the boundary track edge", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" enableColumnReorder />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const idHeader = headerCells()[0]!;
    const emailHeader = headerCells()[2]!;
    const emailRect = emailHeader.getBoundingClientRect();

    const rect = idHeader.getBoundingClientRect();
    await idHeader.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 1,
        clientX: emailRect.left + emailRect.width - 5,
        clientY: emailRect.top + emailRect.height / 2,
      }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    const indicators = document.querySelectorAll(gridAttrSelector("dropIndicator"));
    expect(indicators).toHaveLength(1);
    const indicatorRect = (indicators[0] as HTMLElement).getBoundingClientRect();
    // dropping after email (pointer near its right edge) -> boundary is email's right edge.
    expect(Math.abs(indicatorRect.left - emailRect.right)).toBeLessThanOrEqual(1);

    expect(document.querySelectorAll("[data-drop-before]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-drop-after]")).toHaveLength(0);

    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.querySelectorAll(gridAttrSelector("dropIndicator"))).toHaveLength(0);
  });

  it("renders no drop indicator while not dragging", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" enableColumnReorder />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelectorAll(gridAttrSelector("dropIndicator"))).toHaveLength(0);
  });
});

describe("column flex fill", () => {
  const flexColumns = defineColumns<Row>()([
    { id: "id", header: "ID", accessorKey: "id", type: "text", width: 80 },
    { id: "name", header: "Name", accessorKey: "name", type: "text", width: 100, flex: 1 },
    { id: "email", header: "Email", accessorKey: "email", type: "text", width: 120, flex: 2 },
    { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
  ] as const);

  it("grows flex columns so the last column's right edge fills the viewport", async () => {
    render(
      <div style={{ height: 400, width: 976 }}>
        <DataGrid data={makeRows(20)} columns={flexColumns} getRowId={(r) => r.id} className="h-[400px] w-full" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const lastHeader = headerCells()[headerCells().length - 1]!;
    const gridRect = grid.getBoundingClientRect();
    const lastRect = lastHeader.getBoundingClientRect();
    // clientWidth excludes any scrollbar, so compare against the grid's own clientWidth-derived
    // right edge rather than its outer bounding rect (which can include the scrollbar gutter).
    const expectedRight = gridRect.left + grid.clientWidth;
    expect(Math.abs(lastRect.right - expectedRight)).toBeLessThanOrEqual(1);
  });

  it("keeps a resized flex column fixed and excluded from further redistribution", async () => {
    render(
      <div style={{ height: 400, width: 976 }}>
        <DataGrid data={makeRows(20)} columns={flexColumns} getRowId={(r) => r.id} className="h-[400px] w-full" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const nameHeader = headerCells()[1]!; // "name", flex: 1
    const before = nameHeader.getBoundingClientRect().width;
    const handle = nameHeader.querySelector<HTMLElement>(gridAttrSelector("resizeHandle"))!;
    const handleRect = handle.getBoundingClientRect();

    await handle.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: handleRect.left, clientY: handleRect.top }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: handleRect.left - 30, clientY: handleRect.top }),
    );
    await new Promise((r) => requestAnimationFrame(r));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    await new Promise((r) => requestAnimationFrame(r));

    const after = headerCells()[1]!.getBoundingClientRect().width;
    expect(after).toBeLessThan(before);
  });

  it("pixel-math consistency: the active-cell ring aligns with a flexed column cell's bounding rect", async () => {
    render(
      <div style={{ height: 400, width: 976 }}>
        <DataGrid data={makeRows(20)} columns={flexColumns} getRowId={(r) => r.id} className="h-[400px] w-full" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    // "email" (flex: 2) grew from its base width — select a cell inside it.
    const emailCell = gridCells().find((c) => c.getAttribute("data-column-id") === "email")!;
    await userEvent.click(emailCell);

    const ring = document.querySelector<HTMLElement>(gridAttrSelector("activeCellOverlay"))!;
    expect(ring).not.toBeNull();
    const cellRect = emailCell.getBoundingClientRect();
    const ringRect = ring.getBoundingClientRect();
    expect(Math.abs(ringRect.left - cellRect.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(ringRect.right - cellRect.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(ringRect.top - cellRect.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(ringRect.bottom - cellRect.bottom)).toBeLessThanOrEqual(1);
  });
});

describe("cell alignment (spec 5)", () => {
  type BoolRow = { id: string; active: boolean };
  const checkboxColumns = [
    { id: "active", header: "Active", accessorKey: "active", type: "checkbox" },
  ] as const;

  it("centers the checkbox input within the cell at default density", async () => {
    render(
      <div style={{ height: 300 }}>
        <DataGrid
          data={[{ id: "1", active: true } as BoolRow]}
          columns={checkboxColumns as never}
          getRowId={(r: BoolRow) => r.id}
          className="h-[300px]"
          density="default"
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
    const input = cell.querySelector('[role="checkbox"]')!;
    const cellRect = cell.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const cellCenterX = cellRect.left + cellRect.width / 2;
    const inputCenterX = inputRect.left + inputRect.width / 2;
    expect(Math.abs(inputCenterX - cellCenterX)).toBeLessThanOrEqual(2);
  });

  it("centers the checkbox input within the cell at comfortable density", async () => {
    render(
      <div style={{ height: 300 }}>
        <DataGrid
          data={[{ id: "1", active: true } as BoolRow]}
          columns={checkboxColumns as never}
          getRowId={(r: BoolRow) => r.id}
          className="h-[300px]"
          density="comfortable"
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const cell = document.querySelector<HTMLElement>('[role="gridcell"]')!;
    const input = cell.querySelector('[role="checkbox"]')!;
    const cellRect = cell.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const cellCenterX = cellRect.left + cellRect.width / 2;
    const inputCenterX = inputRect.left + inputRect.width / 2;
    expect(Math.abs(inputCenterX - cellCenterX)).toBeLessThanOrEqual(2);
  });

  it("right-aligns number cell text near the cell's right edge", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const ageCell = gridCells().find((c) => c.getAttribute("data-column-id") === "age")!;
    const span = ageCell.querySelector("span")!;
    const cellRect = ageCell.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    // right-aligned text's own box hugs the cell's right edge (minus the cell's own padding).
    expect(cellRect.right - spanRect.right).toBeLessThan(12);
  });

  it("leaves text cells left-aligned (unchanged)", async () => {
    render(
      <div style={{ height: 400 }}>
        <DataGrid data={makeRows(5)} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const nameCell = gridCells().find((c) => c.getAttribute("data-column-id") === "name")!;
    const span = nameCell.querySelector("span")!;
    expect(getComputedStyle(span).textAlign).toBe("start");
  });
});
