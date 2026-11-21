import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridServerQueryDemo from "./data-grid-server-query-demo";
import "@/app/global.css";

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
});
