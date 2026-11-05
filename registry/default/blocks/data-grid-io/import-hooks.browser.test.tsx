import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridImportButton, DataGridImportDialog, type DataGridImportButtonProps } from "./data-grid-io";
import "@/app/global.css";

type Row = { id: string; name: string; age: string };

const columns = defineColumns<Row>()([
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 140 },
  { id: "age", header: "Age", accessorKey: "age", type: "text", width: 80, validate: (value) => (typeof value === "string" && /^\d*$/.test(value) ? null : "digits only") },
] as const);

const createRow = (index: number): Row => ({ id: `imported-${index}`, name: "", age: "" });

function Harness(props: Partial<DataGridImportButtonProps<Row>> & { onImport: DataGridImportButtonProps<Row>["onImport"] }) {
  return (
    <DataGridProvider data={[{ id: "seed", name: "Seed", age: "1" }]} columns={columns} getRowId={(r) => r.id}>
      <DataGridImportButton createRow={createRow} {...props} />
      <DataGridRoot className="h-[160px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>
  );
}

async function openAndUpload(file: File): Promise<void> {
  await userEvent.click(page.getByRole("button", { name: "Import" }));
  await userEvent.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, file);
}

const csv = (content: string, name = "people.csv") => new File([content], name, { type: "text/csv" });
const confirm = () => userEvent.click(page.getByRole("button", { name: "Import", exact: true }));

describe("import hook points in the dialog", () => {
  it("hands the file name, mapping, and rejected cells to onImport", async () => {
    const onImport = vi.fn();
    await render(<Harness onImport={onImport} />);
    await openAndUpload(csv("Name,Age\nAnn,3\nBob,x"));
    await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();
    await confirm();
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const [rows, ctx] = onImport.mock.calls[0]!;
    expect(rows.map((r: Row) => r.name)).toEqual(["Ann", "Bob"]);
    expect(ctx.fileName).toBe("people.csv");
    expect(ctx.mapping).toEqual([
      { importColumnIndex: 0, gridColumnId: "name" },
      { importColumnIndex: 1, gridColumnId: "age" },
    ]);
    expect(ctx.rejected).toEqual([{ rowIndex: 1, importColumnIndex: 1, gridColumnId: "age", message: "digits only" }]);
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
  });

  it("shows the error message of a rejected onImport and calls onImportError once", async () => {
    const onImportError = vi.fn();
    await render(<Harness onImport={() => Promise.reject(new Error("409 duplicate id"))} onImportError={onImportError} />);
    await openAndUpload(csv("Name,Age\nAnn,3"));
    await expect.element(page.getByText("Showing 1 of 1 rows")).toBeInTheDocument();
    await confirm();
    await expect.element(page.getByText("The import failed: 409 duplicate id")).toBeInTheDocument();
    expect(onImportError).toHaveBeenCalledTimes(1);
  });

  it("drops the rows above defaultHeaderRow before it maps", async () => {
    const onImport = vi.fn();
    await render(<Harness onImport={onImport} importDefaults={{ defaultHeaderRow: 2 }} />);
    await openAndUpload(csv("Report\nmade today\nName,Age\nAnn,3"));
    await expect.element(page.getByText("Showing 1 of 1 rows")).toBeInTheDocument();
    await confirm();
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0]![0]).toEqual([{ id: "imported-0", name: "Ann", age: "3" }]);
  });

  it("applies processImportRows before the build, and a veto writes nothing", async () => {
    const onImport = vi.fn();
    const processImportRows = vi.fn(({ rows }: { rows: string[][] }) => rows.filter((row) => row[0] !== "Bob"));
    await render(<Harness onImport={onImport} processImportRows={processImportRows} />);
    await openAndUpload(csv("Name,Age\nAnn,3\nBob,4"));
    await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();
    await confirm();
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0]![0].map((r: Row) => r.name)).toEqual(["Ann"]);
    expect(processImportRows.mock.calls[0]![0]).toMatchObject({ headers: ["Name", "Age"] });
  });

  it("shows an error and calls onImport never when processImportRows breaks the limits", async () => {
    const onImport = vi.fn();
    await render(<Harness onImport={onImport} importLimits={{ maxRows: 3 }} processImportRows={({ rows }) => [...rows, ...rows, ...rows]} />);
    await openAndUpload(csv("Name,Age\nAnn,3\nBob,4"));
    await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();
    await confirm();
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("parses each cell with processCellFromText, and the value still goes through validate", async () => {
    const onImport = vi.fn();
    await render(<Harness onImport={onImport} processCellFromText={(text, ctx) => ((ctx.column as { id: string }).id === "name" ? text.toUpperCase() : "abc")} />);
    await openAndUpload(csv("Name,Age\nann,3"));
    await expect.element(page.getByText("Showing 1 of 1 rows")).toBeInTheDocument();
    await confirm();
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0]![0]).toEqual([{ id: "imported-0", name: "ANN", age: "" }]);
    expect(onImport.mock.calls[0]![1].rejected).toHaveLength(1);
  });

  it("reads a file type the built-in parser does not know through parseFile and accept", async () => {
    const onImport = vi.fn();
    const parseFile = vi.fn(async (file: File) => ({ rows: (await file.text()).split("\n").map((line) => line.split("|")) }));
    await render(<Harness onImport={onImport} parseFile={parseFile} accept={{ "text/plain": [".txt"] }} />);
    await openAndUpload(new File(["Name|Age\nAnn|3"], "people.txt", { type: "text/plain" }));
    await expect.element(page.getByText("Showing 1 of 1 rows")).toBeInTheDocument();
    await confirm();
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(onImport.mock.calls[0]![0]).toEqual([{ id: "imported-0", name: "Ann", age: "3" }]);
  });

  it("loads the file prop when the dialog opens", async () => {
    const onImport = vi.fn();
    function Controlled() {
      const [open, setOpen] = useState(true);
      return (
        <DataGridProvider data={[] as Row[]} columns={columns} getRowId={(r) => r.id}>
          <DataGridImportDialog open={open} onOpenChange={setOpen} createRow={createRow} onImport={onImport} file={csv("Name,Age\nAnn,3")} />
        </DataGridProvider>
      );
    }
    await render(<Controlled />);
    await expect.element(page.getByText("Showing 1 of 1 rows")).toBeInTheDocument();
    await confirm();
    await vi.waitFor(() => expect(onImport).toHaveBeenCalled());
  });
});
