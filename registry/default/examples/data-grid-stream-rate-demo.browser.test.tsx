import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridStreamRateDemo from "./data-grid-stream-rate-demo";
import "@/app/global.css";

const stat = (name: string) => document.querySelector(`[data-stat="${name}"]`)?.textContent ?? "";
const gridText = () => document.querySelector("[role='grid']")?.textContent ?? "";

describe("data-grid-stream-rate-demo", () => {
  it("applies buffered updates in at most one grid call per frame", { timeout: 30_000 }, async () => {
    await render(<DataGridStreamRateDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await page.getByRole("combobox", { name: "Updates per second" }).click();
    await page.getByRole("option", { name: "1,000 per second" }).click();
    const before = gridText();

    await expect.poll(() => stat("calls"), { timeout: 8000 }).not.toBe("—");
    await expect.poll(() => Number(stat("applied")), { timeout: 8000 }).toBeGreaterThan(0);

    const calls = Number(stat("calls"));
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(Number(stat("fps")));
    expect(gridText()).not.toBe(before);
  });

  it("stops applying updates while paused", { timeout: 30_000 }, async () => {
    await render(<DataGridStreamRateDemo />);
    await expect.poll(() => stat("calls"), { timeout: 8000 }).not.toBe("—");
    await page.getByRole("button", { name: "Pause" }).click();
    const frozen = gridText();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(gridText()).toBe(frozen);
    await expect.element(page.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });
});
