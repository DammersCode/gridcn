import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridServerSideDemo from "./data-grid-server-side-demo";
import "@/app/global.css";

describe("data-grid-server-side-demo", () => {
  it("loads page 1 from the server, then page 2 on Next", async () => {
    await render(<DataGridServerSideDemo />);
    await expect.element(page.getByText("Page 1 of 40 · 1000 rows on the server"), { timeout: 4000 }).toBeInTheDocument();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("Page 2 of 40 · 1000 rows on the server"), { timeout: 4000 }).toBeInTheDocument();
  });

  it("a header click sorts on the server and returns to page 1", async () => {
    await render(<DataGridServerSideDemo />);
    await expect.element(page.getByText("Page 1 of 40", { exact: false }), { timeout: 4000 }).toBeInTheDocument();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("Page 2 of 40", { exact: false }), { timeout: 4000 }).toBeInTheDocument();
    await page.getByRole("columnheader", { name: /Name/ }).click();
    await expect.element(page.getByText("Page 1 of 40", { exact: false }), { timeout: 4000 }).toBeInTheDocument();
  });
});
