import type { ReactNode } from "react";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { UrlUpdateEvent } from "nuqs/adapters/testing";
import DataGridUrlStateDemo from "./data-grid-url-state-demo";
import { generateDemoRows } from "./demo-data";
import "@/app/global.css";

const urlUpdates = vi.hoisted(() => [] as UrlUpdateEvent[]);

// The demo ships nuqs' app-router adapter; the testing adapter runs the same hooks without a Next.js router.
vi.mock("nuqs/adapters/next/app", async () => {
  const { NuqsTestingAdapter } = await import("nuqs/adapters/testing");
  const { createElement } = await import("react");
  return {
    NuqsAdapter: ({ children }: { children: ReactNode }) =>
      createElement(NuqsTestingAdapter, { searchParams: "", hasMemory: true, onUrlUpdate: (event: UrlUpdateEvent) => urlUpdates.push(event), children }),
  };
});

const shownScores = () =>
  [...document.querySelectorAll<HTMLElement>('[role="gridcell"][data-column-id="score"]')]
    .sort((a, b) => Number(a.closest('[role="row"]')?.getAttribute("aria-rowindex")) - Number(b.closest('[role="row"]')?.getAttribute("aria-rowindex")))
    .map((cell) => Number(cell.textContent));

describe("data-grid-url-state-demo", () => {
  it("pages the whole array: a sort orders all 60 rows, and a page change writes the URL", async () => {
    const scores = generateDemoRows(60).map((row) => row.score);
    expect(Math.min(...scores)).toBeLessThan(Math.min(...scores.slice(0, 10)));

    await render(<DataGridUrlStateDemo />);
    await expect.element(page.getByText("1–10 of 60")).toBeInTheDocument();
    await vi.waitFor(() => expect(shownScores().length).toBeGreaterThan(0));

    await userEvent.click(document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="score"]')!);
    await vi.waitFor(() => expect(shownScores()[0]).toBe(Math.min(...scores)));

    await page.getByRole("button", { name: "Go to page 2" }).click();
    await expect.element(page.getByText("11–20 of 60")).toBeInTheDocument();
    await vi.waitFor(() => expect(urlUpdates.at(-1)?.searchParams.get("demo_page")).toBe("2"));
    const sorted = [...scores].sort((a, b) => a - b);
    const shown = shownScores();
    expect(shown).toEqual(sorted.slice(10, 10 + shown.length));
  });
});
