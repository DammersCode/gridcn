import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import DataGridLazySwrDemo from "./data-grid-lazy-swr-demo";
import "@/app/global.css";

const fetchingVisible = () => [...document.querySelectorAll("span")].some((span) => span.textContent === " · fetching…" && !span.classList.contains("invisible"));

describe("data-grid-lazy-swr-demo", () => {
  it("loads a block after a remount that aborted its first request", async () => {
    const first = await render(<DataGridLazySwrDemo />);
    await vi.waitFor(() => expect(fetchingVisible()).toBe(true));
    await first.unmount();
    await render(<DataGridLazySwrDemo />);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Person 0"), { timeout: 3000 });
  });
});
