import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { defineColumns, DataGrid } from "../data-grid";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

type Row = { id: string; name: string; age: number | null };

// sparse dataset: a dense 3x3 block (rows 0-2) at the origin, then two rows of nulls (both
// columns empty) before a lone unrelated cell at row 5 — the data region around (0,0) is just
// the 3x3 block, not the whole 6-row grid.
const rows: Row[] = [
  { id: "r0", name: "a", age: 1 },
  { id: "r1", name: "b", age: 2 },
  { id: "r2", name: "c", age: 3 },
  { id: "r3", name: "", age: null },
  { id: "r4", name: "", age: null },
  { id: "r5", name: "z", age: 9 },
];

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120 },
  { id: "age", header: "Age", accessorKey: "age", type: "number", width: 120 },
] as const);

function renderGrid() {
  return render(
    <div style={{ height: 400 }}>
      <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[400px]" />
    </div>,
  );
}

function selectedCount(): number {
  return document.querySelectorAll('[role="gridcell"][aria-selected="true"]').length;
}

describe("two-stage Ctrl+A (sparse dataset)", () => {
  it("first Ctrl+A selects the data region, second selects the whole grid, then a move resets the progression", async () => {
    renderGrid();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const nameCells = [...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="name"]')];
    await userEvent.click(nameCells[0]!); // active cell at (0,0), inside the dense 3x3 block

    await userEvent.keyboard("{Control>}a{/Control}");
    // stage 1: only the 3x3 data region (2 columns x 3 rows) is selected, not all 6 rows.
    expect(selectedCount()).toBe(6);

    await userEvent.keyboard("{Control>}a{/Control}");
    // stage 2 (immediate repeat): the whole grid (2 columns x 6 rows).
    expect(selectedCount()).toBe(12);

    await userEvent.keyboard("{ArrowDown}");
    // any active-cell move resets the progression back to stage 1.
    await userEvent.keyboard("{Control>}a{/Control}");
    expect(selectedCount()).toBe(6);
  });
});
