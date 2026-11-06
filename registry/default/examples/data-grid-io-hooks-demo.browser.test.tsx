import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridIOHooksDemo from "./data-grid-io-hooks-demo";
import "@/app/global.css";

describe("data-grid-io-hooks-demo", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uploads the CSV instead of downloading it and shows what the file holds", async () => {
    const download = vi.spyOn(URL, "createObjectURL");
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("switch", { name: "Upload instead of download" }));
    await userEvent.click(page.getByRole("button", { name: "Export CSV" }));
    await expect.element(page.getByText(/^Uploading/)).toBeInTheDocument();
    await expect.element(page.getByText(/^Uploaded: orders\.csv/), { timeout: 4000 }).toBeInTheDocument();
    await expect.element(page.getByText(/Id,Name,Price,Qty/)).toBeInTheDocument();
    expect(download).not.toHaveBeenCalled();
  });

  it("cancels a running upload", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("switch", { name: "Upload instead of download" }));
    await userEvent.click(page.getByRole("button", { name: "Export CSV" }));
    await userEvent.click(page.getByRole("button", { name: "Cancel upload" }));
    await expect.element(page.getByText(/^Upload cancelled/)).toBeInTheDocument();
  });

  it("writes only the picked columns, including a hidden one", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("switch", { name: "Upload instead of download" }));
    await userEvent.click(page.getByRole("checkbox", { name: "qty" }));
    await userEvent.click(page.getByRole("checkbox", { name: "note" }));
    await userEvent.click(page.getByRole("button", { name: "Export CSV" }));
    await expect.element(page.getByText(/Id,Name,Price,Note/), { timeout: 4000 }).toBeInTheDocument();
  });

  it("loads the sample file with title rows and shows the received rejected cells", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true, pressed: false }));
    await userEvent.click(page.getByRole("switch", { name: /Clean the rows/ }));
    await userEvent.click(page.getByRole("switch", { name: /Read “EUR 12,50”/ }));
    await userEvent.click(page.getByRole("button", { name: "Load sample file" }));
    await expect.element(page.getByText("Showing 4 of 4 rows")).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));
    await expect.element(page.getByText("onImport got 3 rows from orders.csv")).toBeInTheDocument();
    await expect.element(page.getByText(/rejected: row 3, column qty: Qty cannot be negative/)).toBeInTheDocument();
    await vi.waitFor(() => expect([...document.querySelectorAll('[role="gridcell"]')].filter((cell) => /^12\.5(0)?$/.test(cell.textContent?.trim() ?? "")).length).toBe(2));
  });

  it("keeps a cancelled upload cancelled and ignores a second export click", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("switch", { name: "Upload instead of download" }));
    await userEvent.click(page.getByRole("button", { name: "Export CSV" }));
    await expect.element(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    await userEvent.click(page.getByRole("button", { name: "Cancel upload" }));
    await expect.element(page.getByText(/^Upload cancelled/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(document.body.textContent).not.toMatch(/Uploaded: orders/);
  });

  it("writes typed numbers to xlsx through output", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("switch", { name: "Upload instead of download" }));
    await userEvent.click(page.getByRole("switch", { name: "Typed numbers" }));
    await userEvent.click(page.getByRole("button", { name: "Export XLSX" }));
    await expect.element(page.getByText(/^Uploaded: orders\.xlsx/), { timeout: 4000 }).toBeInTheDocument();
  });

  it("leaves the Name column out of a reviewed plan", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("button", { name: "Replace", exact: true }));
    await userEvent.click(page.getByRole("switch", { name: /Review the plan first/ }));
    await userEvent.click(page.getByRole("switch", { name: /Leave the Name column alone/ }));
    await userEvent.click(page.getByRole("button", { name: "Open find and replace" }));
    await userEvent.keyboard("Pen");
    await userEvent.click(page.getByRole("textbox", { name: "Replace with" }));
    await userEvent.keyboard("Marker");
    await userEvent.click(page.getByRole("button", { name: "Replace all" }));
    await expect.element(page.getByText("Plan: 0 cells")).toBeInTheDocument();
  });

  it("shows the server error in the dialog and in onImportError", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true, pressed: false }));
    await userEvent.click(page.getByRole("switch", { name: /Server fails/ }));
    await userEvent.click(page.getByRole("button", { name: "Load sample file" }));
    await expect.element(page.getByText(/Showing \d+ of \d+ rows/)).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Import", exact: true }));
    await expect.element(page.getByText("The import failed: 409 Conflict: order B-1 already exists")).toBeInTheDocument();
    await expect.element(page.getByText("onImportError: 409 Conflict: order B-1 already exists")).toBeInTheDocument();
  });

  it("holds a replace until the plan is applied, and a cancel writes nothing", async () => {
    await render(<DataGridIOHooksDemo />);
    await userEvent.click(page.getByRole("button", { name: "Replace", exact: true }));
    await userEvent.click(page.getByRole("switch", { name: /Review the plan first/ }));
    await userEvent.click(page.getByRole("button", { name: "Open find and replace" }));
    await userEvent.keyboard("Pen");
    await userEvent.click(page.getByRole("textbox", { name: "Replace with" }));
    await userEvent.keyboard("Marker");
    await userEvent.click(page.getByRole("button", { name: "Replace all" }));
    await expect.element(page.getByText("Plan: 1 cells")).toBeInTheDocument();
    await expect.element(page.getByText("A-3 · name → Marker set")).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Cancel", exact: true }));
    await expect.element(page.getByText("Replace cancelled")).toBeInTheDocument();
    await expect.element(page.getByText("Pen set")).toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Replace all" }));
    await userEvent.click(page.getByRole("button", { name: "Apply" }));
    await expect.element(page.getByText("Marker set")).toBeInTheDocument();
  });
});
