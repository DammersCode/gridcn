import { userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import DataGridServerFilterDemo from "./data-grid-server-filter-demo";
import "@/app/global.css";

const popup = () => document.querySelector<HTMLElement>(gridAttrSelector("headerFilterPopup"));
const option = (label: string) => [...document.querySelectorAll<HTMLElement>(`${gridAttrSelector("headerFilterPopup")} [role="option"]`)].find((o) => o.textContent?.startsWith(label));

describe("data-grid-server-filter-demo", () => {
  it("lists the server's values, applies one, and shrinks the total to the matching rows", async () => {
    await render(<DataGridServerFilterDemo />);
    await vi.waitFor(() => expect(document.body.textContent).toContain("1,000 rows match"));
    await userEvent.click(document.querySelector<HTMLElement>(`[data-column-id="role"] ${gridAttrSelector("headerFilterTrigger")}`)!);
    await vi.waitFor(() => expect(option("Admin")).toBeTruthy());
    await userEvent.click(option("Admin")!);
    await userEvent.click([...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Apply")!);
    await vi.waitFor(() => expect(document.body.textContent).not.toContain("1,000 rows match"));
    expect(document.body.textContent).toMatch(/(^|\D)\d{2,3} rows match/);
    await vi.waitFor(() => expect([...document.querySelectorAll('[role="row"]')].some((row) => row.textContent?.includes("Admin"))).toBe(true));
  });
});
