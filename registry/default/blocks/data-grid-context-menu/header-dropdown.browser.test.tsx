import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  GRID_ATTR,
  gridAttrSelector,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridHeaderDropdown } from "./data-grid-context-menu";
// real stylesheet so Tailwind's `grid`/`group-hover` utilities actually apply
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

function makeRows(): Row[] {
  return [
    { id: "r0", name: "Alice", email: "alice@example.com" },
    { id: "r1", name: "Bob", email: "bob@example.com" },
  ];
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
] as const);

function renderGrid() {
  return render(
    <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
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

describe("DataGridHeaderDropdown (PLAN §3 Pinning UX)", () => {
  it("renders no chevron trigger when the root has no renderHeaderMenu prop", async () => {
    render(
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

  it("shows the chevron trigger on header hover (opacity transitions from 0)", { timeout: 30_000 }, async () => {
    renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="name"]')).toBeTruthy());
    const trigger = document.querySelector<HTMLElement>(`[data-column-id="name"] ${gridAttrSelector("headerMenuTrigger")}`)!;
    expect(trigger).not.toBeNull();
    // 20s window (and 30s test timeout): a bare read can land before the stylesheet is applied
    // under parallel-suite load (computed opacity 1 instead of the settled 0); the default 1s
    // poll + default 5s test timeout clipped the wait and failed 4 runs in a row on loaded runners.
    await expect.poll(() => Number(getComputedStyle(trigger).opacity), { timeout: 20_000 }).toBe(0);

    await userEvent.hover(trigger);
    await new Promise((r) => requestAnimationFrame(r));
    expect(Number(getComputedStyle(trigger).opacity)).toBeGreaterThan(0);
  });

  it("opening the menu and clicking Hide column hides the column", async () => {
    renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')).toBeTruthy());
    const trigger = document.querySelector<HTMLElement>(`[data-column-id="email"] ${gridAttrSelector("headerMenuTrigger")}`)!;

    await userEvent.click(trigger);
    await vi.waitFor(() => expect(menuItem("Hide column")).toBeTruthy());
    menuItem("Hide column")!.click();

    await vi.waitFor(() => expect(document.querySelector('[data-column-id="email"]')).toBeNull());
  });

  it("reuses the same items as the header context menu (Sort/Pin/Hide/Autosize)", async () => {
    renderGrid();
    await vi.waitFor(() => expect(document.querySelector('[data-column-id="name"]')).toBeTruthy());
    const trigger = document.querySelector<HTMLElement>(`[data-column-id="name"] ${gridAttrSelector("headerMenuTrigger")}`)!;

    await userEvent.click(trigger);
    for (const name of ["Sort ascending", "Pin left", "Hide column", "Autosize column"]) {
      await vi.waitFor(() => expect(menuItem(name)).toBeTruthy());
    }
  });

  it("a menu-item click never also fires the header's own click-select/sort gesture (portal bubbles through the React tree, not the DOM tree)", async () => {
    render(
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
});
