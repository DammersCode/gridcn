import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render } from "vitest-browser-react";
import { DataGrid, defineColumns, gridAttrSelector } from "../data-grid";
// real stylesheet: the bug this file guards against is a CSS box-shadow painting its visible pixels
// away from the element it's attached to — invisible unless Tailwind's real cascade is loaded.
import "@/app/global.css";

type Row = { id: string; email: string };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, email: `person${i}@example.com` }));
}

/** Decodes a base64 PNG (from `page.screenshot`) into an ImageData via a real <canvas> paint — the
 * only way to read what actually landed on screen, as opposed to trusting element geometry (which
 * is exactly what let the box-shadow offset bug pass the previous position-only assertions). */
async function decodePng(base64: string): Promise<ImageData> {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`screenshot image failed to decode (base64 len=${base64.length}, head=${base64.slice(0, 40)})`));
  });
  img.src = `data:image/png;base64,${base64}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Grayscale-darkness (lower = darker) of the pixel at (x, y) in device (screenshot) pixels. */
function luma(data: ImageData, x: number, y: number): number {
  const i = (y * data.width + x) * 4;
  return 0.299 * data.data[i]! + 0.587 * data.data[i + 1]! + 0.114 * data.data[i + 2]!;
}

/** Scans a horizontal strip and returns the x (in device px) of the darkest pixel — the visible
 * center of the shadow's fade, which a box-shadow offset can displace away from the element it
 * paints from without moving the element itself (see root.tsx's pin-shadow divs). */
function darkestX(data: ImageData, y: number, xStart: number, xEnd: number): number {
  let best = xStart;
  let bestLuma = Infinity;
  for (let x = xStart; x <= xEnd; x++) {
    const l = luma(data, x, y);
    if (l < bestLuma) {
      bestLuma = l;
      best = x;
    }
  }
  return best;
}

/** Asserts the shadow's visible (painted) darkest pixel column lands within ±1 device px of
 * `edgeCss` — the actual acceptance bar for this bug (previous tests only checked the shadow
 * element's own DOMRect, which stayed exact while its box-shadow painted 4-12px away from it).
 * Screenshots the shadow's own viewport parent (not the whole page) so the image's pixel grid is
 * anchored 1:1 to that element's own top-left corner — sidesteps any mismatch between the test
 * iframe's reported `clientWidth` and what actually gets rasterized. */
async function assertShadowFlushWithEdge(shadow: HTMLElement, edgeCss: number, rowMidYCss: number) {
  const region = shadow.parentElement!;
  const regionRect = region.getBoundingClientRect();
  // `save: false` alone (no `base64` option) resolves to the string-returning overload — the raw
  // base64-encoded PNG, since nothing is written to disk.
  const base64 = await page.screenshot({ element: region, save: false });
  const image = await decodePng(base64);
  const dpr = image.width / regionRect.width;

  const y = Math.round((rowMidYCss - regionRect.top) * dpr);
  const edgeX = Math.round((edgeCss - regionRect.left) * dpr);
  const shadowRect = shadow.getBoundingClientRect();
  const scanStart = Math.max(0, Math.round((shadowRect.left - regionRect.left - 6) * dpr));
  const scanEnd = Math.min(image.width - 1, Math.round((shadowRect.right - regionRect.left + 6) * dpr));

  const darkX = darkestX(image, y, scanStart, scanEnd);
  expect(Math.abs(darkX - edgeX)).toBeLessThanOrEqual(Math.max(1, Math.round(dpr)));
}

describe("bug fix — pin-shadow paints flush against the pinned edge, not offset from it", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it.each([
    { theme: "light", setup: () => {} },
    { theme: "dark", setup: () => document.documentElement.classList.add("dark") },
  ])("in $theme mode, the left pin-shadow's darkest pixel column sits on the pinned cell's right edge", async ({ setup }) => {
    setup();
    const columns = defineColumns<Row>()([
      { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, pin: "left" },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200 },
    ] as const);
    await render(
      <div style={{ height: 300, width: 300 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-75 w-75" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollLeft = grid.scrollWidth - grid.clientWidth;
    grid.dispatchEvent(new Event("scroll"));

    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "left"))!;
    await vi.waitFor(() => expect(getComputedStyle(shadow).opacity).toBe("1"));

    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const cellRect = pinnedCell.getBoundingClientRect();
    // 2px above the row's bottom border, not vertical-center: text glyphs sit mid-row and would
    // pollute the "darkest pixel" scan with their own antialiasing, not the shadow's.
    await assertShadowFlushWithEdge(shadow, cellRect.right, cellRect.bottom - 2);
  });

  it.each([
    { theme: "light", setup: () => {} },
    { theme: "dark", setup: () => document.documentElement.classList.add("dark") },
  ])("in $theme mode, the right pin-shadow's darkest pixel column sits on the pinned cell's left edge", async ({ setup }) => {
    setup();
    const columns = defineColumns<Row>()([
      { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120 },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 200, pin: "right" },
    ] as const);
    await render(
      <div style={{ height: 300, width: 300 }}>
        <DataGrid data={makeRows(20)} columns={columns} getRowId={(r) => r.id} className="h-75 w-75" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    // scroll partway, not to the end — data-scrolled-right requires content still hidden beyond
    // the right edge (use-scrolled-edges.ts); scrolling all the way there would hide the shadow.
    grid.scrollLeft = Math.round((grid.scrollWidth - grid.clientWidth) / 2);
    grid.dispatchEvent(new Event("scroll"));

    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "right"))!;
    await vi.waitFor(() => expect(getComputedStyle(shadow).opacity).toBe("1"));

    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "right")}`)!;
    const cellRect = pinnedCell.getBoundingClientRect();
    await assertShadowFlushWithEdge(shadow, cellRect.left, cellRect.bottom - 2);
  });
});

