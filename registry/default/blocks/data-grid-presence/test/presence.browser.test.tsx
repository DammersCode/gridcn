import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot, gridAttrSelector } from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPresence } from "../data-grid-presence";
import type { PresenceHighlight } from "../data-grid-presence";
// real stylesheet so Tailwind's `grid`/color-mix()/CSS vars actually apply — paint placement is unverifiable without real layout
import "@/app/global.css";

type Row = { id: string; name: string; email: string; age: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Person ${i}`,
    email: `person${i}@example.com`,
    age: 18 + (i % 60),
  }));
}

function makeColumns(count: number, opts?: { lastPinnedRight?: boolean; firstPinnedLeft?: boolean }) {
  const cols = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    header: `Col ${i}`,
    accessorFn: (r: Row) => (r.age * 31 + i) % 1000,
    type: "number" as const,
    width: 100,
  }));
  if (opts?.firstPinnedLeft) (cols[0] as { pin?: "left" | "right" }).pin = "left";
  if (opts?.lastPinnedRight) (cols[cols.length - 1] as { pin?: "left" | "right" }).pin = "right";
  return cols;
}

async function renderEngine(opts: {
  columns: ReturnType<typeof makeColumns>;
  rowCount?: number;
  width?: number;
  height?: number;
}) {
  let setPresenceHighlights!: (h: PresenceHighlight[]) => void;

  function Harness() {
    const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
    setPresenceHighlights = setHighlights;
    return (
      <DataGridProvider data={makeRows(opts.rowCount ?? 200)} columns={opts.columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
        <DataGridRoot className={`h-[${opts.height ?? 300}px] w-[${opts.width ?? 400}px]`}>
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    );
  }

  const utils = await render(
    <div style={{ height: opts.height ?? 300, width: opts.width ?? 400 }}>
      <Harness />
    </div>,
  );
  return { ...utils, setPresenceHighlights: (h: PresenceHighlight[]) => setPresenceHighlights(h) };
}

describe("multiplayer presence — paint placement", () => {
  it("paints a fill+border overlay at the highlight's cell, colored via --presence-color", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(3), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    setPresenceHighlights([
      { id: "u1", color: "rgb(255, 0, 0)", range: { x: 0, y: 2, width: 1, height: 1 }, label: "Ada" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    const overlay = document.querySelector<HTMLElement>(gridAttrSelector("presenceOverlay"))!;
    expect(overlay).not.toBeNull();
    expect(getComputedStyle(overlay).getPropertyValue("--presence-color").trim()).toBe("rgb(255, 0, 0)");

    const cell = [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')].find(
      (c) => c.getAttribute("aria-colindex") === "1" && c.closest('[role="row"]') === document.querySelectorAll('[role="row"]')[3],
    )!;
    const overlayRect = overlay.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    expect(Math.abs(overlayRect.left - cellRect.left)).toBeLessThan(1);
    expect(Math.abs(overlayRect.top - cellRect.top)).toBeLessThan(1);
  });

  it("splits a highlight spanning a pinned-left column + unpinned columns into 2 segments, pinned segment staying flush with the pinned cell", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(6, { firstPinnedLeft: true }), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    setPresenceHighlights([{ id: "u1", color: "rgb(0, 128, 0)", range: { x: 0, y: 1, width: 2, height: 1 } }]);
    await new Promise((r) => setTimeout(r, 50));

    const overlays = [...document.querySelectorAll<HTMLElement>(gridAttrSelector("presenceOverlay"))];
    expect(overlays.length).toBe(2);
    const pinnedOverlay = overlays.find((el) => el.dataset["pinned"] !== undefined)!;
    expect(pinnedOverlay).toBeDefined();

    const pinnedCell = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const cellRect = pinnedCell.getBoundingClientRect();
    let overlayRect = pinnedOverlay.getBoundingClientRect();
    expect(Math.abs(overlayRect.left - cellRect.left)).toBeLessThan(1);

    // scroll — the pinned segment must stay put (counter-offset, not track position).
    grid.scrollLeft = 300;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    const pinnedCellAfter = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    const pinnedOverlayAfter = document.querySelector<HTMLElement>(gridAttrSelector("presenceOverlay") + gridAttrSelector("pinned"))!;
    overlayRect = pinnedOverlayAfter.getBoundingClientRect();
    expect(Math.abs(overlayRect.left - pinnedCellAfter.getBoundingClientRect().left)).toBeLessThan(1);
  });

  it("paints below the local active-cell ring (local focus wins) — ring renders after presence in DOM order", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(3), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const firstCell = grid.querySelector<HTMLElement>('[role="gridcell"]')!;
    await userEvent.click(firstCell);
    setPresenceHighlights([{ id: "u1", color: "rgb(255,0,0)", range: { x: 0, y: 2, width: 1, height: 1 } }]);
    await new Promise((r) => setTimeout(r, 50));

    const overlaysContainer = document.querySelector('[role="grid"]')!;
    const presence = overlaysContainer.querySelector(gridAttrSelector("presenceOverlay"))!;
    const ring = overlaysContainer.querySelector(gridAttrSelector("activeCellOverlay"))!;
    // DOM order proxy for paint order (later siblings paint on top of earlier ones at equal stacking context).
    expect(presence.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("multiplayer presence — window-edge clamping", () => {
  it("clamps a highlight range to the currently rendered row window instead of overflowing it", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(2), rowCount: 200, height: 300 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // a range far larger than the rendered window (rows 0..198 of 200) — virtualization only
    // mounts a small windowed subset + overscan, so the overlay must stop at the LAST actually
    // rendered row, not paint down to row 198's would-be (unrendered) position.
    setPresenceHighlights([{ id: "u1", color: "rgb(0,0,255)", range: { x: 0, y: 0, width: 1, height: 199 } }]);
    await new Promise((r) => setTimeout(r, 50));

    const overlay = document.querySelector<HTMLElement>(gridAttrSelector("presenceOverlay"))!;
    const renderedRows = [...document.querySelectorAll('[role="row"]')].filter((r) => r.getAttribute("aria-rowindex"));
    const lastRenderedRow = renderedRows[renderedRows.length - 1] as HTMLElement;

    const overlayRect = overlay.getBoundingClientRect();
    const lastRowRect = lastRenderedRow.getBoundingClientRect();
    // clamped overlay's bottom edge lines up with the last rendered row's bottom, not somewhere
    // far below it (which unclamped math against the full 199-row range would produce).
    expect(Math.abs(overlayRect.bottom - lastRowRect.bottom)).toBeLessThan(1);
  });

  it("renders nothing when the highlight range falls entirely outside the rendered window", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(2), rowCount: 200, height: 200 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    setPresenceHighlights([{ id: "u1", color: "rgb(0,0,255)", range: { x: 0, y: 150, width: 1, height: 1 } }]);
    await new Promise((r) => setTimeout(r, 50));

    expect(document.querySelector(gridAttrSelector("presenceOverlay"))).toBeNull();
  });
});

describe("multiplayer presence — label chip visibility", () => {
  it("shows the label chip when the range's top-left corner is on-window", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(2), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    setPresenceHighlights([{ id: "u1", color: "rgb(255,0,0)", range: { x: 0, y: 1, width: 1, height: 1 }, label: "Ada" }]);
    await new Promise((r) => setTimeout(r, 50));

    const chip = document.querySelector(gridAttrSelector("presenceLabel"));
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("Ada");
  });

  it("hides the label chip once the top-left corner scrolls out of the rendered window", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(2), rowCount: 200, height: 200 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;

    // range starts at row 0 (visible) but extends far past the window — top-left corner is on-window.
    setPresenceHighlights([{ id: "u1", color: "rgb(255,0,0)", range: { x: 0, y: 0, width: 1, height: 1 }, label: "Ada" }]);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector(gridAttrSelector("presenceLabel"))).not.toBeNull();

    // scroll row 0 out of view — the corner no longer survives the clamp, chip must disappear.
    grid.scrollTop = 3000;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 100));

    expect(document.querySelector(gridAttrSelector("presenceLabel"))).toBeNull();
  });

  it("omits the chip entirely when the highlight has no label", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(2), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    setPresenceHighlights([{ id: "u1", color: "rgb(255,0,0)", range: { x: 0, y: 1, width: 1, height: 1 } }]);
    await new Promise((r) => setTimeout(r, 50));

    expect(document.querySelector(gridAttrSelector("presenceOverlay"))).not.toBeNull();
    expect(document.querySelector(gridAttrSelector("presenceLabel"))).toBeNull();
  });
});

describe("multiplayer presence — overlapping highlights", () => {
  it("renders both highlights when two users' ranges overlap, each with its own color", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(3), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    setPresenceHighlights([
      { id: "u1", color: "rgb(255, 0, 0)", range: { x: 0, y: 1, width: 2, height: 2 }, label: "Ada" },
      { id: "u2", color: "rgb(0, 0, 255)", range: { x: 1, y: 2, width: 2, height: 2 }, label: "Grace" },
    ]);
    await new Promise((r) => setTimeout(r, 50));

    const overlays = [...document.querySelectorAll<HTMLElement>(gridAttrSelector("presenceOverlay"))];
    expect(overlays.length).toBe(2);
    const colors = overlays.map((el) => getComputedStyle(el).getPropertyValue("--presence-color").trim());
    expect(colors).toContain("rgb(255, 0, 0)");
    expect(colors).toContain("rgb(0, 0, 255)");

    const labels = [...document.querySelectorAll(gridAttrSelector("presenceLabel"))].map((el) => el.textContent);
    expect(labels.sort()).toEqual(["Ada", "Grace"]);
  });

  it("all presence overlays and chips are aria-hidden and pointer-events-none", async () => {
    const { setPresenceHighlights } = await renderEngine({ columns: makeColumns(3), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    setPresenceHighlights([{ id: "u1", color: "rgb(255,0,0)", range: { x: 0, y: 1, width: 1, height: 1 }, label: "Ada" }]);
    await new Promise((r) => setTimeout(r, 50));

    const nodes = [...document.querySelectorAll<HTMLElement>(`${gridAttrSelector("presenceOverlay")}, ${gridAttrSelector("presenceLabel")}`)];
    expect(nodes.length).toBeGreaterThan(0);
    nodes.forEach((el) => {
      expect(el.getAttribute("aria-hidden")).toBe("true");
      expect(el.className).toContain("pointer-events-none");
    });
  });
});
