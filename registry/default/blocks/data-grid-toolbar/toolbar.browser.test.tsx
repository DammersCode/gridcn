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
  cellTypes,
  type CellType,
  type ColumnDef,
  type FilterValueInputProps,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridToolbar, DataGridSearch, DataGridFilterMenu, DataGridColumnsMenu } from "./data-grid-toolbar";
import { GRID_ATTR, gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
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
    await renderGrid();
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
    await renderGrid();
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
    await renderGrid();
    const input = page.getByRole("textbox", { name: "Search grid" });
    await input.fill("alic");
    await expect.element(page.getByText(/\d\/\d/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.element(input).toHaveValue("");
  });

  it("does not remount the row window while typing (same cell DOM node before/after)", async () => {
    await renderGrid();
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
    await renderGrid(bigRows);
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
    await renderGrid(hugeRows);
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
  it("a shrinking match list never shows an out-of-range index (e.g. 2/1) in the badge", async () => {
    const shrinkingRows = [
      { id: "r0", name: "alpha", email: "x1@example.com", age: 30 },
      { id: "r1", name: "alphabet", email: "x2@example.com", age: 40 },
      { id: "r2", name: "beta", email: "x3@example.com", age: 50 },
    ];
    await renderGrid(shrinkingRows);
    await expect.element(page.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    const input = page.getByRole("textbox", { name: "Search grid" });

    await input.fill("alp");
    await expect.element(page.getByText("1/2")).toBeInTheDocument();

    // record every badge text from here on — an out-of-range index (2/1) must never paint
    const badge = document.querySelector<HTMLElement>("[data-grid-search-count]")!;
    const observed: string[] = [];
    const mo = new MutationObserver(() => observed.push(badge.textContent ?? ""));
    mo.observe(badge, { childList: true, characterData: true, subtree: true });

    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2/2")).toBeInTheDocument();

    // one match left: the badge must go straight to 1/1
    await input.fill("alphab");
    await expect.element(page.getByText("1/1")).toBeInTheDocument();

    mo.disconnect();
    expect(observed).not.toContain("2/1");
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
    await renderGridDefault();
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
    await renderGridDefault();
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
    await renderGridDefault();
    const outsideButton = page.getByRole("button", { name: "outside button" });
    await outsideButton.click();
    const event = dispatchModF(document.activeElement ?? document.body);
    expect(event.defaultPrevented).toBe(false);
  });

  it("two grids on one page: mod+F focuses the search input of the grid that holds focus", async () => {
    await render(
      <>
        <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id} labels={{ toolbar: { searchAriaLabel: "Search grid A" } }}>
          <DataGridToolbar>
            <DataGridSearch />
          </DataGridToolbar>
          <DataGridRoot className="h-[200px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
        <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id} labels={{ toolbar: { searchAriaLabel: "Search grid B" } }}>
          <DataGridToolbar>
            <DataGridSearch />
          </DataGridToolbar>
          <DataGridRoot className="h-[200px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </>,
    );
    const [gridA, gridB] = document.querySelectorAll<HTMLElement>('[role="grid"]');
    expect(gridA).not.toBeNull();
    expect(gridB).not.toBeNull();
    const inputA = page.getByRole("textbox", { name: "Search grid A" });
    const inputB = page.getByRole("textbox", { name: "Search grid B" });
    gridA!.querySelector<HTMLElement>('[role="gridcell"]')!.focus();
    const eventA = dispatchModF(document.activeElement ?? document.body);
    expect(eventA.defaultPrevented).toBe(true);
    await expect.element(inputA).toHaveFocus();
    await expect.element(inputB).not.toHaveFocus();
    gridB!.querySelector<HTMLElement>('[role="gridcell"]')!.focus();
    const eventB = dispatchModF(document.activeElement ?? document.body);
    expect(eventB.defaultPrevented).toBe(true);
    await expect.element(inputB).toHaveFocus();
    await expect.element(inputA).not.toHaveFocus();
  });

  it("a custom [data-grid-toolbar] without an instance id still scopes mod+F to the search it holds", async () => {
    const gridWithCustomToolbar = (name: string) => (
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id} labels={{ toolbar: { searchAriaLabel: `Search grid ${name}` } }}>
        <div data-grid-toolbar="">
          <button type="button">{`tool ${name}`}</button>
          <DataGridSearch />
        </div>
        <DataGridRoot className="h-[200px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    );
    await render(
      <>
        {gridWithCustomToolbar("A")}
        {gridWithCustomToolbar("B")}
      </>,
    );
    page.getByRole("button", { name: "tool B" }).element().focus();
    const event = dispatchModF(document.activeElement ?? document.body);
    expect(event.defaultPrevented).toBe(true);
    await expect.element(page.getByRole("textbox", { name: "Search grid B" })).toHaveFocus();
    await expect.element(page.getByRole("textbox", { name: "Search grid A" })).not.toHaveFocus();
  });

  it("captureFindShortcut={false} opts out: mod+F is never intercepted regardless of focus", async () => {
    await render(
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
    await renderGridWithLabels({ toolbar: { searchPlaceholder: "Suchen…" } });
    await expect.element(page.getByPlaceholder("Suchen…")).toBeInTheDocument();
  });
});

describe("DataGridFilterMenu value reset", () => {
  function TierInput({ value }: FilterValueInputProps) {
    return <span data-testid="tier-value">{JSON.stringify(value)}</span>;
  }
  const tierType: CellType = {
    ...(cellTypes.text as unknown as CellType),
    filter: { operators: ["isAnyOf", "equals", "isBetween"], valueInput: TierInput },
  };
  const tierColumns = defineColumns<Row>()([
    { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
    { id: "email", header: "Tier", accessorKey: "email", type: "tier" as never, width: 200 },
  ]);

  it("gives a custom value input the empty value of the operator after a column or operator change", async () => {
    await render(
      <DataGridProvider data={makeRows()} columns={tierColumns} getRowId={(r) => r.id} cellTypes={{ tier: tierType } as never}>
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

    await page.getByRole("combobox", { name: "Filter column" }).click();
    await page.getByRole("option", { name: "Tier" }).click();
    await expect.poll(() => document.querySelector('[data-testid="tier-value"]')?.textContent).toBe("[]");

    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "is between" }).click();
    await expect.poll(() => document.querySelector('[data-testid="tier-value"]')?.textContent).toBe('["",""]');

    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "is any of" }).click();
    await expect.poll(() => document.querySelector('[data-testid="tier-value"]')?.textContent).toBe("[]");
  });
});

