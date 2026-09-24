import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridProvider,
  DataGridRoot,
  DataGridHeader,
  DataGridBody,
  defineColumns,
  useDataGridActiveCell,
  GRID_ATTR,
  gridAttrSelector,
  type ColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch, DataGridFilterMenu, DataGridColumnsMenu } from "./data-grid-toolbar";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

type Row = { id: string; name: string; email: string; age: number };

// emails deliberately don't echo the name, so a "alic" search matches only the name column.
function makeRows(): Row[] {
  return [
    { id: "r0", name: "Alice", email: "user1@example.com", age: 30 },
    { id: "r1", name: "Bob", email: "user2@example.com", age: 40 },
    { id: "r2", name: "Alicia", email: "user3@example.com", age: 25 },
    { id: "r3", name: "Carol", email: "user4@example.com", age: 50 },
  ];
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80 },
] as const);

/** Exposes the active cell as a data attribute so tests can assert on it without reaching into the store. */
function ActiveCellProbe() {
  const active = useDataGridActiveCell();
  return <div data-testid="active-cell" data-row={active?.row} data-col={active?.col} />;
}

function renderGrid(rows: Row[] = makeRows(), extraColumns: readonly ColumnDef<Row, unknown>[] = columns) {
  return render(
    <DataGridProvider data={rows} columns={extraColumns} getRowId={(r) => r.id}>
      <DataGridToolbar>
        <DataGridSearch />
        <DataGridFilterMenu />
        <DataGridColumnsMenu />
      </DataGridToolbar>
      <ActiveCellProbe />
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

function renderGridWithLabels(labels: Parameters<typeof DataGridProvider>[0]["labels"]) {
  return render(
    <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id} labels={labels}>
      <DataGridToolbar>
        <DataGridSearch />
      </DataGridToolbar>
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

function gridCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

describe("DataGridSearch", () => {
  it("typing highlights matches and shows a match count without filtering rows", async () => {
    renderGrid();
    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("alic");
    await expect.element(page.getByText("1/2")).toBeInTheDocument();
    // all 4 rows stay in the DOM (Bob/Carol are never removed) — search highlights, it doesn't filter.
    await expect.poll(() => gridCells().filter((c) => c.textContent?.includes("Bob")).length).toBe(1);
    await expect.poll(() => gridCells().filter((c) => c.textContent?.includes("Carol")).length).toBe(1);
    // both matching cells (Alice row 0, Alicia row 2) carry the highlight attribute.
    await expect.poll(() => gridCells().filter((c) => c.hasAttribute(GRID_ATTR.searchMatch)).length).toBe(2);
  });

  it("Enter steps to the next match and moves the active cell", async () => {
    renderGrid();
    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("alic");
    await expect.element(page.getByText("1/2")).toBeInTheDocument();
    // matchIndex starts at 0 (badge "1/2") without moving the active cell; Enter steps to match 2.
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2/2")).toBeInTheDocument();
    // 2nd match is Alicia at row 2 of the unfiltered view (row-major order, no filtering).
    await expect
      .poll(() => document.querySelector('[data-testid="active-cell"]')?.getAttribute("data-row"))
      .toBe("2");
  });

  it("Escape clears the search", async () => {
    renderGrid();
    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("alic");
    await expect.element(page.getByText(/\d\/\d/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveValue("");
  });

  it("does not remount the row window while typing (same cell DOM node before/after)", async () => {
    renderGrid();
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    const cellBefore = document.querySelector('[role="gridcell"][data-column-id="name"]');
    expect(cellBefore).not.toBeNull();
    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("alic");
    await expect.element(page.getByText("1/2")).toBeInTheDocument();
    const cellAfter = document.querySelector('[role="gridcell"][data-column-id="name"]');
    expect(cellAfter).toBe(cellBefore);
  });

  it("shows a capped '1000+' badge at 1000+ matches", async () => {
    const bigRows = Array.from({ length: 1200 }, (_, i) => ({
      id: `r${i}`,
      name: "needle",
      email: `user${i}@example.com`,
      age: 20,
    }));
    renderGrid(bigRows);
    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("needle");
    await expect.element(page.getByText("1/1000+")).toBeInTheDocument();
  });

  it("at 100k rows, typing a common term never remounts the rendered row window", async () => {
    const hugeRows = Array.from({ length: 100_000 }, (_, i) => ({
      id: `r${i}`,
      name: `user${i}`,
      email: `u${i}@example.com`,
      age: 20 + (i % 50),
    }));
    renderGrid(hugeRows);
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    const cellsBefore = gridCells();
    expect(cellsBefore.length).toBeGreaterThan(0);

    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("user");
    await expect.element(page.getByText("1/1000+")).toBeInTheDocument();

    // same DOM node set (by reference) — the row window was never rebuilt, only highlight attrs changed.
    // toEqual on DOM nodes compares attributes, not identity, so assert reference equality per element.
    const cellsAfter = gridCells();
    expect(cellsAfter.length).toBe(cellsBefore.length);
    cellsAfter.forEach((cell, i) => expect(cell).toBe(cellsBefore[i]));
    expect(cellsAfter.some((c) => c.hasAttribute(GRID_ATTR.searchMatch))).toBe(true);
  });
});

describe("DataGridSearch captureFindShortcut", () => {
  /** Dispatches mod+F on `target` and returns the event so tests can read `defaultPrevented`. */
  function dispatchModF(target: Element): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  function renderGridDefault() {
    return render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridToolbar>
          <DataGridSearch />
        </DataGridToolbar>
        <button type="button">outside button</button>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
  }

  it("defaults to on: mod+F with focus inside the grid focuses the search input and is defaultPrevented", async () => {
    renderGridDefault();
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    const cell = document.querySelector<HTMLElement>('[role="gridcell"]');
    expect(cell).not.toBeNull();
    cell!.focus();
    const input = page.getByRole("textbox", { name: "Search grid" });
    const event = dispatchModF(document.activeElement ?? document.body);
    expect(event.defaultPrevented).toBe(true);
    await expect.element(input).toHaveFocus();
  });

  it("defaults to on: mod+F while the search input is already focused selects its text", async () => {
    renderGridDefault();
    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("alic");
    const inputEl = document.querySelector<HTMLInputElement>('[aria-label="Search grid"]')!;
    inputEl.focus();
    inputEl.setSelectionRange(0, 0);
    const event = dispatchModF(inputEl);
    expect(event.defaultPrevented).toBe(true);
    await expect.poll(() => inputEl.selectionStart === 0 && inputEl.selectionEnd === inputEl.value.length).toBe(true);
  });

  // the critical safety guarantee: default-on must never leak past the grid's own subtree, so a
  // page's own search box (or the browser's native find) keeps working untouched right next to it.
  it("defaults to on, but focus OUTSIDE the grid (a sibling button) is never intercepted", async () => {
    renderGridDefault();
    const outsideButton = page.getByRole("button", { name: "outside button" });
    await outsideButton.click();
    const event = dispatchModF(document.activeElement ?? document.body);
    expect(event.defaultPrevented).toBe(false);
  });

  it("captureFindShortcut={false} opts out: mod+F is never intercepted regardless of focus", async () => {
    render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
        <DataGridToolbar>
          <DataGridSearch captureFindShortcut={false} />
        </DataGridToolbar>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    const cell = document.querySelector<HTMLElement>('[role="gridcell"]');
    cell!.focus();
    const event = dispatchModF(document.activeElement ?? document.body);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("DataGridSearch i18n labels", () => {
  it("a partial labels override replaces the search placeholder", async () => {
    renderGridWithLabels({ toolbar: { searchPlaceholder: "Suchen…" } });
    await expect.element(page.getByPlaceholder("Suchen…")).toBeInTheDocument();
  });
});

describe("DataGridFilterMenu", () => {
  it("adding a filter narrows the visible rows", async () => {
    renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();
    // default filterable column is "name"; type "contains" value "Alic" to narrow to Alice + Alicia
    const valueInput = page.getByRole("textbox", { name: "Filter value" });
    await valueInput.fill("Alic");
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(2);
  });

  it("the filter value input stays usable-width, not squeezed to a sliver", async () => {
    renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();
    const valueInput = document.querySelector<HTMLElement>('input[aria-label="Filter value"]');
    expect(valueInput).not.toBeNull();
    expect(valueInput!.clientWidth).toBeGreaterThanOrEqual(80);
  });

  it("long German operator labels don't collapse the value input or overflow the popover", async () => {
    render(
      <DataGridProvider
        data={makeRows()}
        columns={columns}
        getRowId={(r) => r.id}
        labels={{
          filterOperators: {
            gt: "Größer als",
            gte: "Größer oder gleich",
            lt: "Kleiner als",
            lte: "Kleiner oder gleich",
          },
        }}
      >
        <DataGridToolbar>
          <DataGridFilterMenu />
        </DataGridToolbar>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();
    // switch to the "age" (number) column so gt/gte/lt/lte are offered.
    await page.getByRole("combobox", { name: "Filter column" }).click();
    await page.getByRole("option", { name: "Age" }).click();
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "Größer oder gleich" }).click();

    const popover = document.querySelector<HTMLElement>(gridAttrSelector("filterMenu"));
    const operatorTrigger = document.querySelector<HTMLElement>('[aria-label="Filter operator"]');
    const valueInput = document.querySelector<HTMLElement>('input[aria-label="Filter value"]');
    expect(popover).not.toBeNull();
    expect(operatorTrigger).not.toBeNull();
    expect(valueInput).not.toBeNull();

    // long label truncates inside the trigger rather than pushing the row wider than the popover.
    const popoverRect = popover!.getBoundingClientRect();
    const triggerRect = operatorTrigger!.getBoundingClientRect();
    expect(triggerRect.right).toBeLessThanOrEqual(popoverRect.right + 1);
    // the value input never gets starved down to a sliver by the long operator label.
    expect(valueInput!.clientWidth).toBeGreaterThanOrEqual(80);
  });

  it("allColumns lists hidden columns and a filter on one narrows the rows", async () => {
    const hiddenAgeColumns = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
      { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, hidden: true },
    ] as const);
    render(
      <DataGridProvider data={makeRows()} columns={hiddenAgeColumns} getRowId={(r) => r.id}>
        <DataGridToolbar>
          <DataGridFilterMenu allColumns />
        </DataGridToolbar>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();
    await page.getByRole("combobox", { name: "Filter column" }).click();
    await page.getByRole("option", { name: "Age" }).click();
    // a number column's value input is <input type="number"> — role spinbutton, not textbox
    await page.getByRole("spinbutton", { name: "Filter value" }).fill("40");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "equals" }).click();
    // Bob is the only row with age 40 (Alice 30, Alicia 25, Carol 50).
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(1);
  });

  it("warns in dev when a filter targets a column the default menu cannot list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hiddenAgeColumns = defineColumns<Row>()([
      { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
      { id: "age", header: "Age", accessorKey: "age", type: "number", width: 80, hidden: true },
    ] as const);
    render(
      <DataGridProvider
        data={makeRows()}
        columns={hiddenAgeColumns}
        getRowId={(r) => r.id}
        filterState={[{ columnId: "age", operator: "equals", value: "40" }]}
        onFilterChange={() => {}}
      >
        <DataGridToolbar>
          <DataGridFilterMenu />
        </DataGridToolbar>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await expect.poll(() => warn.mock.calls.length).toBeGreaterThan(0);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("allColumns"))).toBe(true);
    warn.mockRestore();
  });

  it("long column names truncate inside the select trigger instead of overflowing the popover", async () => {
    const longNameColumns = defineColumns<Row>()([
      {
        id: "name",
        header: "A Very Long Column Header Name That Should Never Overflow",
        accessorKey: "name",
        type: "text",
        width: 140,
      },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
    ] as const);
    render(
      <DataGridProvider data={makeRows()} columns={longNameColumns} getRowId={(r) => r.id}>
        <DataGridToolbar>
          <DataGridFilterMenu />
        </DataGridToolbar>
        <DataGridRoot className="h-[300px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();

    const popover = document.querySelector<HTMLElement>(gridAttrSelector("filterMenu"));
    const columnTrigger = document.querySelector<HTMLElement>('[aria-label="Filter column"]');
    expect(popover).not.toBeNull();
    expect(columnTrigger).not.toBeNull();

    const popoverRect = popover!.getBoundingClientRect();
    const triggerRect = columnTrigger!.getBoundingClientRect();
    expect(triggerRect.right).toBeLessThanOrEqual(popoverRect.right + 1);
    expect(triggerRect.left).toBeGreaterThanOrEqual(popoverRect.left - 1);
  });
});

type RichRow = { id: string; name: string; age: number; startDate: string; active: boolean; role: string };

function makeRichRows(): RichRow[] {
  return [
    { id: "r0", name: "Alice", age: 30, startDate: "2024-01-15", active: true, role: "admin" },
    { id: "r1", name: "Bob", age: 40, startDate: "2024-06-01", active: false, role: "user" },
    { id: "r2", name: "Carol", age: 25, startDate: "2024-03-10", active: true, role: "user" },
  ];
}

const richColumns = defineColumns<RichRow>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
  { id: "startDate", header: "Start Date", accessorKey: "startDate", type: "date", width: 140 },
  { id: "active", header: "Active", accessorKey: "active", type: "checkbox", width: 100 },
  {
    id: "role",
    header: "Role",
    accessorKey: "role",
    type: "select",
    width: 120,
    options: { choices: [{ value: "admin", label: "Admin" }, { value: "user", label: "User" }] },
  },
] as const);

function renderRichGrid(rows: RichRow[] = makeRichRows()) {
  return render(
    <DataGridProvider data={rows} columns={richColumns} getRowId={(r) => r.id}>
      <DataGridToolbar>
        <DataGridFilterMenu />
      </DataGridToolbar>
      <DataGridRoot className="h-[300px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
}

async function openFilterMenu() {
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Add filter" }).click();
}

async function switchFilterColumn(name: string) {
  await page.getByRole("combobox", { name: "Filter column" }).click();
  await page.getByRole("option", { name }).click();
}

describe("DataGridFilterMenu typed value inputs", () => {
  it("a number column gets a numeric input", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter value"]');
    expect(input).not.toBeNull();
    expect(input!.type).toBe("number");
  });

  it("a date column gets a date input", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Start Date");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter value"]');
    expect(input).not.toBeNull();
    expect(input!.type).toBe("date");
  });

  it("a checkbox column gets a true/false select", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Active");
    await expect.element(page.getByRole("combobox", { name: "Filter value" })).toBeInTheDocument();
    await page.getByRole("combobox", { name: "Filter value" }).click();
    await expect.element(page.getByRole("option", { name: "true" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "false" })).toBeInTheDocument();
  });

  it("a select column gets a select of its own choices", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Role");
    await page.getByRole("combobox", { name: "Filter value" }).click();
    await expect.element(page.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "User" })).toBeInTheDocument();
  });

  it("choosing a select-column value narrows the grid", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Role");
    await page.getByRole("combobox", { name: "Filter value" }).click();
    await page.getByRole("option", { name: "Admin" }).click();
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(1);
  });

  it("isBetween on a number column renders two numeric inputs and narrows inclusively", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "is between" }).click();

    const fromInput = document.querySelector<HTMLInputElement>('input[aria-label="Filter value from"]');
    const toInput = document.querySelector<HTMLInputElement>('input[aria-label="Filter value to"]');
    expect(fromInput).not.toBeNull();
    expect(toInput).not.toBeNull();
    expect(fromInput!.type).toBe("number");
    expect(toInput!.type).toBe("number");

    // number inputs expose the "spinbutton" accessibility role, not "textbox".
    await page.getByRole("spinbutton", { name: "Filter value from" }).fill("26");
    await page.getByRole("spinbutton", { name: "Filter value to" }).fill("35");
    // Alice (30) is the only row inside [26, 35] inclusive.
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(1);
  });

  it("isAnyOf on a select column checks its own choices and keeps rows matching any of them", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Role");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "is any of" }).click();

    // no choices checked yet — an empty list matches nothing
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(0);

    await page.getByRole("button", { name: "Filter value" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Admin" }).click();
    // rows(): Alice is the only admin
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(1);

    await page.getByRole("menuitemcheckbox", { name: "User" }).click();
    // adding User widens to all three rows
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(3);
  });

  it("isAnyOf is offered only for select columns", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await expect.element(page.getByRole("option", { name: "is between" })).toBeInTheDocument();
    expect(document.querySelector('[role="option"][data-value="isAnyOf"]')).toBeNull();
  });
});

