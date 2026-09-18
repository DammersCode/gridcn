import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridEventsDemo from "./data-grid-events-demo";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

function gridCells(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="gridcell"]'));
}

/** Finds the FIRST (most recent, list is newest-first) inspector entry whose source label matches, and parses its <pre> JSON payload. */
function latestPayloadFor(source: string): unknown {
  const items = Array.from(document.querySelectorAll("li"));
  const match = items.find((li) => li.querySelector("span")?.textContent === source);
  const pre = match?.querySelector("pre");
  return JSON.parse(pre?.textContent ?? "null");
}

describe("data-grid-events-demo", () => {
  it("clicking a cell logs an onSelectionChange entry with the clicked coord", async () => {
    render(<DataGridEventsDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cell = gridCells()[0]!;
    await userEvent.click(cell);

    await expect.element(page.getByText("onSelectionChange")).toBeInTheDocument();
    const payload = latestPayloadFor("onSelectionChange") as {
      cell: unknown;
      values: { rows: unknown[][]; truncated: boolean };
    };
    expect(payload.cell).toEqual({ col: 0, row: 0 });
    // details.getValues() over the single-cell range: one row, one column, the Name cell's value.
    expect(payload.values.rows).toEqual([[expect.any(String)]]);
    expect(payload.values.truncated).toBe(false);
  });

  it("editing a cell logs an onDataChange entry with the edit's DataChange shape", async () => {
    render(<DataGridEventsDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cell = gridCells()[0]!;
    await userEvent.click(cell); // activates only
    await userEvent.keyboard("Ada Lovelace"); // printable key: type-to-replace opens the editor seeded with it
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByText("onDataChange")).toBeInTheDocument();
    const payload = latestPayloadFor("onDataChange") as { source: string; ops: { cells: { value: string }[] }[] };
    expect(payload.source).toBe("edit");
    expect(payload.ops[0]!.cells[0]!.value).toBe("Ada Lovelace");
  });

  it("the presence read-back button logs a setPresenceHighlights (read-back) entry", async () => {
    render(<DataGridEventsDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await page.getByRole("button", { name: "Simulate presence highlight" }).click();

    await expect.element(page.getByText("setPresenceHighlights (read-back)")).toBeInTheDocument();
  });
});
