import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridImportButton } from "./data-grid-io";
import "@/app/global.css";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 }] as const);

const NOT_AVAILABLE = "Import is not available: this grid loads its rows from a server.";
const UNSUPPORTED = "Unsupported file type — choose a .csv, .tsv, .xlsx, or .xls file.";

function sparseRows(): Row[] {
  const rows = new Array<Row | undefined>(50);
  rows[0] = { id: "row-0", name: "Row 0" };
  return rows as Row[];
}

const denseRows = (): Row[] => [{ id: "row-0", name: "Row 0" }];

function Grid({ data, onImport }: { data: Row[]; onImport?: (rows: Row[]) => void }) {
  return (
    <DataGridProvider data={data} columns={columns} getRowId={(row: Row | undefined, index: number) => row?.id ?? `hole-${index}`}>
      <DataGridImportButton createRow={(index): Row => ({ id: `new-${index}`, name: "" })} onImport={onImport} />
      <DataGridRoot className="h-[200px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

async function pickCsv(content: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, new File([content], "people.csv", { type: "text/csv" }));
  await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();
}

describe("import append gate on a sparse data array", () => {
  it("blocks the default append at open when rows are unloaded and no onImport is given", async () => {
    await render(<Grid data={sparseRows()} />);
    const trigger = page.getByRole("button", { name: "Import" });
    await expect.element(trigger).toBeDisabled();
    await expect.element(trigger).toHaveAttribute("title", NOT_AVAILABLE);
  });

  it("shows no block at open when onImport takes the rows", async () => {
    await render(<Grid data={sparseRows()} onImport={() => {}} />);
    await userEvent.click(page.getByRole("button", { name: "Import" }));
    await expect.element(page.getByText("Import file")).toBeInTheDocument();
    await expect.element(page.getByText(NOT_AVAILABLE)).not.toBeInTheDocument();
  });

  it("blocks the append at confirm when holes appear after the dialog opened", async () => {
    const screen = await render(<Grid data={denseRows()} />);
    await userEvent.click(page.getByRole("button", { name: "Import" }));
    await expect.element(page.getByText(NOT_AVAILABLE)).not.toBeInTheDocument();
    await pickCsv("Name\nAlice\nBob");

    await screen.rerender(<Grid data={sparseRows()} />);

    await expect.element(page.getByRole("alert")).toHaveTextContent(NOT_AVAILABLE);
    await expect.element(page.getByRole("dialog").getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  });
});

describe("dropping a file of a wrong type", () => {
  it("shows the unsupported-file label and keeps the dropzone", async () => {
    await render(<Grid data={denseRows()} onImport={() => {}} />);
    await userEvent.click(page.getByRole("button", { name: "Import" }));
    const dropzone = document.querySelector<HTMLElement>('[role="button"][aria-label="Choose file"]')!;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["not a sheet"], "photo.png", { type: "image/png" }));
    dropzone.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    dropzone.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    dropzone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));

    await expect.element(page.getByText(UNSUPPORTED)).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
  });
});
