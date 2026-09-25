import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  gridAttrSelector,
  type ColumnLayout,
  type DataChange,
  type Keymap,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPinnedRows } from "@/registry/default/blocks/data-grid-pinned-rows/data-grid-pinned-rows";
import { DataGridContextMenu, type DataGridContextMenuProps } from "./data-grid-context-menu";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

function makeRows(): Row[] {
  return [
    { id: "r0", name: "Alice", email: "alice@example.com" },
    { id: "r1", name: "Bob", email: "bob@example.com" },
    { id: "r2", name: "Carol", email: "carol@example.com" },
  ];
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
] as const);

/** Native `contextmenu` at `element`'s center — same event `ContextMenuTrigger`/our own resolver listen for. */
function rightClick(element: Element): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
}

function gridCell(rowText: string, columnId: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>(`[role="gridcell"][data-column-id="${columnId}"]`)].find((c) =>
    c.textContent?.includes(rowText),
  )!;
}

// The cell menu re-renders the grid (selectCell in onContextMenu), which detaches `page`'s locator
// scope from the body-portal the menu renders into — so cell-surface items are looked up via the
// live `document`, the same way this file already reads menu text (see the "hides …" assertions).
function menuItem(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes(name));
}

function renderGrid(
  opts: {
    onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void;
    createRow?: () => Row;
    duplicateRow?: (row: Row) => Row;
    readOnly?: boolean;
    rowMarkers?: "none" | "number" | "checkbox" | "both";
    keymap?: Keymap;
    columns?: typeof columns;
    enableColumnResize?: boolean;
    onColumnLayoutChange?: (next: ColumnLayout) => void;
    onColumnResizing?: (columnId: string, width: number) => void;
    renderCellMenuItems?: DataGridContextMenuProps["renderCellMenuItems"];
    renderHeaderMenuItems?: DataGridContextMenuProps["renderHeaderMenuItems"];
  } = {},
) {
  return render(
    <DataGridProvider
      data={makeRows()}
      columns={opts.columns ?? columns}
      getRowId={(r) => r.id}
      onDataChange={opts.onDataChange}
      createRow={opts.createRow}
      duplicateRow={opts.duplicateRow}
      rowMarkers={opts.rowMarkers}
      enableColumnResize={opts.enableColumnResize}
      onColumnLayoutChange={opts.onColumnLayoutChange}
      onColumnResizing={opts.onColumnResizing}
    >
      <DataGridContextMenu
        renderCellMenuItems={opts.renderCellMenuItems}
        renderHeaderMenuItems={opts.renderHeaderMenuItems}
      >
        <DataGridRoot className="h-[300px]" readOnly={opts.readOnly} keymap={opts.keymap}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridContextMenu>
    </DataGridProvider>,
  );
}

const totals: Row = { id: "totals", name: "Total", email: "" };

/** Same shape as `renderGrid`, plus a `data-grid-pinned-rows` top band — exercises the resolver's
 * pinned-top offset and pinned-cell exclusion end to end through the real
 * hook -> rowBands -> root.tsx pipeline, not a hand-built DOM fixture. */
function PinnedGridWithMenu(props: {
  top: readonly Row[];
  onDataChange?: (next: readonly Row[], change: DataChange<Row>) => void;
}) {
  const { rowBands } = useDataGridPinnedRows({ topRows: props.top });
  return (
    <DataGridProvider
      data={makeRows()}
      columns={columns}
      getRowId={(r) => r.id}
      onDataChange={props.onDataChange}
      duplicateRow={(row) => ({ ...row, id: `copy-${row.id}` })}
      rowBands={rowBands}
    >
      <DataGridContextMenu>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridContextMenu>
    </DataGridProvider>
  );
}

