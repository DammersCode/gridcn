import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns, gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridColumnsMenu } from "@/registry/default/blocks/data-grid-toolbar/data-grid-toolbar";
import { DataGridSortList } from "./data-grid-sort-list";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

type Row = { id: string; name: string; age: number };

function makeRows(): Row[] {
  return [
    { id: "r0", name: "Carol", age: 25 },
    { id: "r1", name: "Alice", age: 40 },
    { id: "r2", name: "Bob", age: 30 },
  ];
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
] as const);

function renderGrid(rows: Row[] = makeRows()) {
  return render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
      <DataGridToolbar>
        <DataGridSortList />
      </DataGridToolbar>
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

/** Adds the columns menu alongside the sort list, so a test can hide a sorted column mid-flow. */
function renderGridWithColumnsMenu(rows: Row[] = makeRows()) {
  return render(
    <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id}>
      <DataGridToolbar>
        <DataGridSortList />
        <DataGridColumnsMenu />
      </DataGridToolbar>
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

function nameCellsInOrder(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')].map((c) => c.textContent ?? "");
}

async function openSortMenu() {
  await page.getByRole("button", { name: "Sorts" }).click();
  await page.getByRole("button", { name: "Add sort" }).click();
}

describe("DataGridSortList", () => {
  it("adding a sort orders the visible rows ascending by default", async () => {
    renderGrid();
    await openSortMenu();
    await expect.poll(() => nameCellsInOrder()).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("toggling direction to descending reverses the view order", async () => {
    renderGrid();
    await openSortMenu();
    await expect.poll(() => nameCellsInOrder()).toEqual(["Alice", "Bob", "Carol"]);

    await page.getByRole("combobox", { name: "Sort direction" }).click();
    await page.getByRole("option", { name: "Descending" }).click();
    await expect.poll(() => nameCellsInOrder()).toEqual(["Carol", "Bob", "Alice"]);
  });

  it("reordering two sorts via ArrowUp on the grip changes precedence and the view order", async () => {
    renderGrid();
    await openSortMenu();
    // second row: age descending
    await page.getByRole("button", { name: "Add sort" }).click();
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Sort column"]');
    columnTriggers[1]!.click();
    await page.getByRole("option", { name: "Age" }).click();
    const directionTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Sort direction"]');
    directionTriggers[1]!.click();
    await page.getByRole("option", { name: "Descending" }).click();

    // precedence: name asc, then age desc -> alphabetical order wins (no ties on name here)
    await expect.poll(() => nameCellsInOrder()).toEqual(["Alice", "Bob", "Carol"]);

    // move the age-desc row (2nd grip) up so it takes precedence over name-asc
    const grips = document.querySelectorAll<HTMLElement>('[aria-label="Reorder sort"]');
    expect(grips.length).toBe(2);
    grips[1]!.focus();
    await userEvent.keyboard("{ArrowUp}");

    // precedence now: age desc first -> Alice (40), Bob (30), Carol (25)
    await expect.poll(() => nameCellsInOrder()).toEqual(["Alice", "Bob", "Carol"]);
    // the store round-tripped the new order: age is now sorts[0] (trigger shows the resolved "Age" label)
    await expect
      .poll(() => document.querySelectorAll<HTMLElement>('[aria-label="Sort column"]')[0]?.textContent)
      .toContain("Age");
  });

  it("ArrowUp on the grip keeps focus on the moved row's grip and announces the new position", async () => {
    renderGrid();
    await openSortMenu();
    await page.getByRole("button", { name: "Add sort" }).click();
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Sort column"]');
    columnTriggers[1]!.click();
    await page.getByRole("option", { name: "Age" }).click();

    const grips = document.querySelectorAll<HTMLElement>('[aria-label="Reorder sort"]');
    const ageGrip = grips[1]!;
    ageGrip.focus();
    await userEvent.keyboard("{ArrowUp}");

    // focus follows the moved row: the same logical (age) row's grip is now first and still focused.
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Reorder sort");
    const gripsAfter = document.querySelectorAll<HTMLElement>('[aria-label="Reorder sort"]');
    expect(document.activeElement).toBe(gripsAfter[0]);

    // live region announced the move.
    await expect.element(page.getByText(/Age sort moved to position 1 of 2/)).toBeInTheDocument();
  });

  it("removing the focused row's sort moves focus to the next row's grip", async () => {
    renderGrid();
    await openSortMenu();
    await page.getByRole("button", { name: "Add sort" }).click();
    await expect.poll(() => document.querySelectorAll('[aria-label="Sort column"]').length).toBe(2);

    const removeButtons = document.querySelectorAll<HTMLElement>('[aria-label="Remove sort"]');
    removeButtons[0]!.click();

    await expect.poll(() => document.querySelectorAll('[aria-label="Sort column"]').length).toBe(1);
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Reorder sort");
  });

  it("removing a sort drops it from the list and its ordering effect", async () => {
    renderGrid();
    await openSortMenu();
    await expect.poll(() => nameCellsInOrder()).toEqual(["Alice", "Bob", "Carol"]);
    await page.getByRole("button", { name: "Remove sort" }).click();
    // original row-major order restored (Carol, Alice, Bob) once the only sort is removed
    await expect.poll(() => nameCellsInOrder()).toEqual(["Carol", "Alice", "Bob"]);
    await expect.element(page.getByText("No sorts applied.")).toBeInTheDocument();
  });

  it("removing the only sort moves focus to the Add sort button", async () => {
    renderGrid();
    await openSortMenu();
    await page.getByRole("button", { name: "Remove sort" }).click();
    await expect.poll(() => document.activeElement?.textContent).toContain("Add sort");
  });

  it("clear all removes every sort row at once", async () => {
    renderGrid();
    await openSortMenu();
    await page.getByRole("button", { name: "Add sort" }).click();
    await expect.poll(() => document.querySelectorAll('[aria-label="Sort column"]').length).toBe(2);
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect.element(page.getByText("No sorts applied.")).toBeInTheDocument();
    await expect.poll(() => document.querySelectorAll('[aria-label="Sort column"]').length).toBe(0);
  });

  it("shows a count badge matching the number of applied sorts", async () => {
    renderGrid();
    expect(document.querySelector(gridAttrSelector("sortCount"))).toBeNull();
    await openSortMenu();
    await expect.poll(() => document.querySelector(gridAttrSelector("sortCount"))?.textContent).toBe("1");
    await page.getByRole("button", { name: "Add sort" }).click();
    await expect.poll(() => document.querySelector(gridAttrSelector("sortCount"))?.textContent).toBe("2");
  });

  it("hiding a sorted column removes it from the row's own select without landing a null columnId", async () => {
    renderGridWithColumnsMenu();
    await openSortMenu();
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Sort column"]');
    columnTriggers[0]!.click();
    await page.getByRole("option", { name: "Age" }).click();
    await expect.poll(() => document.querySelector('[aria-label="Sort column"]')?.textContent).toContain("Age");

    // opening the Columns menu closes (unmounts) the Sorts popover — Base UI dismisses a popover
    // once focus moves to another top-level overlay — so the column-hide + reopen happen as two steps.
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Age" }).click();
    await userEvent.keyboard("{Escape}"); // close the (still-open) checkbox dropdown before reopening Sorts

    // the grid survives hiding its only sorted column — no crash from a stale sort spec.
    await expect.poll(() => document.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);

    // reopen Sorts: Base UI's SelectPositioner calls setValue(null) once "Age" no longer has a
    // rendered SelectItem in this row's own options (it's excluded from `availableColumns` once
    // hidden) — the guard must swallow that null rather than let it overwrite SortSpec.columnId,
    // which would silently break `columns.find(c => c.id === columnId)` elsewhere. With the guard
    // in place, the row keeps its real columnId ("age"); with no matching column to resolve a label
    // from, the trigger correctly falls back to the raw id rather than showing a blank/null value.
    await page.getByRole("button", { name: "Sorts" }).click();
    await expect.poll(() => document.querySelector('[aria-label="Sort column"]')?.textContent).toContain("age");
  });
});

describe("DataGridSortList i18n labels", () => {
  it("a partial labels override replaces the sort button label", async () => {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id} labels={{ sort: { sort: "Sortieren" } }}>
        <DataGridToolbar>
          <DataGridSortList />
        </DataGridToolbar>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    // "sort.sort" is the button's visible text, not its accessible name (that's "sort.sortAriaLabel",
    // which wins as aria-label) — assert on textContent rather than the accessible-name role query.
    await expect.poll(() => document.querySelector('[aria-label="Sorts"]')?.textContent).toContain("Sortieren");
  });
});
