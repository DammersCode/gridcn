import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, email: `p${i}@example.com` }));

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, pin: "left" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
];

const cellOf = (columnId: string) => document.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="3"] [role="gridcell"][data-column-id="${columnId}"]`)!;
const isTransparent = (color: string) => color === "rgba(0, 0, 0, 0)" || /\/\s*0(%|\s*\))/.test(color);

describe("quick-search tint without the search-highlight theme color", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--search-highlight");
    document.documentElement.style.removeProperty("--color-search-highlight");
  });

  it.each([
    ["name", "pinned"],
    ["email", "scrolling"],
  ])("tints a match in the %s column (%s)", async (columnId) => {
    document.documentElement.style.setProperty("--search-highlight", "initial");
    document.documentElement.style.setProperty("--color-search-highlight", "initial");
    await render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} searchText="3">
        <DataGridRoot className="h-75 w-100">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await vi.waitFor(() => expect(cellOf(columnId)).toHaveAttribute("data-search-match"));
    expect(isTransparent(getComputedStyle(cellOf(columnId)).backgroundColor)).toBe(false);
  });
});