describe("bug fix - unpinning the last pinned column does not strand the shadow at its old edge", () => {
  // usePinShadowEdges only ever WROTE --grid-pin-shadow-left-x. With a marker column present the
  // pinned-left band survives unpinning the last pinned COLUMN, so hasPinnedLeft stayed true, the
  // effect never re-ran, and the stale measurement kept the shadow floating at the unpinned
  // column's old width instead of hugging the marker.
  it("re-anchors the shadow to the marker edge after the pinned column is unpinned", async () => {
    function Harness() {
      const [pinned, setPinned] = useState(true);
      const columns = defineColumns<Row>()([
        { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, ...(pinned ? { pin: "left" as const } : {}) },
        { id: "email", header: "Email", accessorKey: "email", type: "text", width: 300 },
      ] as const);
      return (
        <div style={{ width: 320, height: 300 }}>
          <button type="button" onClick={() => setPinned(false)}>unpin</button>
          <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} rowMarkers="number" className="h-[260px]" />
        </div>
      );
    }

    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    // measured while pinned, so the stale value the bug left behind is a real one
    await vi.waitFor(() => expect(document.querySelector(`[role="columnheader"]${gridAttrSelector("pinned", "left")}`)).not.toBeNull());

    await page.getByRole("button", { name: "unpin" }).click();
    await vi.waitFor(() => expect(document.querySelector(`[role="columnheader"]${gridAttrSelector("pinned", "left")}`)).toBeNull());

    const marker = document.querySelector<HTMLElement>(gridAttrSelector("markerCell"))!;
    const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "left"))!;

    // the shadow's own left edge must land on the marker's right edge, not the ex-pinned column's
    await vi.waitFor(() => {
      const gap = shadow.getBoundingClientRect().left - marker.getBoundingClientRect().right;
      expect(Math.abs(gap), `shadow is ${gap}px from the marker edge`).toBeLessThanOrEqual(1);
    });
  });
});

describe("bug fix - the shadow re-anchors when the marker column appears or changes width", () => {
  // The ResizeObserver cannot catch this: adding a marker column MOVES the pinned header sideways
  // without resizing it or the viewport, so no observer entry ever fires. The shadow stayed at the
  // pinned column's old edge, sitting INSIDE the widened pinned band.
  it("follows the pinned edge when row markers are switched on and then widened", async () => {
    const columns = defineColumns<Row>()([
      { id: "id", header: "ID", accessorKey: "id", type: "text", width: 120, pin: "left" },
      { id: "email", header: "Email", accessorKey: "email", type: "text", width: 300 },
    ] as const);

    function Harness() {
      const [markers, setMarkers] = useState<"none" | "number" | "both">("none");
      return (
        <div style={{ width: 320, height: 300 }}>
          <button type="button" onClick={() => setMarkers("number")}>numbers</button>
          <button type="button" onClick={() => setMarkers("both")}>both</button>
          <DataGrid data={makeRows(8)} columns={columns} getRowId={(r) => r.id} rowMarkers={markers} className="h-[260px]" />
        </div>
      );
    }

    const flushAgainstPinnedEdge = async () => {
      await vi.waitFor(() => {
        const pinned = document.querySelector<HTMLElement>(`[role="columnheader"]${gridAttrSelector("pinned", "left")}`)!;
        const shadow = document.querySelector<HTMLElement>(gridAttrSelector("pinShadow", "left"))!;
        const gap = shadow.getBoundingClientRect().left - pinned.getBoundingClientRect().right;
        expect(Math.abs(gap), `shadow is ${gap}px from the pinned edge`).toBeLessThanOrEqual(1);
      });
    };

    await render(<Harness />);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await flushAgainstPinnedEdge();

    await page.getByRole("button", { name: "numbers" }).click();
    await vi.waitFor(() => expect(document.querySelector(gridAttrSelector("markerCell"))).not.toBeNull());
    await flushAgainstPinnedEdge();

    // widening the marker (number -> both adds the checkbox) moves the edge again
    await page.getByRole("button", { name: "both" }).click();
    await flushAgainstPinnedEdge();
  });
});
