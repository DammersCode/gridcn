import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridServerSelectionDemo from "./data-grid-server-selection-demo";
import "@/app/global.css";

describe("data-grid-server-selection-demo", () => {
  it("keeps a check across pages and reports it", async () => {
    await render(<DataGridServerSelectionDemo />);
    await page.getByRole("checkbox", { name: /row 1/i }).first().click();
    await expect.element(page.getByText("1 checked")).toBeInTheDocument();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("1 checked")).toBeInTheDocument();
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect.element(page.getByText("1 checked")).toBeInTheDocument();
  });

  it("select all matching counts the whole result and excludes an unchecked row", async () => {
    await render(<DataGridServerSelectionDemo />);
    await page.getByRole("checkbox", { name: /select all/i }).first().click();
    await page.getByRole("button", { name: "Select all 237 matching" }).click();
    await expect.element(page.getByText("all matching, 237 rows")).toBeInTheDocument();
    await page.getByRole("checkbox", { name: /row 1/i }).first().click();
    await expect.element(page.getByText("all matching, 236 rows")).toBeInTheDocument();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("all matching, 236 rows")).toBeInTheDocument();
  });
});
