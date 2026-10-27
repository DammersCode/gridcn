import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridAnnouncementsDemo from "./data-grid-announcements-demo";
import { gridAttrSelector } from "../blocks/data-grid/data-grid-sdk";
import "@/app/global.css";

describe("data-grid-announcements-demo", () => {
  it("mirrors the live region text on the page", async () => {
    await render(<DataGridAnnouncementsDemo />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await expect.element(page.getByText("none yet")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    document.querySelector<HTMLElement>(`[role="row"]${gridAttrSelector("rowIndex")} [role="gridcell"]:not(${gridAttrSelector("markerCell")})`)!.click();
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    grid.dispatchEvent(new KeyboardEvent("keydown", { key: " ", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await expect.poll(() => document.querySelector("p span.font-medium")?.textContent, { timeout: 2000 }).toBe("1 row checked");
  });
});
