import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import LazyDemo from "@/registry/default/examples/data-grid-lazy-demo";
import OpenEndedDemo from "@/registry/default/examples/data-grid-open-ended-demo";
import ServerFilterDemo from "@/registry/default/examples/data-grid-server-filter-demo";

// The suffix toggles `visibility`, not presence: removing it re-wraps the status line on narrow previews and shifts the grid.
const DEMOS = [
  ["lazy", <LazyDemo key="lazy" />],
  ["open-ended", <OpenEndedDemo key="open-ended" />],
  ["server-filter", <ServerFilterDemo key="server-filter" />],
] as const;

describe("demo status line above the grid", () => {
  it.each(DEMOS)("%s demo keeps the fetching suffix in the layout", async (_name, demo) => {
    const screen = await render(demo);
    const hasSuffix = () => [...screen.container.querySelectorAll("span")].some((el) => el.textContent?.includes("fetching…"));
    const end = performance.now() + 1500;
    while (performance.now() < end) {
      expect(hasSuffix()).toBe(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
});
