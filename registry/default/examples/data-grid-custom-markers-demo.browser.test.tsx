import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid";
import DataGridCustomMarkersDemo from "./data-grid-custom-markers-demo";
import "@/app/global.css";

/** Finds the demo's own grid among any others the harness may have mounted. */
function demoGrid(): HTMLElement {
  const grids = Array.from(document.querySelectorAll<HTMLElement>("[role='grid']"));
  const grid = grids.find((g) => g.textContent?.includes("Score"));
  if (!grid) throw new Error("custom-markers demo grid not mounted");
  return grid;
}

describe("data-grid-custom-markers-demo", () => {
  it("marker states follow the channels, and the custom select-all toggles the rows channel", { timeout: 30_000 }, async () => {
    render(<DataGridCustomMarkersDemo />);
    await new Promise((r) => setTimeout(r, 400));

    const grid = demoGrid();
    const markerCells = () => Array.from(grid.querySelectorAll<HTMLElement>(gridAttrSelector("markerCell")));
    const dataCells = () => Array.from(grid.querySelectorAll<HTMLElement>(`[role='gridcell']:not(${gridAttrSelector("markerCell")})`));
    const header = () => grid.querySelector<HTMLElement>("[data-testid='custom-marker-header']")!;
    expect(header()).not.toBeNull();

    // nothing selected: every marker shows the circle, the header button the list icon, not pressed.
    expect(markerCells().every((c) => c.querySelector("svg.lucide-circle") !== null)).toBe(true);
    expect(header()).toHaveAttribute("aria-pressed", "false");
    expect(header()).toHaveAttribute("aria-label", "Select all rows");
    expect(header().querySelector("svg.lucide-list")).not.toBeNull();
    expect(header().querySelector("svg.lucide-list-checks")).toBeNull();

    // press row 0's marker: its marker flips to the check, the header goes indeterminate.
    await userEvent.click(markerCells()[0]!);
    await new Promise((r) => setTimeout(r, 150));
    expect(markerCells()[0]!.querySelector("svg.lucide-check")).not.toBeNull();
    expect(markerCells()[0]!.querySelector("svg.lucide-circle")).toBeNull();
    expect(markerCells()[1]!.querySelector("svg.lucide-circle")).not.toBeNull();
    expect(header().querySelector("svg.lucide-list-minus")).not.toBeNull();
    expect(header()).toHaveAttribute("aria-pressed", "false");

    // a plain cell click selects the cell and CLEARS the rows channel (selectCell semantics):
    // row 1's marker shows the minus, row 0 falls back to the circle, header back to unchecked.
    await userEvent.click(dataCells()[2]!);
    await new Promise((r) => setTimeout(r, 150));
    expect(markerCells()[1]!.querySelector("svg.lucide-minus")).not.toBeNull();
    expect(markerCells()[0]!.querySelector("svg.lucide-circle")).not.toBeNull();
    expect(header()).toHaveAttribute("aria-pressed", "false");

    // the custom select-all selects every row: all markers check, pressed + list-checks icon.
    await userEvent.click(header());
    await new Promise((r) => setTimeout(r, 150));
    expect(markerCells().every((c) => c.querySelector("svg.lucide-check") !== null)).toBe(true);
    expect(header()).toHaveAttribute("aria-pressed", "true");
    expect(header()).toHaveAttribute("aria-label", "Unselect all rows");
    expect(header().querySelector("svg.lucide-list-checks")).not.toBeNull();

    // press row 0's marker again: a plain marker press collapses the channel to JUST that row
    // (toggle semantics), so row 0 keeps its check and every other row falls back to the circle.
    await userEvent.click(markerCells()[0]!);
    await new Promise((r) => setTimeout(r, 150));
    expect(markerCells()[0]!.querySelector("svg.lucide-check")).not.toBeNull();
    expect(markerCells()[1]!.querySelector("svg.lucide-circle")).not.toBeNull();
    expect(header().querySelector("svg.lucide-list-minus")).not.toBeNull();
    expect(header()).toHaveAttribute("aria-pressed", "false");

    // press it a third time: row 0 is now the sole member, so the plain press toggles it off.
    await userEvent.click(markerCells()[0]!);
    await new Promise((r) => setTimeout(r, 150));
    expect(markerCells()[0]!.querySelector("svg.lucide-circle")).not.toBeNull();
    expect(header().querySelector("svg.lucide-list")).not.toBeNull();
    expect(header()).toHaveAttribute("aria-pressed", "false");

    // the custom control's own toggle: select-all on, then off through the same button.
    await userEvent.click(header());
    await new Promise((r) => setTimeout(r, 150));
    expect(markerCells().every((c) => c.querySelector("svg.lucide-check") !== null)).toBe(true);
    expect(header()).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(header());
    await new Promise((r) => setTimeout(r, 150));
    expect(markerCells().every((c) => c.querySelector("svg.lucide-circle") !== null)).toBe(true);
    expect(header()).toHaveAttribute("aria-pressed", "false");
    expect(header()).toHaveAttribute("aria-label", "Select all rows");
  });
});
