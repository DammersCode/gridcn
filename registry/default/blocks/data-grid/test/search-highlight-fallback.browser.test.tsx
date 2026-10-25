import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, type ColumnDef } from "../data-grid";
import "@/app/global.css";

type Row = { id: string; name: string; email: string };

const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({ id: `row-${i}`, name: `Person ${i}`, email: `p${i}@example.com` }));

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", type: "text", width: 120, pin: "left" },
  { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
];

const cellOf = (columnId: string) => document.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="3"] [role="gridcell"][data-column-id="${columnId}"]`)!;
const cellAt = (rowIndex: number, columnId: string) => document.querySelector<HTMLElement>(`[role="row"][data-grid-row-index="${rowIndex}"] [role="gridcell"][data-column-id="${columnId}"]`)!;
const toRgb = (css: string, under = "white") => {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = under;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
};
const distance = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0);
const isTransparent = (color: string) => color === "rgba(0, 0, 0, 0)" || /\/\s*0(%|\s*\))/.test(color);

describe("quick-search tint without the search-highlight theme color", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.removeProperty("--search-highlight");
    document.documentElement.style.removeProperty("--color-search-highlight");
  });

  it.each([
    ["name", "pinned"],
    ["email", "scrolling"],
  ])("tints a match in the %s column (%s)", async (columnId) => {
    document.documentElement.style.setProperty("--search-highlight", "initial");
    document.documentElement.style.setProperty("--color-search-highlight", "initial");
    await render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} searchText="3">
        <DataGridRoot className="h-75 w-100">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await vi.waitFor(() => expect(cellOf(columnId)).toHaveAttribute("data-search-match"));
    expect(isTransparent(getComputedStyle(cellOf(columnId)).backgroundColor)).toBe(false);
    expect(getComputedStyle(cellOf(columnId)).backgroundColor).not.toBe(getComputedStyle(cellAt(1, columnId)).backgroundColor);
  });

  it.each(["light", "dark"])("keeps a match clearly stronger than the selection fill (%s)", async (scheme) => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    document.documentElement.style.setProperty("--search-highlight", "initial");
    document.documentElement.style.setProperty("--color-search-highlight", "initial");
    await render(
      <DataGridProvider data={rows} columns={columns} getRowId={(r) => r.id} searchText="3">
        <DataGridRoot className="h-75 w-100">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await vi.waitFor(() => expect(cellOf("email")).toHaveAttribute("data-search-match"));
    const backgroundCss = getComputedStyle(document.body).backgroundColor;
    const background = toRgb(backgroundCss);
    const probe = document.createElement("div");
    probe.style.cssText = "background: color-mix(in oklch, var(--primary) 10%, var(--background))";
    document.body.append(probe);
    const selection = distance(toRgb(getComputedStyle(probe).backgroundColor, backgroundCss), background);
    probe.remove();
    const match = distance(toRgb(getComputedStyle(cellOf("email")).backgroundColor, backgroundCss), background);
    expect(match).toBeGreaterThan(selection * 1.8);
  });
});
