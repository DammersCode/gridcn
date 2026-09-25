import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { PreviewTabs } from "@/components/preview-tabs";
import DataGridDemo from "@/registry/default/examples/data-grid-demo";

// A preview wider than its panel must stay reachable: centering an overflowing flex child pushes
// its left edge to a negative offset that scrolling can never reach (docs/fill-handle, 2026-08-03).
it("an overflowing preview is not clipped on its left edge", async () => {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "http://localhost:3000/_next/static/chunks/%5Broot-of-the-server%5D__1b05wu7._.css";
  await new Promise((r) => { link.onload = r; link.onerror = r; document.head.appendChild(link); });

  const host = document.createElement("div");
  host.style.width = "700px";
  document.body.appendChild(host);
  await render(<PreviewTabs preview={<DataGridDemo />} code={<pre>code</pre>} align="center" />, { container: host });
  await new Promise((r) => setTimeout(r, 600));

  const panel = document.querySelector('[class*="overflow-x-auto"]') as HTMLElement;
  const grid = document.querySelector('[role="grid"]') as HTMLElement;
  const panelBox = panel.getBoundingClientRect();
  const gridBox = grid.getBoundingClientRect();

  // the grid's left edge must sit at or right of the panel's content box, never before it
  expect(gridBox.left).toBeGreaterThanOrEqual(panelBox.left - 1);
});
