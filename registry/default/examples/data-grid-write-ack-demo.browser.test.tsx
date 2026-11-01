import { page, userEvent } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridWriteAckDemo from "./data-grid-write-ack-demo";
import "@/app/global.css";

describe("data-grid-write-ack-demo", () => {
  it("marks the row saving, then reverts a refused name and reports the message", async () => {
    await render(<DataGridWriteAckDemo />);
    await page.getByText("Person 0", { exact: true }).dblClick();
    await userEvent.keyboard("{Control>}a{/Control}Al{Enter}");
    await expect.poll(() => document.querySelector('[data-save-status="saving"]')).not.toBeNull();
    await expect.element(page.getByText('"Al" is too short'), { timeout: 4000 }).toBeInTheDocument();
    await expect.element(page.getByText("Person 0", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("All changes saved")).toBeInTheDocument();
  });
});
