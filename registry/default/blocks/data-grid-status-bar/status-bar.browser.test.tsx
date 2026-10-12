import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  defineColumns,
  numberCellType,
  type AnyCellType,
  type ColumnDef,
} from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridStatusBar } from "./data-grid-status-bar";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply (same convention as sort-list.browser.test.tsx)
import "@/app/global.css";

type Row = { id: string; name: string; age: number; score: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, age: 20 + i, score: 10 + i * 3 }));
}

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 100 },
  { id: "score", header: "Score", accessorKey: "score", type: "number", width: 100 },
] as const);

const moneyColumns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "money", header: "Money", accessorKey: "age", type: "money", width: 100 },
];

const moneyCellType: AnyCellType = {
  ...numberCellType,
  toDisplayText: (value: number | null) => (value === null ? "" : `$${value}`),
};

function renderGrid(options: { rows?: Row[]; money?: boolean } = {}) {
  const { rows = makeRows(8), money = false } = options;
  return render(
    <div style={{ height: 400 }}>
      <DataGridProvider
        data={rows}
        columns={money ? moneyColumns : columns}
        getRowId={(r) => r.id}
        cellTypes={money ? { money: moneyCellType } : undefined}
      >
        <DataGridRoot className="h-[400px]">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
        <DataGridStatusBar />
      </DataGridProvider>
    </div>,
  );
}

function cell(columnId: string, viewRow: number): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-grid-row-index="${viewRow}"] [role="gridcell"][data-column-id="${columnId}"]`)!;
}

// The grid core keeps its own sr-only role=status live region, so the bar is the status
// element that carries the aggregate labels.
function statusBar(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[role="status"]')].find((el) => el.textContent?.includes("Count")) ?? null;
}

describe("status bar in a real browser", () => {
  it("a Shift+click range shows count/sum/avg/min/max in a role=status bar", async () => {
    await renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(statusBar()).toBeNull(); // nothing selected: only the core sr-only live region

    await userEvent.click(cell("name", 0));
    await userEvent.click(cell("score", 2), { modifiers: ["Shift"] });

    const status = statusBar()!;
    expect(status).toHaveAttribute("aria-live", "polite");
    // rows 0-2, all 3 columns: 3 names + ages 20,21,22 + scores 10,13,16
    expect(status.textContent).toContain("Count 9");
    expect(status.textContent).toContain("Sum 102");
    expect(status.textContent).toContain("Avg 17");
    expect(status.textContent).toContain("Min 10");
    expect(status.textContent).toContain("Max 22");
    expect(status).not.toHaveAttribute("title");
  });

  it("formats with the single numeric column's toDisplayText", async () => {
    await renderGrid({ money: true });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(cell("money", 0));
    await userEvent.click(cell("money", 2), { modifiers: ["Shift"] });

    const status = statusBar()!;
    // ages 20, 21, 22 through the money type's toDisplayText
    expect(status.textContent).toContain("Sum $63");
    expect(status.textContent).toContain("Avg $21");
    expect(status.textContent).toContain("Min $20");
    expect(status.textContent).toContain("Max $22");
    // count is not a display value and stays default-formatted
    expect(status.textContent).toContain("Count 3");
  });

  it("marks a capped select-all with ≈ and the cap title", { timeout: 30_000 }, async () => {
    // 100k rows x 3 columns = 300k cells, above MAX_STATUS_CELLS (200k)
    await renderGrid({ rows: makeRows(100_000) });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(cell("name", 0));
    await userEvent.keyboard("{Control>}a"); // dense data: one press already selects the whole grid

    await vi.waitFor(
      () => {
        expect(statusBar()!).toHaveAttribute("title", "From the first 200,000 cells");
      },
      { timeout: 15_000 },
    );
    expect(statusBar()!.textContent).toContain("≈");
  });
});