describe("DataGridFilterMenu multiple filters on one column", () => {
  it("two filter rows on the same column both apply (AND intersects to a narrower range)", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    // exact: true — "greater than" is also a substring of "greater than or equal".
    await page.getByRole("option", { name: "greater than", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Filter value" }).fill("20");
    // wait for the debounced value commit before adding a second row (view-index rebuild settles).
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(3);

    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(() => document.querySelectorAll('[aria-label="Filter column"]').length).toBe(2);

    // second row targets the same "age" column with a different operator
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]');
    columnTriggers[1]!.click();
    await page.getByRole("option", { name: "Age" }).click();

    const operatorTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Filter operator"]');
    operatorTriggers[1]!.click();
    await page.getByRole("option", { name: "less than", exact: true }).click();

    const valueInputs = document.querySelectorAll<HTMLInputElement>('input[aria-label="Filter value"]');
    await userEvent.fill(valueInputs[1]!, "35");

    // AND of (age > 20) and (age < 35): only Alice (30) and Carol (25) survive, Bob (40) excluded.
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(2);
  });
});

describe("DataGridFilterMenu join operator", () => {
  it("the join control is hidden with 0 or 1 filters", async () => {
    renderRichGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    expect(page.getByRole("combobox", { name: "Match" }).query()).toBeNull();
    await page.getByRole("button", { name: "Add filter" }).click();
    expect(page.getByRole("combobox", { name: "Match" }).query()).toBeNull();
  });

  it("appears once 2+ filters exist and defaults to And", async () => {
    renderRichGrid();
    await openFilterMenu();
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.element(page.getByRole("combobox", { name: "Match" })).toHaveTextContent("And");
  });

  it("switching to Or widens the result to the union of both filters", async () => {
    renderRichGrid();
    await openFilterMenu();
    // first row: name contains "Alice"
    await page.getByRole("textbox", { name: "Filter value" }).fill("Alice");
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(1);

    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(() => document.querySelectorAll('[aria-label="Filter column"]').length).toBe(2);

    // second row: switch to age, greater than 35 (matches only Bob)
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]');
    columnTriggers[1]!.click();
    await page.getByRole("option", { name: "Age" }).click();

    const operatorTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Filter operator"]');
    operatorTriggers[1]!.click();
    await page.getByRole("option", { name: "greater than", exact: true }).click();

    const valueInputs = document.querySelectorAll<HTMLInputElement>('input[aria-label="Filter value"]');
    await userEvent.fill(valueInputs[1]!, "35");

    // AND: name contains Alice AND age > 35 -> nobody.
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(0);

    await page.getByRole("combobox", { name: "Match" }).click();
    await page.getByRole("option", { name: "Or" }).click();

    // OR: name contains Alice (Alice) OR age > 35 (Bob) -> 2 rows.
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(2);
  });
});

