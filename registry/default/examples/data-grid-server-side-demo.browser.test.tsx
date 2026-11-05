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

  it("scroll mode sizes the grid from the server count and loads the first block", async () => {
    await render(<DataGridServerSideDemo />);
    await page.getByRole("button", { name: "Scroll" }).click();
    await expect.element(page.getByText(/1000 rows on the server · \d+ not loaded yet/), { timeout: 4000 }).toBeInTheDocument();
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    expect(document.querySelector('[aria-label="Next page"]')).toBeNull();
  });

  it("marks a pushed row stale and places it after the reshape", async () => {
    await render(<DataGridServerSideDemo />);
    await expect.element(page.getByText("Page 1 of 40", { exact: false }), { timeout: 4000 }).toBeInTheDocument();
    await page.getByRole("combobox", { name: "Reshape delay" }).click();
    await page.getByRole("option", { name: "Reshape: 1 s" }).click();
    await page.getByText("Server pushes", { exact: true }).click();
    const stale = () => document.querySelectorAll('[role="row"][data-row-stale]').length;
    await expect.poll(stale, { timeout: 4000 }).toBeGreaterThan(0);
    await page.getByText("Server pushes", { exact: true }).click();
    await expect.poll(stale, { timeout: 6000 }).toBe(0);
    const scores = [...document.querySelectorAll("[data-grid-row-index]")].map((row) => Number(row.lastElementChild?.textContent));
    expect(scores.length).toBeGreaterThan(2);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("keeps a stale row marked without a reshape delay", async () => {
    await render(<DataGridServerSideDemo />);
    await expect.element(page.getByText("Page 1 of 40", { exact: false }), { timeout: 4000 }).toBeInTheDocument();
    await page.getByText("Server pushes", { exact: true }).click();
    await expect.poll(() => document.querySelectorAll('[role="row"][data-row-stale]').length, { timeout: 4000 }).toBeGreaterThan(0);
    await page.getByText("Server pushes", { exact: true }).click();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(document.querySelectorAll('[role="row"][data-row-stale]').length).toBeGreaterThan(0);
  });

  it("removes a row the server deleted", async () => {
    await render(<DataGridServerSideDemo />);
    await expect.element(page.getByText("Page 1 of 40", { exact: false }), { timeout: 4000 }).toBeInTheDocument();
    const firstRow = () => document.querySelector('[data-grid-row-index="0"]')?.textContent;
    const before = firstRow();
    await page.getByRole("button", { name: "Delete on server" }).click();
    await expect.poll(firstRow, { timeout: 4000 }).not.toBe(before);
  });
});
