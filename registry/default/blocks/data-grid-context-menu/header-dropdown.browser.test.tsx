import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridHeaderDropdown } from "./data-grid-context-menu";
import { GRID_ATTR, gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
// real stylesheet so Tailwind's `grid`/`group-hover` utilities actually apply
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

function makeRows(count = 2): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: "r" + i, name: "Name " + i, email: "n" + i + "@example.com" }));
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
] as const);

function renderGrid(rowCount?: number) {
  return render(
    <DataGridProvider data={makeRows(rowCount)} columns={columns} getRowId={(r) => r.id}>
      <DataGridRoot className="h-75" renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

// The header menu portals to document.body, outside the element `page` is scoped to — so menu
// items are looked up via the live `document` and activated with a native click (a synthetic
// userEvent click's pointerdown/mousedown dismisses the menu before the click lands).
function menuItem(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.includes(name));
}

describe("DataGridHeaderDropdown", () => {
  it("renders no chevron trigger when the root has no renderHeaderMenu prop", async () => {
    await render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridRoot className="h-75">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector(gridAttrSelector("headerMenuTrigger"))).toBeNull();
  });

  it("shows the chevron trigger on header hover (opacity transitions from 0)", async () => {
    await renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="name"]')).toBeTruthy());
    const trigger = document.querySelector<HTMLElement>(`[data-column-id="name"] ${gridAttrSelector("headerMenuTrigger")}`)!;
    expect(trigger).not.toBeNull();
    // Hidden by default via the opacity-0 utility class. Asserted on the class list, not computed
    // style: on loaded shared CI runners the stylesheet can lag the first getComputedStyle read
    // indefinitely (failed 5 runs in a row polling for the settled 0), while the class is deterministic.
    expect(trigger.classList.contains("opacity-0")).toBe(true);

    await userEvent.hover(trigger);
    await new Promise((r) => requestAnimationFrame(r));
    expect(Number(getComputedStyle(trigger).opacity)).toBeGreaterThan(0);
  });

  it("opening the menu and clicking Hide column hides the column", async () => {
    await renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')).toBeTruthy());
    const trigger = document.querySelector<HTMLElement>(`[data-column-id="email"] ${gridAttrSelector("headerMenuTrigger")}`)!;

    await userEvent.click(trigger);
    await vi.waitFor(() => expect(menuItem("Hide column")).toBeTruthy());
    menuItem("Hide column")!.click();

    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')).toBeNull());
  });

  it("reuses the same items as the header context menu (Sort/Pin/Hide/Autosize)", async () => {
    await renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="name"]')).toBeTruthy());
    const trigger = document.querySelector<HTMLElement>(`[data-column-id="name"] ${gridAttrSelector("headerMenuTrigger")}`)!;

    await userEvent.click(trigger);
    for (const name of ["Sort ascending", "Pin left", "Hide column", "Autosize column"]) {
      await vi.waitFor(() => expect(menuItem(name)).toBeTruthy());
    }
  });

  it("a menu-item click never also fires the header's own click-select/sort gesture (portal bubbles through the React tree, not the DOM tree)", async () => {
    await render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id} headerClickBehavior="sort">
        <DataGridRoot className="h-75" renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="name"]')).toBeTruthy());
    const trigger = document.querySelector<HTMLElement>(`[data-column-id="name"] ${gridAttrSelector("headerMenuTrigger")}`)!;

    await userEvent.click(trigger);
    await vi.waitFor(() => expect(menuItem("Pin left")).toBeTruthy());
    menuItem("Pin left")!.click();

    // the click landed on "Pin left" only — it must not have also cycled the header's own click-to-sort
    // gesture (which a bubbled-through-React click would otherwise trigger on the same pointerdown).
    const header = document.querySelector('[data-column-id="name"]')!;
    await expect.poll(() => header.getAttribute(GRID_ATTR.pinned)).toBe("left");
    expect(header).toHaveAttribute("aria-sort", "none");
  });

  it("Shift+Alt+ArrowDown opens the active column's menu, arrows reach its items, Escape returns focus to the cell", async () => {
    await renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')).toBeTruthy());
    const emailCell = () => document.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="2"]')!;
    await userEvent.click(emailCell());

    await userEvent.keyboard("{Shift>}{Alt>}{ArrowDown}{/Alt}{/Shift}");
    await vi.waitFor(() => expect(menuItem("Sort ascending")).toBeTruthy());
    await vi.waitFor(() => expect(document.activeElement).toBe(menuItem("Sort ascending")));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(menuItem("Sort descending"));

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(menuItem("Sort ascending")).toBeUndefined());
    await vi.waitFor(() => expect(document.activeElement).toBe(emailCell()));
  });

  it("an outside click on another focusable element closes a keyboard-opened menu without stealing focus back", async () => {
    await renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')).toBeTruthy());
    const outside = document.createElement("input");
    document.body.append(outside);
    const listeners = new AbortController();
    try {
      await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="2"]')!);
      await userEvent.keyboard("{Shift>}{Alt>}{ArrowDown}{/Alt}{/Shift}");
      await vi.waitFor(() => expect(menuItem("Sort ascending")).toBeTruthy());

      outside.focus();
      const focusedAfterOutsidePress: Element[] = [];
      const record = (e: FocusEvent) => {
        if (e.target !== outside) focusedAfterOutsidePress.push(e.target as Element);
      };
      document.addEventListener("focusin", record, { signal: listeners.signal });
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
      outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.waitFor(() => expect(menuItem("Sort ascending")).toBeUndefined());
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(focusedAfterOutsidePress).toEqual([]);
      expect(document.activeElement).toBe(outside);
    } finally {
      listeners.abort();
      outside.remove();
    }
  });

  it("closing a mouse-opened menu leaves a scrolled-away grid where it is", async () => {
    await renderGrid(400);
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')).toBeTruthy());
    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="2"]')!);
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    await vi.waitFor(() => expect(grid.scrollHeight).toBeGreaterThan(5000));
    grid.scrollTop = 4000;
    await new Promise((r) => setTimeout(r, 100));
    const before = grid.scrollTop;
    expect(before).toBeGreaterThan(1000);

    document.querySelector<HTMLElement>(`[data-column-id="email"] ${gridAttrSelector("headerMenuTrigger")}`)!.click();
    await vi.waitFor(() => expect(menuItem("Sort ascending")).toBeTruthy());
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(menuItem("Sort ascending")).toBeUndefined());
    await new Promise((r) => setTimeout(r, 100));
    expect(grid.scrollTop).toBe(before);
  });

  it("Shift+Alt+ArrowDown scrolls a scrolled-away active column into view and opens its menu", async () => {
    const wideColumns = defineColumns<Row>()(
      Array.from({ length: 30 }, (_, i) => ({ id: "c" + i, header: "Col " + i, accessorFn: (r: Row) => r.name, type: "text", width: 160 })) as never,
    );
    await render(
      <DataGridProvider data={makeRows()} columns={wideColumns} getRowId={(r) => r.id}>
        <DataGridRoot className="h-75 w-100" renderHeaderMenu={(ctx) => <DataGridHeaderDropdown {...ctx} />}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="c0"]')).toBeTruthy());
    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"][aria-colindex="1"]')!);
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollLeft = grid.scrollWidth;
    await vi.waitFor(() => expect(grid.scrollLeft).toBeGreaterThan(4000));

    await userEvent.keyboard("{Shift>}{Alt>}{ArrowDown}{/Alt}{/Shift}");
    await vi.waitFor(() => expect(menuItem("Sort ascending")).toBeTruthy());
    expect(grid.scrollLeft).toBeLessThan(200);
  });

  it("Shift+Alt+ArrowDown warns in development when no header menu is wired", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridRoot className="h-75">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await vi.waitFor(() => expect(document.querySelector('[role="gridcell"]')).toBeTruthy());
    await userEvent.click(document.querySelector<HTMLElement>('[role="gridcell"]')!);
    await userEvent.keyboard("{Shift>}{Alt>}{ArrowDown}{/Alt}{/Shift}");
    await vi.waitFor(() => expect(warn.mock.calls.some(([message]) => String(message).includes("column menu"))).toBe(true));
    warn.mockRestore();
  });
});
