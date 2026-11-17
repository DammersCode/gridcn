import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, DataGridRoot, DataGridHeader, DataGridBody, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridImportButton, type ImportContext } from "./data-grid-io";
import type { ImportCheckAnswer } from "./import-check";
import "@/app/global.css";

type Row = { id: string; name: string };

const columns = defineColumns<Row>()([{ id: "name", header: "Name", accessorKey: "name", type: "text", width: 160 }] as const);

type Check = (rows: Row[], ctx: { signal: AbortSignal }) => ImportCheckAnswer | void | Promise<ImportCheckAnswer | void>;

async function mount(checkImport: Check, onImport = vi.fn((_rows: Row[], _ctx: ImportContext) => Promise.resolve())) {
  await render(
    <DataGridProvider data={[] as Row[]} columns={columns} getRowId={(row) => row.id}>
      <DataGridImportButton createRow={(index): Row => ({ id: `new-${index}`, name: "" })} onImport={onImport} checkImport={checkImport} />
      <DataGridRoot className="h-[120px]">
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot>
    </DataGridProvider>,
  );
  await userEvent.click(page.getByRole("button", { name: "Import" }));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await userEvent.upload(input, new File(["Name\nAnn\nBo"], "people.csv", { type: "text/csv" }));
  await expect.element(page.getByText("Showing 2 of 2 rows")).toBeInTheDocument();
  return onImport;
}

const confirm = () => userEvent.click(page.getByRole("button", { name: "Import", exact: true }));

describe("import check step", () => {
  it("goes on to onImport when the answer has no refusals", async () => {
    const onImport = await mount(() => ({ summary: { created: 2 } }));
    await confirm();
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
  });

  it("lists the refusals, keeps onImport waiting, and Back returns focus to Import", async () => {
    const onImport = await mount(() => ({ rejected: [{ rowIndex: 1, columnId: "name", message: "name is taken" }], summary: { created: 1 } }));
    await confirm();
    await expect.element(page.getByText("name is taken")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Back" })).toHaveFocus();
    expect(onImport).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("button", { name: "Import", exact: true })).toHaveFocus();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("Import anyway saves the rows", async () => {
    const onImport = await mount(() => ({ rejected: [{ rowIndex: 0, message: "x" }] }));
    await confirm();
    await userEvent.click(page.getByRole("button", { name: "Import anyway" }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0]![0]).toHaveLength(2);
  });

  it("shows the check failure for a hostile answer and for a rejection, and saves nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onImport = await mount(() => ({ rejected: [{ rowIndex: 99 }] }));
    await confirm();
    await expect.element(page.getByText("The rows could not be checked. Try again.")).toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders a message as text, never as markup", async () => {
    await mount(() => ({ rejected: [{ rowIndex: 0, message: "<img src=x onerror=alert(1)>" }] }));
    await confirm();
    await expect.element(page.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("aborts the signal when the dialog is cancelled during the check", async () => {
    let seen: AbortSignal | undefined;
    await mount((_rows, { signal }) => {
      seen = signal;
      return new Promise<void>(() => {});
    });
    await confirm();
    await vi.waitFor(() => expect(seen).toBeDefined());
    await userEvent.click(page.getByRole("button", { name: "Cancel" }));
    expect(seen!.aborted).toBe(true);
  });
});
