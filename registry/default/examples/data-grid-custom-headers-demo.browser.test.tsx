import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid";
import DataGridCustomHeadersDemo from "./data-grid-custom-headers-demo";
import "@/app/global.css";

/** Finds the demo's own grid among any others the harness may have mounted. */
function demoGrid(): HTMLElement {
  const grids = Array.from(document.querySelectorAll<HTMLElement>("[role='grid']"));
  const grid = grids.find((g) => g.textContent?.includes("Email"));
  if (!grid) throw new Error("custom-headers demo grid not mounted");
  return grid;
}

function headerByLabel(grid: HTMLElement, label: string): HTMLElement {
  const header = Array.from(grid.querySelectorAll<HTMLElement>("[role='columnheader']")).find((h) =>
    h.textContent?.includes(label),
  );
  if (!header) throw new Error(`${label} header not found`);
  return header;
}

/** The name column is the first (unmarked) cell of every row: pick every third gridcell. */
function nameOrder(grid: HTMLElement): string[] {
  const cells = Array.from(grid.querySelectorAll<HTMLElement>("[role='gridcell']"));
  return cells.filter((_, i) => i % 3 === 0).map((c) => c.textContent?.trim() ?? "");
}

describe("data-grid-custom-headers-demo", () => {
  it("clicking a header sorts, and the custom header icons cycle minus -> asc -> desc", { timeout: 30_000 }, async () => {
    await render(<DataGridCustomHeadersDemo />);
    await new Promise((r) => setTimeout(r, 400));

    const grid = demoGrid();
    const name = headerByLabel(grid, "Name");
    const score = headerByLabel(grid, "Score");
    // unsorted: both custom headers show the muted minus, and no built-in indicator (custom headers own their display)
    expect(name.querySelector("svg.lucide-minus")).not.toBeNull();
    expect(name.querySelector("svg.lucide-arrow-up")).toBeNull();
    expect(name.querySelector("svg.lucide-arrow-down")).toBeNull();
    expect(name.querySelector(gridAttrSelector("sortIndicator"))).toBeNull();
    expect(score.querySelector("svg.lucide-minus")).not.toBeNull();
    expect(score.querySelector("svg.lucide-trending-up")).toBeNull();
    expect(score.querySelector("svg.lucide-trending-down")).toBeNull();

    const initialOrder = nameOrder(grid);

    // asc: the up arrow icon appears and the rows reorder to name order.
    await userEvent.click(name);
    await new Promise((r) => setTimeout(r, 200));
    expect(name).toHaveAttribute("aria-sort", "ascending");
    expect(name.querySelector("svg.lucide-arrow-up")).not.toBeNull();
    expect(name.querySelector("svg.lucide-arrow-down")).toBeNull();
    expect(name.querySelector("svg.lucide-minus")).toBeNull();
    const ascOrder = nameOrder(grid);
    expect(ascOrder).toEqual([...ascOrder].sort((a, b) => a.localeCompare(b)));

    // desc: the down arrow icon appears, the visible rows are in descending name order.
    await userEvent.click(name);
    await new Promise((r) => setTimeout(r, 200));
    expect(name).toHaveAttribute("aria-sort", "descending");
    expect(name.querySelector("svg.lucide-arrow-down")).not.toBeNull();
    expect(name.querySelector("svg.lucide-arrow-up")).toBeNull();
    const descOrder = nameOrder(grid);
    expect(descOrder).toEqual([...descOrder].sort((a, b) => b.localeCompare(a)));
    expect(descOrder.join(",")).not.toBe(ascOrder.join(","));

    // none: the minus returns and the original data order is restored.
    await userEvent.click(name);
    await new Promise((r) => setTimeout(r, 200));
    expect(name).toHaveAttribute("aria-sort", "none");
    expect(name.querySelector("svg.lucide-minus")).not.toBeNull();
    expect(name.querySelector("svg.lucide-arrow-up")).toBeNull();
    expect(name.querySelector("svg.lucide-arrow-down")).toBeNull();
    expect(nameOrder(grid)).toEqual(initialOrder);

    // the Score column cycles its own trending icons (up, down).
    await userEvent.click(score);
    await new Promise((r) => setTimeout(r, 200));
    expect(score.querySelector("svg.lucide-trending-up")).not.toBeNull();
    expect(score.querySelector("svg.lucide-trending-down")).toBeNull();
    await userEvent.click(score);
    await new Promise((r) => setTimeout(r, 200));
    expect(score.querySelector("svg.lucide-trending-down")).not.toBeNull();
    expect(score.querySelector("svg.lucide-trending-up")).toBeNull();

    // the plain string header keeps the built-in indicator (the rule's other side).
    const email = headerByLabel(grid, "Email");
    await userEvent.click(email);
    await new Promise((r) => setTimeout(r, 200));
    expect(email.querySelector(gridAttrSelector("sortIndicator"))).not.toBeNull();
  });
});
