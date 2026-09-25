import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridStreamingDemo from "./data-grid-streaming-demo";
import "@/app/global.css";

const SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOG", "META", "TSLA", "AMD", "INTC", "NFLX"];

/** Finds the demo's own grid among any others the harness may have mounted. */
function demoGrid(): HTMLElement {
  const grids = Array.from(document.querySelectorAll<HTMLElement>("[role='grid']"));
  const grid = grids.find((g) => g.textContent?.includes("Symbol") && g.textContent?.includes("Volume"));
  if (!grid) throw new Error("streaming demo grid not mounted");
  return grid;
}

/** The symbol column's cell text in current row order, top to bottom (only rows in the virtualized window). */
function symbolOrder(): string[] {
  const cells = Array.from(demoGrid().querySelectorAll<HTMLElement>("[role='gridcell']"));
  return cells.filter((c) => SYMBOLS.includes(c.textContent?.trim() ?? "")).map((c) => c.textContent!.trim());
}

describe("data-grid-streaming-demo", () => {
  it("streams new values into cells while the feed runs", { timeout: 30_000 }, async () => {
    await render(<DataGridStreamingDemo />);
    await new Promise((r) => setTimeout(r, 400));
    const before = demoGrid().textContent;
    await new Promise((r) => setTimeout(r, 900));
    expect(demoGrid().textContent).not.toBe(before);
  });

  it("holds row position and offers a re-sort once sorted on the streaming column", { timeout: 30_000 }, async () => {
    await render(<DataGridStreamingDemo />);
    await new Promise((r) => setTimeout(r, 400));

    const header = Array.from(demoGrid().querySelectorAll<HTMLElement>("[role='columnheader']")).find((h) =>
      h.textContent?.includes("Change"),
    );
    expect(header).toBeDefined();
    header!.click();

    // the feed keeps writing the sorted column, so the deferred-reorder affordance must appear.
    await new Promise((r) => setTimeout(r, 1200));
    const reSort = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Re-sort");
    expect(reSort).toBeDefined();

    // Paused, so no deferred batch can raise the flag again before the assertion.
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Pause feed")!.click();
    reSort!.click();
    await new Promise((r) => setTimeout(r, 100));
    // reconcileView cleared the flag; it reappears only after the next deferred batch.
    expect(document.body.textContent).not.toContain("New values changed the sort order.");
  });

  it("re-sorts automatically on each tick once auto-sort is on, and hides the re-sort button", { timeout: 30_000 }, async () => {
    await render(<DataGridStreamingDemo />);
    await new Promise((r) => setTimeout(r, 400));

    const header = Array.from(demoGrid().querySelectorAll<HTMLElement>("[role='columnheader']")).find((h) =>
      h.textContent?.includes("Change"),
    );
    header!.click();

    const toggle = document.querySelector<HTMLElement>("[role='switch']");
    expect(toggle).toBeDefined();
    toggle!.click();

    let sawReorder = false;
    let order = symbolOrder();
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const next = symbolOrder();
      if (next.join(",") !== order.join(",")) sawReorder = true;
      order = next;
      // auto-sort keeps the view current; the re-sort affordance must never appear.
      expect(document.body.textContent).not.toContain("New values changed the sort order.");
    }
    expect(sawReorder).toBe(true);
  });
});
