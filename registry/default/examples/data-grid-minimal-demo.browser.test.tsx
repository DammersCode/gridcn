import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridMinimalDemo from "./data-grid-minimal-demo";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

function gridCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

describe("data-grid-minimal-demo (defaultData, zero app state)", () => {
  it("editing a cell sticks — the grid owns the array with no data/onDataChange prop", async () => {
    await render(<DataGridMinimalDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cell = gridCells()[0]!; // "name" column, first row
    await userEvent.click(cell); // activates only
    await userEvent.keyboard("Ada L."); // printable key: type-to-replace opens the editor seeded with it
    await userEvent.keyboard("{Enter}");

    await expect.element(page.getByText("Ada L.")).toBeInTheDocument();
  });
});
