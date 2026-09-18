import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridPlaygroundDemo from "./data-grid-playground-demo";
// real stylesheet so Tailwind's `grid`/`overflow-auto` actually apply
import "@/app/global.css";

const LAZY_TOTAL_COUNT = 5_000;

/** Mirrors the demo's `lazyRowAt` name field, so expectations read as the server's own order. */
function nameAt(index: number): string {
  return `Person ${index}`;
}

function firstColumnTexts(count: number): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="row"] [role="gridcell"]:first-child'))
    .slice(0, count)
    .map((cell) => cell.textContent ?? "");
}

function serverSortText(): string {
  return document.querySelector<HTMLElement>('[data-testid="lazy-server-sort"]')?.textContent ?? "";
}

/** Re-queried per click: a sort change remounts the lazy subtree, so any held header node is stale. */
function clickNameHeader(): void {
  document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="name"]')!.click();
}

/** Selects `option` in the Nth control-bar select (0 = Mode, 2 = Header click). Options portal out, so both are queried from the document. */
async function chooseInSelect(index: number, option: string): Promise<void> {
  const combos = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"]'));
  await userEvent.click(combos[index]!);
  await new Promise((r) => setTimeout(r, 200));
  const target = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.textContent === option);
  await userEvent.click(target!);
  await new Promise((r) => setTimeout(r, 200));
}

/** The lazy fetch is latency-simulated (300ms); give it room plus a paint. */
async function settle(ms = 900): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
  await new Promise((r) => requestAnimationFrame(r));
}

describe("playground: lazy + sort is server-side", () => {
  it("sorting in lazy mode reorders from the server, not by re-sorting the loaded window", async () => {
    render(<DataGridPlaygroundDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await chooseInSelect(0, "lazy");
    await chooseInSelect(2, "sort");
    await settle();

    // unsorted: the server serves rows in index order, so the window starts at index 0.
    expect(firstColumnTexts(3)).toEqual([nameAt(0), nameAt(1), nameAt(2)]);
    expect(serverSortText()).toBe("Server sort: none");

    clickNameHeader();
    await settle();
    expect(serverSortText()).toBe("Server sort: name:asc");

    clickNameHeader();
    await settle();
    expect(serverSortText()).toBe("Server sort: name:desc");

    // The decisive assertion: the server sorts all 5k rows by name descending (numeric-aware) and
    // serves the first window of THAT order. A client-side re-sort could only reorder the rows it
    // had already fetched — the low indices — and would show Person 79, 78, ... here instead.
    expect(firstColumnTexts(3)).toEqual([
      nameAt(LAZY_TOTAL_COUNT - 1),
      nameAt(LAZY_TOTAL_COUNT - 2),
      nameAt(LAZY_TOTAL_COUNT - 3),
    ]);

    // third click completes the asc -> desc -> none cycle and returns the server to index order.
    clickNameHeader();
    await settle();
    expect(serverSortText()).toBe("Server sort: none");
    expect(firstColumnTexts(3)).toEqual([nameAt(0), nameAt(1), nameAt(2)]);
  });
});
