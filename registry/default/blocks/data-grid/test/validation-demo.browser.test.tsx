import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridValidationDemo from "../../../examples/data-grid-validation-demo";
import DataGridCellErrorsDemo from "../../../examples/data-grid-cell-errors-demo";
import { GRID_ATTR, gridAttrSelector } from "../data-grid";
// real stylesheet so Tailwind's ring/tint utilities actually apply
import "@/app/global.css";

function gridCells(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="gridcell"]'));
}

describe("data-grid-validation-demo", () => {
  it("typing an invalid Age and committing paints the aria-invalid ring + message", async () => {
    await render(<DataGridValidationDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const ageCell = document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="age"]')[0]!;
    await userEvent.dblClick(ageCell);
    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
    await userEvent.clear(input);
    await userEvent.type(input, "12");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(ageCell).toHaveAttribute("aria-invalid", "true"));
    // editor stays open on rejection: the message shows inline (role="alert"), the hover tooltip
    // only mounts on non-editing cells
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    await expect.element(page.getByRole("alert")).toBeInTheDocument();
    expect(page.getByRole("alert").element().textContent).toBe("Must be 18 or older");
    // editor stays open on rejection, not committed
    expect(ageCell).toHaveAttribute(GRID_ATTR.editing, "true");
  });
});

describe("data-grid-cell-errors-demo", () => {
  it("a committed Quantity over 100 paints the SAME ring/aria-invalid after the fake 422", async () => {
    await render(<DataGridCellErrorsDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const quantityCell = gridCells().find((c) => c.getAttribute("data-column-id") === "quantity")!;
    await userEvent.dblClick(quantityCell);
    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
    await userEvent.clear(input);
    await userEvent.type(input, "150");
    await userEvent.keyboard("{Enter}");

    // commits immediately (post-commit rejection): value shows 150 before the fake 422 lands
    await vi.waitFor(() => expect(quantityCell.textContent).toContain("150"));
    expect(quantityCell).not.toHaveAttribute("aria-invalid");

    // the error paints the tooltip mount, which remounts the cell's div — re-query the live node
    let erroredCell!: HTMLElement;
    await vi.waitFor(() => {
      erroredCell = gridCells().find((c) => c.getAttribute("data-column-id") === "quantity")!;
      expect(erroredCell).toHaveAttribute("aria-invalid", "true");
    }, { timeout: 2000 });

    await userEvent.hover(erroredCell);
    await vi.waitFor(
      () =>
        expect(document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')?.textContent).toBe(
          "Quantity cannot exceed 100",
        ),
      { timeout: 2000 },
    );
    // the summary bar is a sibling of the grid (outside `page`'s scope); read the live document and
    // assert the rejected cell is actually counted, not just that the static label exists.
    await vi.waitFor(() => expect(document.body.textContent).toContain("Server errors: 1"));
  });
});

describe("data-grid-validation-demo: onInvalid 'warn'", () => {
  function notesCells(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="notes"]'));
  }

  it("a soft rejection commits the value, closes the editor, and flags the cell with a tooltip", async () => {
    await render(<DataGridValidationDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const notesCell = notesCells()[0]!;
    await userEvent.dblClick(notesCell);
    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
    await userEvent.clear(input);
    await userEvent.type(input, "Way too long note");
    await userEvent.keyboard("{Enter}");

    // committed (unlike a blocking rejection): the value shows and the editor closed
    await vi.waitFor(() => expect(notesCells()[0]!.textContent).toContain("Way too long note"));
    expect(document.querySelector(`[role="gridcell"]${gridAttrSelector("editing", "true")}`)).toBeNull();

    let flagged!: HTMLElement;
    await vi.waitFor(() => {
      flagged = notesCells()[0]!;
      expect(flagged).toHaveAttribute("aria-invalid", "true");
    });

    await userEvent.hover(flagged);
    await vi.waitFor(
      () => expect(document.querySelector<HTMLElement>('[data-slot="tooltip-content"]')?.textContent).toBe("Max 12 characters"),
      { timeout: 2000 },
    );

    // a valid re-commit clears the flag
    await userEvent.dblClick(flagged);
    const reinput = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing", "true")} input`)!;
    await userEvent.clear(reinput);
    await userEvent.type(reinput, "Short note");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(notesCells()[0]!).not.toHaveAttribute("aria-invalid"));
  });
});
