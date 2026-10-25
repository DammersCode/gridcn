import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, useDataGridActions, type ColumnDef } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

const rows: Row[] = Array.from({ length: 12 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, email: `p${i}@example.com` }));

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, pin: "left" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
];

const isOpaque = (color: string) => color !== "rgba(0, 0, 0, 0)" && !/\/\s*[\d.]+%?\s*\)/.test(color);

function ActionsCapture({ onActions }: { onActions: (actions: ReturnType<typeof useDataGridActions>) => void }) {
  onActions(useDataGridActions());
  return null;
}

async function mount(searchText?: string) {
  let actions!: ReturnType<typeof useDataGridActions>;
  await render(
    <div style={{ height: 300, width: 400 }}>
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} searchText={searchText}>
        <ActionsCapture onActions={(a) => (actions = a)} />
        <DataGridRoot className="h-75 w-100">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
  await expect.element(page.getByRole("grid")).toBeInTheDocument();
  return { actions: () => actions };
}

const cellOf = (rowIndex: number, columnId: string) =>
  document.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${rowIndex}"] [role="gridcell"][data-column-id="${columnId}"]`)!;

describe("pinned cells stay opaque under translucent tints", () => {
  it("keeps a pinned search-match cell opaque", async () => {
    await mount("Person 3");
    await vi.waitFor(() => expect(cellOf(3, "name")).toHaveAttribute("data-search-match"));
    expect(isOpaque(getComputedStyle(cellOf(3, "name")).backgroundColor)).toBe(true);
  });

  it("keeps a pinned invalid cell opaque", async () => {
    const { actions } = await mount();
    actions().setCellErrors([{ rowId: "row-2", columnId: "name", message: "Taken" }]);
    await vi.waitFor(() => expect(cellOf(2, "name")).toHaveAttribute("aria-invalid", "true"));
    expect(isOpaque(getComputedStyle(cellOf(2, "name")).backgroundColor)).toBe(true);
  });
});
