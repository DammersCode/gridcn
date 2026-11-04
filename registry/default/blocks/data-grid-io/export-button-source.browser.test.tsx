import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridExportButton, type ExportSourceContext } from "./data-grid-io";
import "@/app/global.css";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 }] as const);

function Grid({ source }: { source: (ctx: ExportSourceContext) => Promise<Row[]> }) {
  return (
    <DataGridProvider data={[{ id: "p", name: "page" }]} columns={columns} getRowId={(r) => r.id}>
      <DataGridExportButton formats={["csv"]} options={{ source }} />
      <DataGridRoot className="h-[120px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

describe("DataGridExportButton with a source", () => {
  it("offers all-rows items, announces the result, and disables the other items while it runs", async () => {
    let release!: () => void;
    const source = vi.fn(() => new Promise<Row[]>((resolve) => (release = () => resolve([{ id: "a", name: "a" }]))));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    await render(<Grid source={source} />);
    await userEvent.click(page.getByRole("button", { name: "Export" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Export all rows as CSV" }));
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(1));

    await userEvent.click(page.getByRole("button", { name: "Export" }));
    await expect.element(page.getByRole("menuitem", { name: "Export as CSV" })).toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByRole("menuitem", { name: "Cancel export" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    release();
    await expect.element(page.getByText("1 rows exported")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("cancels a run that never settles and announces it", async () => {
    await render(<Grid source={() => new Promise<Row[]>(() => {})} />);
    await userEvent.click(page.getByRole("button", { name: "Export" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Export all rows as CSV" }));
    await userEvent.click(page.getByRole("button", { name: "Export" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Cancel export" }));
    await expect.element(page.getByText("Export cancelled")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Export" })).not.toHaveAttribute("aria-busy");
  });
});
