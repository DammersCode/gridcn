import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridRowGroupingDemo from "./data-grid-row-grouping-demo";
import "@/app/global.css";

const groupRows = () => [...document.querySelectorAll<HTMLElement>("[data-grid-group-row]")];
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name)!;

describe("data-grid-row-grouping-demo", () => {
  it("shows one group row per role, opens a group with Enter, and regroups by two columns", async () => {
    await render(<DataGridRowGroupingDemo />);
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(document.querySelector('[role="treegrid"]')).toBeTruthy();
    expect(groupRows().every((row) => row.getAttribute("aria-expanded") === "false")).toBe(true);

    await userEvent.click(button("Expand all"));
    await vi.waitFor(() => expect(groupRows().every((row) => row.getAttribute("aria-expanded") === "true")).toBe(true));

    await userEvent.click(button("Collapse all"));
    const first = groupRows()[0]!;
    first.focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(groupRows()[0]!.getAttribute("aria-expanded")).toBe("true"));

    await userEvent.click(button("Group by role, then active"));
    await vi.waitFor(() => expect(groupRows().some((row) => row.getAttribute("aria-level") === "2")).toBe(true));
    await userEvent.click(button("Ungroup"));
    await vi.waitFor(() => expect(groupRows()).toHaveLength(0));
  });

  it("shows the average age with at most two fraction digits", async () => {
    await render(<DataGridRowGroupingDemo />);
    await vi.waitFor(() => expect(groupRows()).toHaveLength(5));
    const ages = groupRows().map((row) => row.querySelector('[data-column-id="age"]')!.textContent!);
    expect(ages.every((text) => /^\d+(\.\d{1,2})?$/.test(text))).toBe(true);
  });
});
