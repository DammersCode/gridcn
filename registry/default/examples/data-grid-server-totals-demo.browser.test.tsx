import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { generateSales } from "./sales-data";
import DataGridServerTotalsDemo from "./data-grid-server-totals-demo";
import "@/app/global.css";

describe("data-grid-server-totals-demo", () => {
  it("shows the total revenue of every sale in the pinned band", async () => {
    await render(<DataGridServerTotalsDemo />);
    const revenue = generateSales(1000).reduce((sum, sale) => sum + sale.price, 0);
    await expect.element(page.getByText("Total revenue"), { timeout: 4000 }).toBeInTheDocument();
    await expect.poll(() => document.body.textContent?.replace(/\D/g, "").includes(String(revenue)), { timeout: 4000 }).toBe(true);
  });
});
