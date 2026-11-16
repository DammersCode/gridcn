import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridColumnDragDemo from "./data-grid-column-drag-demo";
import "@/app/global.css";

describe("data-grid-column-drag-demo", () => {
  it("disables Left next to a column that cannot move and keeps Right enabled", async () => {
    await render(<DataGridColumnDragDemo />);
    await expect.element(page.getByRole("button", { name: "Left" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Right" })).toBeEnabled();
  });
});
