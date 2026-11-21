import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridServerGroupingDemo from "./data-grid-server-grouping-demo";
import "@/app/global.css";

const groupRows = () => [...document.querySelectorAll<HTMLElement>("[data-grid-group-row]")];
const level = (depth: number) => groupRows().filter((row) => row.getAttribute("aria-level") === String(depth));
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;

describe("data-grid-server-grouping-demo", () => {
  it("shows the regions of the database, loads the rows of an open group, and shows the group statement", async () => {
    await render(<DataGridServerGroupingDemo />);
    await vi.waitFor(() => expect(groupRows()).toHaveLength(4), { timeout: 20_000 });
    const labels = groupRows().map((row) => row.querySelector("[data-grid-group-label]")!.textContent).join(" ");
    for (const region of ["North", "South", "East", "West"]) expect(labels).toContain(region);

    await userEvent.click(groupRows()[0]!.querySelector("button")!);
    await vi.waitFor(() => expect(groupRows()[0]!.getAttribute("aria-expanded")).toBe("true"));
    await vi.waitFor(() => expect(document.querySelectorAll('[role="row"]').length).toBeGreaterThan(groupRows().length + 2));

    await userEvent.click(button("Group by region, then dealership"));
    await vi.waitFor(() => expect(level(1)).toHaveLength(4));
    if (level(2).length === 0) await userEvent.click(level(1)[0]!.querySelector("button")!);
    await vi.waitFor(() => expect(level(2)).toHaveLength(2));

    await userEvent.click(button("Ungroup"));
    await vi.waitFor(() => expect(groupRows()).toHaveLength(0));
  });
});