describe("DataGridFilterMenu reorder", () => {
  it("ArrowUp on the grip moves that filter row earlier in the array order", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(() => document.querySelectorAll('[aria-label="Filter column"]').length).toBe(2);
    // second row targets "role" so the two rows are distinguishable by column label.
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]');
    columnTriggers[1]!.click();
    await page.getByRole("option", { name: "Role" }).click();

    const grips = document.querySelectorAll<HTMLElement>('[aria-label="Reorder filter"]');
    expect(grips.length).toBe(2);
    grips[1]!.focus();
    await userEvent.keyboard("{ArrowUp}");

    // the store round-tripped the new order: "role" is now filters[0] (trigger shows the resolved "Role" label)
    await expect
      .poll(() => document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]')[0]?.textContent)
      .toContain("Role");
  });

  it("ArrowUp on the grip keeps focus on the moved row's grip and announces the new position", async () => {
    renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    await page.getByRole("button", { name: "Add filter" }).click();
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]');
    columnTriggers[1]!.click();
    await page.getByRole("option", { name: "Role" }).click();

    const grips = document.querySelectorAll<HTMLElement>('[aria-label="Reorder filter"]');
    const roleGrip = grips[1]!;
    roleGrip.focus();
    await userEvent.keyboard("{ArrowUp}");

    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Reorder filter");
    const gripsAfter = document.querySelectorAll<HTMLElement>('[aria-label="Reorder filter"]');
    expect(document.activeElement).toBe(gripsAfter[0]);

    await expect.element(page.getByText(/Role filter moved to position 1 of 2/)).toBeInTheDocument();
  });

  it("removing the focused row's filter moves focus to the next row's grip", async () => {
    renderRichGrid();
    await openFilterMenu();
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(() => document.querySelectorAll('[aria-label="Filter column"]').length).toBe(2);

    const removeButtons = document.querySelectorAll<HTMLElement>('[aria-label="Remove filter"]');
    removeButtons[0]!.click();

    await expect.poll(() => document.querySelectorAll('[aria-label="Filter column"]').length).toBe(1);
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Reorder filter");
  });

  it("removing the only filter moves focus to the Add filter button", async () => {
    renderRichGrid();
    await openFilterMenu();
    const removeButton = document.querySelector<HTMLElement>('[aria-label="Remove filter"]');
    removeButton!.click();
    await expect.poll(() => document.activeElement?.textContent).toContain("Add filter");
  });
});

describe("DataGridColumnsMenu", () => {
  it("hiding a column removes it from the grid", async () => {
    renderGrid();
    await expect.element(page.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Email" }).click();
    await expect.element(page.getByRole("columnheader", { name: "Email" })).not.toBeInTheDocument();
  });

  it("renders show/hide rows only — no pin controls", async () => {
    renderGrid();
    await page.getByRole("button", { name: "Columns" }).click();
    await expect.element(page.getByRole("menuitemcheckbox", { name: "Age" })).toBeInTheDocument();
    expect(document.querySelector(gridAttrSelector("columnsMenu"))?.textContent).not.toContain("Pin");
  });
});