describe("DataGridContextMenu — cell surface", () => {
  it("right-click on a cell opens the menu with Copy and Delete row", async () => {
    renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Copy")).toBeTruthy());
    await vi.waitFor(() => expect(menuItem("Delete row")).toBeTruthy());
  });

  it("Clear contents clears the right-clicked cell's value", async () => {
    renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Clear contents")).toBeTruthy());
    menuItem("Clear contents")!.click();
    await expect.poll(() => gridCell("", "name")?.textContent).toBe("");
  });

  it("Insert row below adds a row and fires onDataChange exactly once", async () => {
    const onDataChange = vi.fn();
    let counter = 0;
    renderGrid({ onDataChange, createRow: () => ({ id: `new-${counter++}`, name: "New", email: "" }) });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    rightClick(gridCell("Bob", "name"));
    await vi.waitFor(() => expect(menuItem("Insert row below")).toBeTruthy());
    menuItem("Insert row below")!.click();

    await expect.poll(() => onDataChange.mock.calls.length).toBe(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["r0", "r1", "new-0", "r2"]);
    expect(change.source).toBe("row-op");
  });

  it("hides Insert row above/below when no createRow prop is given", async () => {
    renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Copy")).toBeTruthy());
    expect(document.querySelector('[role="menuitem"]')?.ownerDocument.body.textContent).not.toContain("Insert row");
  });

  it("hides Duplicate row when no duplicateRow prop is given", async () => {
    renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Copy")).toBeTruthy());
    expect(document.querySelector('[role="menuitem"]')?.ownerDocument.body.textContent).not.toContain("Duplicate row");
  });

  it("Duplicate row inserts duplicateRow's copy and fires onDataChange exactly once", async () => {
    const onDataChange = vi.fn();
    let counter = 0;
    renderGrid({ onDataChange, duplicateRow: (row) => ({ ...row, id: `copy-${counter++}` }) });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    rightClick(gridCell("Bob", "name"));
    await vi.waitFor(() => expect(menuItem("Duplicate row")).toBeTruthy());
    menuItem("Duplicate row")!.click();

    await expect.poll(() => onDataChange.mock.calls.length).toBe(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["r0", "r1", "copy-0", "r2"]);
    expect(change.source).toBe("row-op");
  });

  it("disables every mutating item and Insert row/Duplicate row items on a readOnly grid", async () => {
    const onDataChange = vi.fn();
    renderGrid({
      onDataChange,
      readOnly: true,
      createRow: () => ({ id: "new", name: "New", email: "" }),
      duplicateRow: (row) => ({ ...row, id: "copy" }),
    });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Alice", "name"));

    await vi.waitFor(() => expect(menuItem("Copy")).toBeTruthy());
    for (const name of ["Cut", "Clear contents", "Insert row above", "Insert row below", "Duplicate row", "Delete row"]) {
      await vi.waitFor(() => expect(menuItem(name)?.hasAttribute("data-disabled")).toBe(true));
    }
    // disabled items are unclickable (Base UI blocks pointer events on them), so absence of any
    // mutation here is verified structurally via `data-disabled` above rather than via a click.
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

// B7 regression: the menu's shortcut hints must track the consumer's effective keymap
// (DEFAULT_KEYMAP merged with the `keymap` prop), not a hardcoded DEFAULT_KEYMAP read.
describe("DataGridContextMenu — shortcut hints follow the consumer's keymap", () => {
  it("shows the remapped binding for Clear contents, not the default", async () => {
    renderGrid({ keymap: { deleteContents: ["mod+shift+k"] } });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Clear contents")).toBeTruthy());
    const clearItem = menuItem("Clear contents")!;
    expect(clearItem.textContent).toContain("Ctrl+Shift+K");
    expect(clearItem.textContent).not.toContain("Delete");
  });
});

describe("DataGridContextMenu — header surface", () => {
  it("right-click on a header shows Sort/Pin/Hide items", async () => {
    renderGrid();
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    rightClick(document.querySelector('[role="columnheader"][data-column-id="name"]')!);
    await expect.element(page.getByRole("menuitem", { name: "Sort ascending" })).toBeInTheDocument();
    await expect.element(page.getByRole("menuitem", { name: "Pin left" })).toBeInTheDocument();
    await expect.element(page.getByRole("menuitem", { name: "Hide column" })).toBeInTheDocument();
  });

  it("Hide column removes the column from the grid", async () => {
    renderGrid();
    await expect.element(page.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    rightClick(document.querySelector('[role="columnheader"][data-column-id="email"]')!);
    await page.getByRole("menuitem", { name: "Hide column" }).click();
    await expect.element(page.getByRole("columnheader", { name: "Email" })).not.toBeInTheDocument();
  });
});

// Bug report (screenshot-confirmed): right-click on a row marker opened a visibly empty popover —
// resolveContextMenuTarget correctly resolves markers to `null` (no cell/header content to show),
// but Base UI's ContextMenuRoot still opened the (then childless) popup on that press. Fixed via
// onOpenChange's eventDetails.cancel() in context-menu.tsx; covers every `null`-target surface, not
// just markers, since the same childless-popup bug reproduces on any of them.
describe("DataGridContextMenu — non-cell surfaces never show an empty popover", () => {
  it("right-click on a row marker opens no popover at all", async () => {
    renderGrid({ rowMarkers: "number" });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = document.querySelector<HTMLElement>(gridAttrSelector("markerCell"))!;
    rightClick(marker);
    // give the (suppressed) open a tick to prove it never appears, not just that it isn't up yet.
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0);
    expect(document.querySelectorAll("[data-open]").length).toBe(0);
  });

  it("right-click on a checkbox row marker opens no popover at all", async () => {
    renderGrid({ rowMarkers: "checkbox" });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = document.querySelector<HTMLElement>(gridAttrSelector("markerCell"))!;
    rightClick(marker);
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  it("right-click on empty grid space below the last row opens no popover", async () => {
    renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const rect = grid.getBoundingClientRect();
    grid.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left + 10, clientY: rect.bottom - 10 }),
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0);
  });

  it("a subsequent right-click on a real cell still opens the menu normally (suppression doesn't stick)", async () => {
    renderGrid({ rowMarkers: "number" });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const marker = document.querySelector<HTMLElement>(gridAttrSelector("markerCell"))!;
    rightClick(marker);
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0);

    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Copy")).toBeTruthy());
  });
});

// Regression: resolveContextMenuTarget miscomputed the row with a pinned-top band installed.
describe("DataGridContextMenu — pinned-top rows", () => {
  it("Duplicate row targets the right-clicked data row, not the row below it, with a pinned-top band installed", async () => {
    const onDataChange = vi.fn();
    render(<PinnedGridWithMenu top={[totals]} onDataChange={onDataChange} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    rightClick(gridCell("Bob", "name"));
    await vi.waitFor(() => expect(menuItem("Duplicate row")).toBeTruthy());
    menuItem("Duplicate row")!.click();

    await expect.poll(() => onDataChange.mock.calls.length).toBe(1);
    const [next] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(next.map((r) => r.id)).toEqual(["r0", "r1", "copy-r1", "r2"]);
  });

  it("right-click on a pinned-top row cell opens no popover at all", async () => {
    render(<PinnedGridWithMenu top={[totals]} />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const pinnedCell = document.querySelector<HTMLElement>(gridAttrSelector("pinnedRow"))!;
    rightClick(pinnedCell);
    await new Promise((r) => setTimeout(r, 100));
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0);
  });
});

// Non-secure context (plain http): `navigator.clipboard` is undefined, so paste rejects with
// `permission-denied`. The menu content unmounts on close, so the blocked flag must live in the
// persistent wrapper to keep the Ctrl+V hint across reopens.
describe("DataGridContextMenu — paste permission-denied survives menu reopen", () => {
  afterEach(() => {
    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  });

  it("Paste stays aria-disabled with the Ctrl+V hint after a permission-denied result, across a reopen", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Paste")).toBeTruthy());
    menuItem("Paste")!.click();
    await vi.waitFor(() => expect(document.querySelectorAll('[role="menu"]').length).toBe(0));
    // nothing may have been applied (no silent partial paste)
    expect(gridCell("Alice", "name").textContent).toContain("Alice");

    rightClick(gridCell("Alice", "name"));
    await vi.waitFor(() => expect(menuItem("Paste")).toBeTruthy());
    const paste = menuItem("Paste")!;
    expect(paste.getAttribute("aria-disabled")).toBe("true");

    // the tooltip also opens on keyboard focus (base-ui focus interaction) — the only hover the
    // synthetic-event test setup can drive reliably (floating-ui's hover needs a live pointer)
    paste.focus();
    await vi.waitFor(() => expect(document.body.textContent).toContain("requires clipboard permission — use Ctrl+V"));
  });
});

// COL-G3 regression: the menu's autosize used to write through `setColumnWidth` (a per-frame drag
// write that only fires `onColumnResizing`) instead of committing through `commitColumnWidth`
// (the `onColumnLayoutChange` commit point the core double-click autosize uses), and ignored the
// resize gating the core applies to its own resize handle.
describe("DataGridContextMenu — header menu autosize commits through onColumnLayoutChange", () => {
  it("Autosize through the menu fires onColumnLayoutChange once and never onColumnResizing", async () => {
    const onColumnLayoutChange = vi.fn();
    const onColumnResizing = vi.fn();
    renderGrid({ onColumnLayoutChange, onColumnResizing });
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    rightClick(document.querySelector('[role="columnheader"][data-column-id="name"]')!);
    await expect.element(page.getByRole("menuitem", { name: "Autosize column" })).toBeInTheDocument();
    await page.getByRole("menuitem", { name: "Autosize column" }).click();

    await vi.waitFor(() => expect(onColumnLayoutChange).toHaveBeenCalledTimes(1));
    expect(onColumnResizing).not.toHaveBeenCalled();
    const [layout] = onColumnLayoutChange.mock.calls[0] as [ColumnLayout];
    expect(layout.widths["name"]).toBeGreaterThan(32);
  });

  it("hides the Autosize item for a column with resizable: false", async () => {
    const nonResizableName = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, resizable: false },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
    ] as const);
    renderGrid({ columns: nonResizableName });
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    rightClick(document.querySelector('[role="columnheader"][data-column-id="name"]')!);
    await expect.element(page.getByRole("menuitem", { name: "Hide column" })).toBeInTheDocument();
    await expect.element(page.getByRole("menuitem", { name: "Autosize column" })).not.toBeInTheDocument();
  });

  it("keeps the Autosize item for a sibling column when only one column is resizable: false", async () => {
    const nonResizableName = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140, resizable: false },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
    ] as const);
    renderGrid({ columns: nonResizableName });
    await expect.element(page.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    rightClick(document.querySelector('[role="columnheader"][data-column-id="email"]')!);
    await expect.element(page.getByRole("menuitem", { name: "Hide column" })).toBeInTheDocument();
    await expect.element(page.getByRole("menuitem", { name: "Autosize column" })).toBeInTheDocument();
  });

  it("hides the Autosize item when the root disables column resizing", async () => {
    renderGrid({ enableColumnResize: false });
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    rightClick(document.querySelector('[role="columnheader"][data-column-id="name"]')!);
    await expect.element(page.getByRole("menuitem", { name: "Hide column" })).toBeInTheDocument();
    await expect.element(page.getByRole("menuitem", { name: "Autosize column" })).not.toBeInTheDocument();
  });
});

