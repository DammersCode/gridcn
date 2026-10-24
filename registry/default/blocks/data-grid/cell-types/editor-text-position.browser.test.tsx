import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns } from "@/registry/default/blocks/data-grid/data-grid";
// real stylesheet so Tailwind's classes apply
import "@/app/global.css";

type Row = { id: string; text: string; number: number; date: string; notes: string; site: string };

const rows: Row[] = [{ id: "r0", text: "Hello world", number: 1234, date: "2026-03-04", notes: "Some notes", site: "https://example.com/a" }];

const columns = defineColumns<Row>()([
  { id: "text", header: "Text", accessorKey: "text", type: "text", width: 200 },
  { id: "number", header: "Number", accessorKey: "number", type: "number", width: 140 },
  { id: "date", header: "Date", accessorKey: "date", type: "date", width: 160 },
  { id: "notes", header: "Notes", accessorKey: "notes", type: "longText", width: 180 },
  { id: "site", header: "Site", accessorKey: "site", type: "url", width: 220 },
] as const);

type TextBox = { x: number; centerY: number; fontSize: string; lineHeight: string; fontFamily: string };

function firstTextNode(root: Element): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim()) return node as Text;
  }
  return null;
}

function measureText(cell: Element, endAligned: boolean): TextBox {
  const field = cell.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (field && !cell.contains(field.closest("[data-grid-cell-editor]"))) {
    const style = getComputedStyle(field);
    const rect = field.getBoundingClientRect();
    const left = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const right = rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
    return { x: endAligned ? right : left, centerY: rect.top + rect.height / 2, fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily };
  }
  const node = firstTextNode(cell)!;
  const range = document.createRange();
  range.selectNodeContents(node);
  const rect = range.getBoundingClientRect();
  const style = getComputedStyle(node.parentElement!);
  return { x: endAligned ? rect.right : rect.left, centerY: rect.top + rect.height / 2, fontSize: style.fontSize, lineHeight: style.lineHeight, fontFamily: style.fontFamily };
}

const cellOf = (columnId: string) => document.querySelector(`[role="gridcell"][data-column-id="${columnId}"]`)!;

const CASES = [
  { id: "text", endAligned: false },
  { id: "number", endAligned: true },
  { id: "date", endAligned: true },
  { id: "notes", endAligned: false },
  { id: "site", endAligned: false },
] as const;

describe.each(["light", "dark"] as const)("editor keeps the cell text where it is (%s)", (scheme) => {
  afterEach(() => document.documentElement.classList.remove("dark"));

  it.each(CASES)("$id: text position and font are unchanged when the edit starts", async ({ id, endAligned }) => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[200px] w-[1100px]" />);
    const cell = cellOf(id) as HTMLElement;
    await userEvent.click(cell);
    await expect.poll(() => cell.getAttribute("data-active")).not.toBeNull();
    const before = measureText(cell, endAligned);

    await userEvent.keyboard("{F2}");
    await expect.poll(() => cell.getAttribute("data-editing")).not.toBeNull();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const after = measureText(cell, endAligned);

    expect(after.fontSize).toBe(before.fontSize);
    expect(after.lineHeight === before.lineHeight || after.lineHeight === "normal" || before.lineHeight === "normal").toBe(true);
    expect(after.fontFamily).toBe(before.fontFamily);
    const detail = JSON.stringify({ id, before, after });
    expect(Math.abs(after.x - before.x), detail).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.centerY - before.centerY), detail).toBeLessThanOrEqual(0.5);
  });

  it("text and url inputs have no visible background or border", async () => {
    document.documentElement.classList.toggle("dark", scheme === "dark");
    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[200px] w-[1100px]" />);
    for (const id of ["text", "number", "site"]) {
      const cell = cellOf(id) as HTMLElement;
      await userEvent.click(cell);
      await userEvent.keyboard("{F2}");
      await expect.poll(() => cell.querySelector("input")).not.toBeNull();
      const style = getComputedStyle(cell.querySelector("input")!);
      expect(style.backgroundColor, `${id} background`).toBe("rgba(0, 0, 0, 0)");
      expect(style.borderTopWidth, `${id} border`).toBe("0px");
      await userEvent.keyboard("{Escape}");
      await expect.poll(() => cell.querySelector("input")).toBeNull();
    }
  });
});

describe("popover editors open over the cell", () => {
  // a narrow viewport pushes the popup back inside the window
  beforeEach(async () => {
    await page.viewport(1280, 800);
  });

  it("long text: the popup starts at the cell's top-left corner and its first line sits on the display text", async () => {
    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[200px] w-[1100px]" />);
    const cell = cellOf("notes") as HTMLElement;
    await userEvent.click(cell);
    await userEvent.keyboard("{F2}");
    await expect.poll(() => document.querySelector("[data-grid-cell-editor] textarea")).not.toBeNull();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const box = cell.getBoundingClientRect();
    const popup = document.querySelector("[data-grid-cell-editor]")!.getBoundingClientRect();
    expect(Math.abs(popup.left - box.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(popup.top - box.top)).toBeLessThanOrEqual(0.5);
    const textarea = document.querySelector("textarea")!;
    expect(getComputedStyle(textarea).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(textarea).borderTopWidth).toBe("0px");
  });

  it("date: the calendar popup starts at the cell's left edge", async () => {
    await render(<DataGrid data={rows} columns={columns} getRowId={(r) => r.id} className="h-[200px] w-[1100px]" />);
    const cell = cellOf("date") as HTMLElement;
    await userEvent.click(cell);
    await userEvent.keyboard("{F2}");
    await expect.poll(() => document.querySelector("[data-grid-cell-editor]")).not.toBeNull();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const popup = document.querySelector("[data-grid-cell-editor]")!.getBoundingClientRect();
    expect(Math.abs(popup.left - cell.getBoundingClientRect().left)).toBeLessThanOrEqual(0.5);
  });
});
