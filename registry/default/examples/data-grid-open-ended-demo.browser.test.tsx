import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import DataGridOpenEndedDemo from "./data-grid-open-ended-demo";
import "@/app/global.css";

function scrollGridToEnd(): void {
  for (const el of document.querySelectorAll<HTMLElement>("*")) {
    if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== "visible") el.scrollTop = el.scrollHeight;
  }
}

describe("data-grid-open-ended-demo", () => {
  it("loads the first page, then a further page after scrolling to the end", async () => {
    await render(<DataGridOpenEndedDemo />);
    await expect.element(page.getByText("50 rows so far, more available")).toBeInTheDocument();
    scrollGridToEnd();
    await expect
      .poll(() => Number(/(\d+) rows so far/.exec(document.body.textContent ?? "")?.[1] ?? 0), { timeout: 5000 })
      .toBeGreaterThan(50);
  });

  it("the pages tab keeps Next enabled while the server has more and shows no total", async () => {
    await render(<DataGridOpenEndedDemo />);
    await page.getByRole("button", { name: "Pages without a total" }).click();
    await expect.element(page.getByText("Page 1")).toBeInTheDocument();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect.element(page.getByText("Page 2")).toBeInTheDocument();
  });
});
