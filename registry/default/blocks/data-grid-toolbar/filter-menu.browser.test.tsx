import axe from "axe-core";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridFilterMenu } from "./filter-menu";
import "@/app/global.css";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", filter: { operators: [{ id: "inRegion", label: "In region" }, "contains"] } },
];

afterEach(() => {
  document.body.innerHTML = "";
});

async function newRowOperatorText(filterMode: "client" | "server") {
  await render(
    <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id} filterMode={filterMode}>
      <DataGridFilterMenu />
    </DataGridProvider>,
  );
  await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
  const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add filter"));
  await userEvent.click(add!);
  return document.querySelector<HTMLElement>('[data-grid-filter-row] [aria-label*="perator" i]')?.textContent ?? "";
}

describe("DataGridFilterMenu custom operators", () => {
  it("starts a new row on an operator that can narrow rows under client filtering", async () => {
    expect(await newRowOperatorText("client")).not.toContain("In region");
  });

  it("starts a new row on the first declared custom operator under server filtering", async () => {
    expect(await newRowOperatorText("server")).toContain("In region");
  });
});

describe("DataGridFilterMenu row grouping", () => {
  async function openWithOneRow() {
    await render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
        <DataGridFilterMenu />
      </DataGridProvider>,
    );
    await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add filter"));
    await userEvent.click(add!);
  }

  it("keeps field, operator, value and remove in one group and the drag handle outside it", async () => {
    await openWithOneRow();
    const segments = document.querySelector<HTMLElement>("[data-grid-filter-segments]")!;
    expect(segments.getAttribute("data-slot")).toBe("button-group");
    expect(segments.querySelector('[aria-label="Filter column"]')).not.toBeNull();
    expect(segments.querySelector('[aria-label="Filter operator"]')).not.toBeNull();
    expect(segments.querySelector("[data-grid-filter-value]")).not.toBeNull();
    expect(segments.querySelector('[aria-label="Remove filter"]')).not.toBeNull();
    expect(segments.querySelector('[aria-label="Reorder filter"]')).toBeNull();
    expect(document.querySelector('[data-grid-filter-row] > [aria-label="Reorder filter"]')).not.toBeNull();
  });

  it("tabs through column, operator, value, remove, then the drag handle", async () => {
    await openWithOneRow();
    const column = document.querySelector<HTMLElement>('[aria-label="Filter column"]')!;
    column.focus();
    const order: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      order.push(document.activeElement?.getAttribute("aria-label") ?? null);
    }
    expect(order[0]).toBe("Filter operator");
    expect(order[2]).toBe("Remove filter");
    expect(order[3]).toBe("Reorder filter");
  });

  it("has no axe violations and does not overflow at a narrow viewport", async () => {
    await openWithOneRow();
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
    const popover = document.querySelector<HTMLElement>("[data-grid-filter-menu]")!.parentElement!;
    expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
  });
});

describe("DataGridFilterMenu row alignment", () => {
  it("keeps segment edges, the join column and the drag handle at the same x on every row", async () => {
    await render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
        <DataGridFilterMenu />
      </DataGridProvider>,
    );
    await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
    const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Add filter"));
    await userEvent.click(add!);
    await userEvent.click(add!);
    const edges = (row: Element) =>
      ['[aria-label="Filter column"]', '[aria-label="Filter operator"]', "[data-grid-filter-value]", '[aria-label="Remove filter"]', '[aria-label="Reorder filter"]', "[data-grid-filter-segments]"].map((selector) => {
        const rect = row.querySelector(selector)!.getBoundingClientRect();
        return [Math.round(rect.left), Math.round(rect.right)];
      });
    const [first, second] = [...document.querySelectorAll("[data-grid-filter-row]")];
    expect(edges(second!)).toEqual(edges(first!));
  });
});
