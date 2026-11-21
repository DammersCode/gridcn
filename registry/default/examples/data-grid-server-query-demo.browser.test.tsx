import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import DataGridServerQueryDemo from "./data-grid-server-query-demo";
import "@/app/global.css";

const popup = () => document.querySelector<HTMLElement>(gridAttrSelector("headerFilterPopup"));
const options = () => [...document.querySelectorAll<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"]`)];
const cellText = (columnId: string) => document.querySelector(`[role="gridcell"][data-column-id="${columnId}"]`)?.textContent ?? "";

describe("data-grid-server-query-demo", () => {
  it("loads the car sales of the database with a date, a customer, and a region on each row", async () => {
    await render(<DataGridServerQueryDemo />);
    await vi.waitFor(() => expect(document.body.textContent).toContain("5,000 rows match"), { timeout: 20_000 });
    await vi.waitFor(() => expect(cellText("soldOn")).toContain("2025"));
    expect(["North", "South", "East", "West"]).toContain(cellText("region"));
    expect(cellText("customer")).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(document.body.textContent).toContain("car_sales");
  });

  it("filters the sales of one day through the header filter of the date column", async () => {
    await render(<DataGridServerQueryDemo />);
    await vi.waitFor(() => expect(document.body.textContent).toContain("5,000 rows match"), { timeout: 20_000 });
    await userEvent.click(document.querySelector<HTMLElement>(`[data-column-id="soldOn"] ${gridAttrSelector("headerFilterTrigger")}`)!);
    await vi.waitFor(() => expect(options().length).toBeGreaterThan(0));
    await userEvent.click(options()[0]!);
    await userEvent.click([...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Apply")!);
    await vi.waitFor(() => expect(document.body.textContent).toMatch(/(^|\D)\d{1,2} rows match/));
  });
});