describe("DataGridContextMenu — custom item-set slots", () => {
  it("renderCellMenuItems replaces the built-in cell items and receives the cell ctx", async () => {
    renderGrid({
      createRow: () => ({ id: "new", name: "New", email: "" }),
      duplicateRow: (row) => ({ ...row, id: "copy" }),
      renderCellMenuItems: ({ row, columnId, canInsertRow, canDuplicateRow }) => (
        <span
          data-testid="custom-cell-items"
          data-row={row}
          data-column-id={columnId}
          data-insert={String(canInsertRow)}
          data-duplicate={String(canDuplicateRow)}
        />
      ),
    });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Bob", "name"));

    const custom = () => document.querySelector<HTMLElement>("[data-testid='custom-cell-items']");
    await vi.waitFor(() => expect(custom()).toBeTruthy());
    expect(custom()!.getAttribute("data-row")).toBe("1");
    expect(custom()!.getAttribute("data-column-id")).toBe("name");
    expect(custom()!.getAttribute("data-insert")).toBe("true");
    expect(custom()!.getAttribute("data-duplicate")).toBe("true");
    // the slot's span is the only content, so no built-in menuitem may exist (document-based: the
    // cell right-click's selectCell re-render detaches the `page` locator scope from the portal)
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0);
  });

  it("renderCellMenuItems receives false flags when no createRow/duplicateRow prop is given", async () => {
    renderGrid({
      renderCellMenuItems: ({ canInsertRow, canDuplicateRow }) => (
        <span data-testid="custom-cell-items" data-insert={String(canInsertRow)} data-duplicate={String(canDuplicateRow)} />
      ),
    });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    rightClick(gridCell("Alice", "name"));

    const custom = () => document.querySelector<HTMLElement>("[data-testid='custom-cell-items']");
    await vi.waitFor(() => expect(custom()).toBeTruthy());
    expect(custom()!.getAttribute("data-insert")).toBe("false");
    expect(custom()!.getAttribute("data-duplicate")).toBe("false");
  });

  it("renderHeaderMenuItems replaces the built-in header items and receives the header ctx", async () => {
    renderGrid({
      renderHeaderMenuItems: ({ columnId, scrollRoot }) => (
        <span data-testid="custom-header-items" data-column-id={columnId} data-scroll-root={scrollRoot?.getAttribute("role") ?? "none"} />
      ),
    });
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    rightClick(document.querySelector('[role="columnheader"][data-column-id="name"]')!);

    const custom = () => document.querySelector<HTMLElement>("[data-testid='custom-header-items']");
    await vi.waitFor(() => expect(custom()).toBeTruthy());
    expect(custom()!.getAttribute("data-column-id")).toBe("name");
    expect(custom()!.getAttribute("data-scroll-root")).toBe("grid");
    await expect.element(page.getByRole("menuitem", { name: "Pin left" })).not.toBeInTheDocument();
  });
});
