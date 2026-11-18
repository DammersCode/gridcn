import axe from "axe-core";
import { userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridProvider, type ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridFilterMenu } from "./filter-menu";
import "@/app/global.css";

type Row = { id: string; name: string };
const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", filter: { operators: [{ id: "inRegion", label: "In region" }, "contains"] } },
];

async function newRowOperatorText(filterMode: "client" | "server") {
  await render(
    <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id} filterMode={filterMode}>
      <DataGridFilterMenu />
    </DataGridProvider>,
  );
  await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
  const add = document.querySelector<HTMLButtonElement>('button[aria-label="Add filter"]');
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

describe("DataGridFilterMenu custom operator list", () => {
  async function operatorOptions(filterMode: "client" | "server") {
    await newRowOperatorText(filterMode);
    await userEvent.click(document.querySelector<HTMLElement>('[data-grid-filter-row] [aria-label="Filter operator"]')!);
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent ?? "");
  }

  it("hides a custom operator from the operator list under client filtering", async () => {
    const options = await operatorOptions("client");
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((text) => text.includes("In region"))).toBe(false);
  });

  it("lists a custom operator under server filtering", async () => {
    const options = await operatorOptions("server");
    expect(options.some((text) => text.includes("In region"))).toBe(true);
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
    const add = document.querySelector<HTMLButtonElement>('button[aria-label="Add filter"]');
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
    const add = document.querySelector<HTMLButtonElement>('button[aria-label="Add filter"]');
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

describe("DataGridFilterMenu group header summary", () => {
  it("states the group join on the left and keeps the icon group inside the box", async () => {
    await render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
        <DataGridFilterMenu />
      </DataGridProvider>,
    );
    await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
    expect(document.querySelector("[data-grid-filter-group-summary]")).toBeNull();
    await userEvent.click(document.querySelector<HTMLElement>('[data-grid-filter-menu] button[aria-label="Add group"]')!);
    const summary = document.querySelector<HTMLElement>("[data-grid-filter-group-summary]")!;
    expect(summary.textContent).toBe("Any of the following are true…");
    const header = document.querySelector<HTMLElement>("[data-grid-filter-group-header]")!;
    const box = header.closest("[data-grid-filter-group]")!.getBoundingClientRect();
    expect(summary.getBoundingClientRect().right).toBeLessThanOrEqual(header.getBoundingClientRect().left);
    expect(header.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("DataGridFilterMenu group Not toggle", () => {
  const notToggle = () => document.querySelector<HTMLButtonElement>('[data-grid-filter-group-header] button[aria-label="Negate the filter group"]')!;
  const summary = () => document.querySelector<HTMLElement>("[data-grid-filter-group-summary]")!.textContent;

  it("negates the group, follows the summary, and reports aria-pressed", async () => {
    await render(
      <DataGridProvider data={[]} columns={columns} getRowId={(r) => r.id}>
        <DataGridFilterMenu />
      </DataGridProvider>,
    );
    await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
    await userEvent.click(document.querySelector<HTMLElement>('[data-grid-filter-menu] button[aria-label="Add group"]')!);
    expect(notToggle().getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(notToggle());
    expect(notToggle().getAttribute("aria-pressed")).toBe("true");
    expect(summary()).toBe("None of the following are true…");
    await userEvent.click(notToggle());
    expect(notToggle().getAttribute("aria-pressed")).toBe("false");
    expect(summary()).toBe("Any of the following are true…");
  });

  it("reads a negated and group as not all, and renders custom labels", async () => {
    await render(
      <DataGridProvider
        data={[]}
        columns={columns}
        getRowId={(r) => r.id}
        defaultFilterState={[{ join: "and", not: true, filters: [{ columnId: "name", operator: "contains", value: "a" }] }]}
        labels={{ toolbar: { filterGroupNot: "Nicht", filterGroupNotAriaLabel: "Gruppe verneinen" } }}
      >
        <DataGridFilterMenu />
      </DataGridProvider>,
    );
    await userEvent.click(document.querySelector<HTMLElement>('button[aria-label="Filters"]')!);
    expect(summary()).toBe("Not all of the following are true…");
    const toggle = document.querySelector<HTMLButtonElement>('[data-grid-filter-group-header] button[aria-label="Gruppe verneinen"]')!;
    expect(toggle.textContent).toBe("Nicht");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
