import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridFilterMenu } from "./filter-menu";
import "@/app/global.css";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [{ id: "name", header: "Name", accessorKey: "name" }];

async function openWithRowAndGroup() {
  await render(
    <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
      <DataGridFilterMenu />
    </DataGridProvider>,
  );
  await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
  await userEvent.click(document.querySelector<HTMLElement>('[data-grid-filter-menu] button[aria-label="Add filter"]')!);
  await userEvent.click(document.querySelector<HTMLElement>('[data-grid-filter-menu] button[aria-label="Add group"]')!);
  await userEvent.click(document.querySelector<HTMLElement>("[data-grid-filter-group-header] button[aria-label='Add filter']")!);
}

const menu = () => document.querySelector<HTMLElement>("[data-grid-filter-menu]")!;
const rect = (element: Element) => element.getBoundingClientRect();
const focusables = () => [...menu().querySelectorAll<HTMLElement>("button:not([disabled]), input, [role='combobox']")].filter((el) => el.tabIndex >= 0 && rect(el).width > 0);

afterEach(async () => {
  document.documentElement.style.removeProperty("--radius");
  document.documentElement.classList.remove("dark");
  await page.viewport(414, 896);
});

describe("filter menu at a narrow viewport", () => {
  it("keeps every control inside the popover and tabs in visual order", async () => {
    await page.viewport(375, 800);
    await openWithRowAndGroup();
    const popover = rect(menu().parentElement!);
    for (const control of focusables()) {
      const box = rect(control);
      expect(box.left).toBeGreaterThanOrEqual(popover.left - 1);
      expect(box.right).toBeLessThanOrEqual(popover.right + 1);
    }
    for (const row of menu().querySelectorAll("[data-grid-filter-segments]")) {
      const controls = [...row.querySelectorAll<HTMLElement>("button, input, [role='combobox']")].filter((el) => el.tabIndex >= 0);
      const visual = [...controls].sort((a, b) => Math.round(rect(a).top / 8) - Math.round(rect(b).top / 8) || rect(a).left - rect(b).left);
      expect(controls.map((c) => c.getAttribute("aria-label"))).toEqual(visual.map((c) => c.getAttribute("aria-label")));
    }
  });
});

const radii = (element: Element) => {
  const style = getComputedStyle(element);
  return { startStart: parseFloat(style.borderStartStartRadius), endEnd: parseFloat(style.borderEndEndRadius), startEnd: parseFloat(style.borderStartEndRadius), endStart: parseFloat(style.borderEndStartRadius) };
};
const control = (label: string) => menu().querySelector<HTMLElement>(`[data-grid-filter-row] [aria-label="${label}"]`)!;

describe("filter menu under presets", () => {
  it.each(["0", "1rem"])("keeps the joints square and the outer corners on the radius at --radius %s", async (radius) => {
    await page.viewport(800, 800);
    document.documentElement.style.setProperty("--radius", radius);
    await openWithRowAndGroup();
    const column = radii(control("Filter column"));
    const operator = radii(control("Filter operator"));
    const remove = radii(control("Remove filter"));
    expect(column.startEnd).toBe(0);
    expect(operator.startStart).toBe(0);
    expect(operator.startEnd).toBe(0);
    expect(remove.startStart).toBe(0);
    if (radius === "0") expect([column.startStart, remove.endEnd]).toEqual([0, 0]);
    else expect(Math.min(column.startStart, remove.endEnd)).toBeGreaterThan(0);
    const popover = rect(menu().parentElement!);
    expect(menu().parentElement!.scrollWidth).toBeLessThanOrEqual(menu().parentElement!.clientWidth);
    for (const el of focusables()) expect(rect(el).right).toBeLessThanOrEqual(popover.right + 1);
  });

  it("rounds the wrapped corners at a narrow viewport with --radius 1rem", async () => {
    await page.viewport(375, 800);
    document.documentElement.style.setProperty("--radius", "1rem");
    await openWithRowAndGroup();
    const operator = radii(control("Filter operator"));
    const value = radii(menu().querySelector<HTMLElement>("[data-grid-filter-row] [data-grid-filter-value] input")!);
    const remove = radii(control("Remove filter"));
    expect(operator.startEnd).toBeGreaterThan(0);
    expect(operator.endEnd).toBe(0);
    expect(value.endStart).toBeGreaterThan(0);
    expect(remove.startEnd).toBe(0);
    expect(remove.endEnd).toBeGreaterThan(0);
  });

  it("paints the segments from the dark tokens", async () => {
    await page.viewport(800, 800);
    document.documentElement.classList.add("dark");
    await openWithRowAndGroup();
    const probe = document.body.appendChild(document.createElement("div"));
    probe.className = "bg-muted";
    const muted = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const operator = getComputedStyle(control("Filter operator"));
    expect(operator.backgroundColor).toBe(muted);
    expect(operator.borderTopColor).not.toBe(operator.backgroundColor);
    expect(getComputedStyle(menu().querySelector("[data-grid-filter-group] > div:nth-child(2)")!).borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  });
});