describe("DataGridFilterMenu", () => {
  it("adding a filter narrows the visible rows", async () => {
    await renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();
    // default filterable column is "name"; type "contains" value "Alic" to narrow to Alice + Alicia
    const valueInput = page.getByRole("textbox", { name: "Filter value" });
    await valueInput.fill("Alic");
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(2);
  });

  it("the filter value input stays usable-width, not squeezed to a sliver", async () => {
    await renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();
    const valueInput = document.querySelector<HTMLElement>('input[aria-label="Filter value"]');
    expect(valueInput).not.toBeNull();
    expect(valueInput!.clientWidth).toBeGreaterThanOrEqual(80);
  });

  it("long German operator labels don't collapse the value input or overflow the popover", async () => {
    await render(
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
    await render(
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
    // Operator before value: an operator change resets the value.
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "equals" }).click();
    // a number column's value input is <input type="number"> — role spinbutton, not textbox
    await page.getByRole("spinbutton", { name: "Filter value" }).fill("40");
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
    await render(
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
    await render(
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

function renderRichGrid(
  rows: RichRow[] = makeRichRows(),
  filterMenuProps: React.ComponentProps<typeof DataGridFilterMenu> = {},
  cols: readonly ColumnDef<RichRow, unknown>[] = richColumns,
) {
  return render(
    <DataGridProvider data={rows} columns={cols} getRowId={(r) => r.id}>
      <DataGridToolbar>
        <DataGridFilterMenu {...filterMenuProps} />
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
    await renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter value"]');
    expect(input).not.toBeNull();
    expect(input!.type).toBe("number");
  });

  it("a date column gets a date input", async () => {
    await renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Start Date");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter value"]');
    expect(input).not.toBeNull();
    expect(input!.type).toBe("date");
  });

  it("a checkbox column gets a true/false select", async () => {
    await renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Active");
    await expect.element(page.getByRole("combobox", { name: "Filter value" })).toBeInTheDocument();
    await page.getByRole("combobox", { name: "Filter value" }).click();
    await expect.element(page.getByRole("option", { name: "true" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "false" })).toBeInTheDocument();
  });

  it("an empty checkbox or select filter value shows the placeholder", async () => {
    await renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Active");
    await expect.element(page.getByRole("combobox", { name: "Filter value" })).toHaveTextContent("Value");
    await switchFilterColumn("Role");
    await expect.element(page.getByRole("combobox", { name: "Filter value" })).toHaveTextContent("Value");
  });

  it("a select column gets a select of its own choices", async () => {
    await renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Role");
    await page.getByRole("combobox", { name: "Filter value" }).click();
    await expect.element(page.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "User" })).toBeInTheDocument();
  });

  it("choosing a select-column value narrows the grid", async () => {
    await renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Role");
    await page.getByRole("combobox", { name: "Filter value" }).click();
    await page.getByRole("option", { name: "Admin" }).click();
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(1);
  });

  it("isBetween on a number column renders two numeric inputs and narrows inclusively", async () => {
    await renderRichGrid();
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
    await renderRichGrid();
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

  it("a checkbox filter trigger shows the label for a stored value, not the raw value", async () => {
    await render(
      <DataGridProvider
        data={makeRichRows()}
        columns={richColumns}
        getRowId={(r) => r.id}
        filterState={[{ columnId: "active", operator: "equals", value: "true" }]}
        onFilterChange={() => {}}
        labels={{ toolbar: { filterValueTrue: "Yes", filterValueFalse: "No" } }}
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
    await expect.element(page.getByRole("combobox", { name: "Filter value" })).toHaveTextContent("Yes");
  });

  it("a select filter trigger shows the choice label for a stored value, not the raw value", async () => {
    await render(
      <DataGridProvider
        data={makeRichRows()}
        columns={richColumns}
        getRowId={(r) => r.id}
        filterState={[{ columnId: "role", operator: "equals", value: "admin" }]}
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
    await page.getByRole("button", { name: "Filters" }).click();
    await expect.element(page.getByRole("combobox", { name: "Filter value" })).toHaveTextContent("Admin");
  });

  it("isAnyOf and isNoneOf are offered for number columns", async () => {
    await renderRichGrid();
    await openFilterMenu();
    await switchFilterColumn("Age");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await expect.element(page.getByRole("option", { name: "is between" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "is any of" })).toBeInTheDocument();
    await expect.element(page.getByRole("option", { name: "is none of" })).toBeInTheDocument();
  });
});

describe("DataGridFilterMenu operator list overrides", () => {
  it("operatorsForColumn replaces the per-column operator list", async () => {
    await renderRichGrid(undefined, {
      operatorsForColumn: (column) => (column.id === "name" ? ["equals", "gt", "lt"] : undefined),
    });
    await openFilterMenu();
    await switchFilterColumn("Name");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await expect.element(page.getByRole("option", { name: "greater than" })).toBeInTheDocument();
    expect(document.querySelector('[role="option"][data-value="isBetween"]')).toBeNull();
  });

  it("column.filterOperators replaces the built-in list for that column", async () => {
    const cols = richColumns.map((c) => (c.id === "age" ? { ...c, filterOperators: ["contains"] as const } : c));
    await renderRichGrid(undefined, {}, cols);
    await openFilterMenu();
    await switchFilterColumn("Age");
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await expect.element(page.getByRole("option", { name: "contains" })).toBeInTheDocument();
    expect(document.querySelector('[role="option"][data-value="isBetween"]')).toBeNull();
  });

  it("a filterOperators column filters with its custom operators", async () => {
    // age is number-typed; a custom list offering only gt still filters with the built-in gt matcher
    const cols = richColumns.map((c) => (c.id === "age" ? { ...c, filterOperators: ["gt"] as const } : c));
    await renderRichGrid(undefined, {}, cols);
    await openFilterMenu();
    await switchFilterColumn("Age"); // the row's operator defaults to the custom list's first entry
    await page.getByRole("spinbutton", { name: "Filter value" }).fill("30");
    // only Bob (40) is > 30
    await expect.poll(() => document.querySelectorAll('[role="row"]').length - 1).toBe(1);
  });
});

describe("DataGridFilterMenu multiple filters on one column", () => {
  it("two filter rows on the same column both apply (AND intersects to a narrower range)", async () => {
    await renderRichGrid();
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

describe("DataGridFilterMenu groups", () => {
  const rowCount = () => document.querySelectorAll('[role="row"]').length - 1;
  const buttons = (name: string) => [...document.querySelectorAll<HTMLElement>("button")].filter((b) => (b.getAttribute("aria-label") ?? b.textContent) === name);
  const valueInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[aria-label="Filter value"]')];
  const click = async (el: HTMLElement | undefined) => {
    el!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  /** Builds "Age > 26 and (Name contains Ali or Name contains Bo)" by clicking. */
  async function buildIssueExample() {
    await renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await click(buttons("Add filter")[0]);
    await page.getByRole("combobox", { name: "Filter column" }).click();
    await page.getByRole("option", { name: "Age" }).click();
    await page.getByRole("combobox", { name: "Filter operator" }).click();
    await page.getByRole("option", { name: "greater than", exact: true }).click();
    await userEvent.fill(valueInputs()[0]!, "26");
    await expect.poll(rowCount).toBe(3);

    await click(buttons("Add group")[0]);
    await expect.poll(() => document.querySelectorAll("[data-grid-filter-group]").length).toBe(1);
    await userEvent.fill(valueInputs()[1]!, "Ali");
    await click(buttons("Add filter")[0]); // the group footer precedes the top-level footer in DOM order
    await expect.poll(() => valueInputs().length).toBe(3);
    await userEvent.fill(valueInputs()[2]!, "Bo");
    await expect.poll(rowCount).toBe(2);
  }

  it("shows no connector select at the top level and Where on the first row", async () => {
    await renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await click(buttons("Add filter")[0]);
    await click(buttons("Add filter")[0]);
    expect(document.querySelector('[role="combobox"][aria-label^="Connector of filter"]')).toBeNull();
    const connectors = [...document.querySelectorAll("[data-grid-filter-row] > div:first-child")].map((c) => c.textContent);
    expect(connectors).toEqual(["Where", "And"]);
  });

  it("builds the issue example by clicking and counts leaf rows in the badge", async () => {
    await buildIssueExample();
    expect(document.querySelector("[data-grid-filter-count]")?.textContent).toBe("3");
    expect([...document.querySelectorAll("[data-grid-filter-group] [data-grid-filter-row] > div:first-child")].map((c) => c.textContent)).toEqual(["Where", "Or"]);
  });

  it("has no group header select; the connector select of a later row replaces it", async () => {
    await buildIssueExample();
    expect(page.getByText("Match any of the following").query()).toBeNull();
    expect(page.getByText("Match all of the following").query()).toBeNull();
    expect(document.querySelectorAll('[data-grid-filter-group] [role="combobox"][aria-label^="Connector of filter"]')).toHaveLength(1);
    const group = document.querySelector("[data-grid-filter-group]")!;
    expect(group.querySelector(":scope > div:nth-child(2) > [role='combobox']")).toBeNull();
  });

  it("keeps the first row's connector and the top level connector static", async () => {
    await buildIssueExample();
    const connector = (row: Element) => row.querySelector(":scope > div:first-child")!;
    const groupRows = [...document.querySelectorAll("[data-grid-filter-group] [data-grid-filter-row]")];
    expect(connector(groupRows[0]!).textContent).toBe("Where");
    expect(connector(groupRows[0]!).querySelector("[role='combobox']")).toBeNull();
    expect(connector(groupRows[1]!).querySelector("[role='combobox']")).not.toBeNull();
    const group = document.querySelector("[data-grid-filter-group]")!;
    expect(connector(group).textContent).toBe("And");
    expect(connector(group).querySelector("[role='combobox']")).toBeNull();
  });

  it("changing the connector on one row sets it on every row of that group and re-filters", async () => {
    await buildIssueExample();
    await click(buttons("Add filter")[0]); // third row in the group
    await expect.poll(() => valueInputs().length).toBe(4);
    const selects = () => [...document.querySelectorAll<HTMLElement>('[data-grid-filter-group] [role="combobox"][aria-label^="Connector of filter"]')];
    expect(selects().map((s) => s.textContent)).toEqual(["Or", "Or"]);
    await page.getByRole("combobox", { name: "Connector of filter 2 in group 1" }).click();
    await page.getByRole("option", { name: "And", exact: true }).click();
    await expect.poll(() => selects().map((s) => s.textContent)).toEqual(["And", "And"]);
    // Age > 26 and (Ali and Bo and ""): no name holds both
    await expect.poll(rowCount).toBe(0);
    expect(valueInputs()[0]!.value).toBe("26");
    await page.getByRole("combobox", { name: "Connector of filter 3 in group 1" }).click();
    await page.getByRole("option", { name: "Or", exact: true }).click();
    await expect.poll(() => selects().map((s) => s.textContent)).toEqual(["Or", "Or"]);
    await expect.poll(rowCount).toBeGreaterThan(0);
  });

  it("reordering inside a group keeps the result and the level", async () => {
    await buildIssueExample();
    const grips = [...document.querySelectorAll<HTMLElement>('[aria-label="Reorder filter"]')];
    grips[2]!.focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(() => valueInputs().map((i) => i.value)).toEqual(["26", "Bo", "Ali"]);
    expect(rowCount()).toBe(2);
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Reorder filter");
  });

  it("removing the last row of a group removes the group", async () => {
    await buildIssueExample();
    const groupRemove = () => [...document.querySelectorAll<HTMLElement>("[data-grid-filter-group] [data-grid-filter-row] [aria-label='Remove filter']")];
    await click(groupRemove()[0]);
    await click(groupRemove()[0]);
    await expect.poll(() => document.querySelectorAll("[data-grid-filter-group]").length).toBe(0);
    await expect.poll(rowCount).toBe(3);
  });

  it("removing a group removes its rows", async () => {
    await buildIssueExample();
    await click(buttons("Remove group")[0]);
    await expect.poll(() => document.querySelectorAll("[data-grid-filter-group]").length).toBe(0);
    expect(valueInputs()).toHaveLength(1);
  });

  it("hides Add group inside a subgroup", async () => {
    await buildIssueExample();
    expect(buttons("Add group")).toHaveLength(2);
    await click(buttons("Add group")[0]);
    await expect.poll(() => document.querySelectorAll("[data-grid-filter-group]").length).toBe(2);
    expect(buttons("Add group")).toHaveLength(2);
    const subgroup = document.querySelectorAll<HTMLElement>("[data-grid-filter-group] [data-grid-filter-group]")[0]!;
    expect([...subgroup.querySelectorAll("button")].some((b) => b.textContent === "Add group")).toBe(false);
  });

  it("a keyboard user adds a group and removes it from its handle", async () => {
    await renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    buttons("Add group")[0]!.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.querySelectorAll("[data-grid-filter-group]").length).toBe(1);
    const groupGrip = document.querySelector<HTMLElement>("[data-grid-filter-group] > button[aria-label='Reorder filter']:last-child");
    groupGrip!.focus();
    await userEvent.keyboard("{Backspace}");
    await expect.poll(() => document.querySelectorAll("[data-grid-filter-group]").length).toBe(0);
  });
});

describe("DataGridFilterMenu drag landing indicator", () => {
  const rowElements = () => document.querySelectorAll("[data-grid-filter-row]");
  const indicators = () => [...document.querySelectorAll<HTMLElement>("[data-grid-filter-drop-indicator]")];
  const columnLabels = () => [...document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]')].map((c) => c.textContent);
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const pointer = (type: string, x: number, y: number, target: EventTarget = document) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, clientX: x, clientY: y }));
  const center = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const gripOfRow = (i: number) => rowElements()[i]!.querySelector("[aria-label='Reorder filter']")!;

  async function renderTwoRows() {
    await renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(() => rowElements().length).toBe(1);
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(() => rowElements().length).toBe(2);
    document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]')[1]!.click();
    await page.getByRole("option", { name: "Age" }).click();
    await expect.poll(columnLabels).toEqual(["Name", "Age"]);
  }

  /** Presses the drag handle of row `from` and moves the pointer to `offset` px past the center of row `to`. */
  async function dragRow(from: number, to: number, offset: number) {
    const start = center(gripOfRow(from));
    const end = center(rowElements()[to]!);
    pointer("pointerdown", start.x, start.y, gripOfRow(from));
    for (let i = 1; i <= 6; i++) {
      pointer("pointermove", start.x, start.y + ((end.y + offset - start.y) * i) / 6);
      await pause(20);
    }
    return { x: end.x, y: end.y + offset };
  }

  it("shows one landing indicator after the target while dragging down, and removes it on drop", async () => {
    await renderTwoRows();
    const [, second] = [...rowElements()];
    const end = await dragRow(0, 1, 4);
    await expect.poll(() => indicators().length).toBe(1);
    expect(second!.contains(indicators()[0]!)).toBe(true);
    expect(indicators()[0]!.getBoundingClientRect().top).toBeGreaterThan(second!.getBoundingClientRect().top + second!.getBoundingClientRect().height / 2);
    pointer("pointerup", end.x, end.y);
    await expect.poll(columnLabels).toEqual(["Age", "Name"]);
    await expect.poll(() => indicators().length).toBe(0);
  });

  it("puts the indicator before the target while dragging up", async () => {
    await renderTwoRows();
    const [first] = [...rowElements()];
    const end = await dragRow(1, 0, -4);
    await expect.poll(() => indicators().length).toBe(1);
    expect(first!.contains(indicators()[0]!)).toBe(true);
    expect(indicators()[0]!.getBoundingClientRect().top).toBeLessThan(first!.getBoundingClientRect().top + first!.getBoundingClientRect().height / 2);
    pointer("pointerup", end.x, end.y);
    await expect.poll(columnLabels).toEqual(["Age", "Name"]);
  });

  it("Escape removes the indicator and leaves the order unchanged", async () => {
    await renderTwoRows();
    const end = await dragRow(0, 1, 4);
    await expect.poll(() => indicators().length).toBe(1);
    gripOfRow(0).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect.poll(() => indicators().length).toBe(0);
    pointer("pointerup", end.x, end.y);
    await expect.poll(columnLabels).toEqual(["Name", "Age"]);
    await pause(100);
    expect(columnLabels()).toEqual(["Name", "Age"]);
    expect(page.getByRole("button", { name: "Add filter" }).query()).not.toBeNull();
  });

  it("pointercancel removes the indicator and leaves the order unchanged", async () => {
    await renderTwoRows();
    const end = await dragRow(0, 1, 4);
    await expect.poll(() => indicators().length).toBe(1);
    pointer("pointercancel", end.x, end.y);
    await expect.poll(() => indicators().length).toBe(0);
    await expect.poll(columnLabels).toEqual(["Name", "Age"]);
  });

  it("shows the landing indicator inside the group of a nested drag, hidden from assistive tech", async () => {
    await renderGrid();
    await page.getByRole("button", { name: "Filters" }).click();
    await page.getByRole("button", { name: "Add group" }).first().click();
    await expect.poll(() => rowElements().length).toBe(1);
    await page.getByRole("button", { name: "Add filter" }).first().click();
    await expect.poll(() => rowElements().length).toBe(2);
    const group = document.querySelector("[data-grid-filter-group]")!;
    const [, second] = [...rowElements()];
    const end = await dragRow(0, 1, 4);
    await expect.poll(() => indicators().length).toBe(1);
    const indicator = indicators()[0]!;
    expect(group.contains(indicator)).toBe(true);
    expect(second!.contains(indicator)).toBe(true);
    expect(indicator).toHaveAttribute("aria-hidden", "true");
    expect(indicator.className).toContain("motion-safe:animate-in");
    pointer("pointerup", end.x, end.y);
    await expect.poll(() => indicators().length).toBe(0);
  });

  it("shows no indicator while the pointer is still over the dragged row", async () => {
    await renderTwoRows();
    const start = center(gripOfRow(0));
    pointer("pointerdown", start.x, start.y, gripOfRow(0));
    pointer("pointermove", start.x, start.y + 2);
    await expect.poll(() => document.querySelectorAll("[data-grid-filter-row]").length).toBe(3); // the lifted clone proves the drag started
    await pause(60);
    expect(indicators()).toHaveLength(0);
    pointer("pointerup", start.x, start.y + 2);
  });
});

describe("DataGridFilterMenu reorder", () => {
  it("ArrowUp on the grip moves that filter row earlier in the array order", async () => {
    await renderRichGrid();
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
    await renderRichGrid();
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
    await renderRichGrid();
    await openFilterMenu();
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(() => document.querySelectorAll('[aria-label="Filter column"]').length).toBe(2);

    const removeButtons = document.querySelectorAll<HTMLElement>('[aria-label="Remove filter"]');
    removeButtons[0]!.click();

    await expect.poll(() => document.querySelectorAll('[aria-label="Filter column"]').length).toBe(1);
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toBe("Reorder filter");
  });

  it("Backspace and Delete on the focused grip remove that filter row", async () => {
    await renderRichGrid();
    await openFilterMenu(); // row 0: name
    await page.getByRole("button", { name: "Add filter" }).click();
    // second row targets "age" so the rows are distinguishable
    const columnTriggers = document.querySelectorAll<HTMLElement>('[aria-label="Filter column"]');
    columnTriggers[1]!.click();
    await page.getByRole("option", { name: "Age" }).click();

    let grips = document.querySelectorAll<HTMLElement>('[aria-label="Reorder filter"]');
    expect(grips.length).toBe(2);

    grips[0]!.focus();
    await userEvent.keyboard("{Backspace}");
    await expect.poll(() => document.querySelectorAll('[aria-label="Reorder filter"]').length).toBe(1);
    await expect
      .poll(() => document.querySelector<HTMLElement>('[aria-label="Filter column"]')?.textContent)
      .toContain("Age"); // the name row is gone, age remains

    grips = document.querySelectorAll<HTMLElement>('[aria-label="Reorder filter"]');
    grips[0]!.focus();
    await userEvent.keyboard("{Delete}");
    await expect.poll(() => document.querySelectorAll('[aria-label="Reorder filter"]').length).toBe(0);
  });

  it("removing the only filter moves focus to the Add filter button", async () => {
    await renderRichGrid();
    await openFilterMenu();
    const removeButton = document.querySelector<HTMLElement>('[aria-label="Remove filter"]');
    removeButton!.click();
    await expect.poll(() => document.activeElement?.textContent).toContain("Add filter");
  });
});

describe("DataGridColumnsMenu", () => {
  it("hiding a column removes it from the grid", async () => {
    await renderGrid();
    await expect.element(page.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Email" }).click();
    await expect.element(page.getByRole("columnheader", { name: "Email" })).not.toBeInTheDocument();
  });

  it("lists the members of a column group under a non-interactive heading", async () => {
    await render(
      <div style={{ height: 400, width: 900 }}>
        <DataGridProvider
          data={makeRows()}
          columns={columns}
          columnGroups={[{ id: "contact", header: "Contact", children: ["email", "age"] }]}
          getRowId={(r) => r.id}
        >
          <DataGridToolbar>
            <DataGridColumnsMenu />
          </DataGridToolbar>
          <DataGridRoot className="h-[300px] w-[900px]">
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      </div>,
    );
    await page.getByRole("button", { name: "Columns" }).click();
    const menu = document.querySelector(gridAttrSelector("columnsMenu"))!;
    const group = menu.querySelector('[role="group"]')!;
    expect(group.textContent).toContain("Contact");
    expect([...group.querySelectorAll('[role="menuitemcheckbox"]')].map((el) => el.textContent)).toEqual(["Email", "Age"]);
    expect(group.querySelector('[role="menuitemcheckbox"]')?.textContent).not.toContain("Contact");
    expect(menu.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(3);
  });

  it("renders show/hide rows only — no pin controls", async () => {
    await renderGrid();
    await page.getByRole("button", { name: "Columns" }).click();
    await expect.element(page.getByRole("menuitemcheckbox", { name: "Age" })).toBeInTheDocument();
    expect(document.querySelector(gridAttrSelector("columnsMenu"))?.textContent).not.toContain("Pin");
  });
});

describe("DataGridSearch layout", () => {
  it("groups the icon, the input and the match count in one input group", async () => {
    await render(
      <DataGridProvider data={Array.from({ length: 10 }, (_, i) => ({ id: "r" + i, name: i % 2 ? "needle" : "hay" }))} columns={defineColumns<{ id: string; name: string }>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 }] as const)} getRowId={(r) => r.id} defaultSearchText="needle">
        <DataGridSearch />
        <DataGridRoot className="h-40">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    const input = document.querySelector<HTMLInputElement>("[data-grid-search] input")!;
    const group = input.closest('[data-slot="input-group"]')!;
    expect(group).not.toBeNull();
    const count = document.querySelector<HTMLElement>("[data-grid-search-count]")!;
    expect(group.contains(count)).toBe(true);
    expect(count.getBoundingClientRect().left).toBeGreaterThan(input.getBoundingClientRect().left);
  });
});

describe("DataGridFilterMenu focus after add", () => {
  async function openMenu() {
    await render(
      <DataGridProvider data={makeRows()} columns={columns} getRowId={(r) => r.id}>
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
  }
  const focusedLabel = () => document.activeElement?.getAttribute("aria-label");

  it("moves focus to the column select of the new row after Add filter and Add group", async () => {
    await openMenu();
    await page.getByRole("button", { name: "Add filter" }).click();
    await expect.poll(focusedLabel).toBe("Filter column");
    await page.getByRole("button", { name: "Add group" }).first().click();
    await expect.poll(() => document.querySelectorAll('[data-grid-filter-row]').length).toBe(2);
    await expect.poll(() => document.activeElement?.closest("[data-grid-filter-group]") !== null).toBe(true);
    expect(focusedLabel()).toBe("Filter column");
  });
});
