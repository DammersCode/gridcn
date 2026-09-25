import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  useDataGridActions,
  gridAttrSelector,
  type GridDirection,
} from "../data-grid";
// real stylesheet so Tailwind's `grid`/`overflow-auto`/CSS vars actually apply — direction geometry is unverifiable without real layout
import "@/app/global.css";

type Row = { id: string; name: string; age: number };

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Person ${i}`,
    age: 18 + (i % 60),
  }));
}

function makeColumns(count: number, opts?: { firstPinnedLeft?: boolean; lastPinnedRight?: boolean }) {
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

function ActionsCapture({ onActions }: { onActions: (actions: ReturnType<typeof useDataGridActions>) => void }) {
  onActions(useDataGridActions());
  return null;
}

async function renderGrid(opts: {
  direction: GridDirection;
  columns: readonly Record<string, unknown>[];
  rowCount?: number;
  width?: number;
  height?: number;
}) {
  let actions!: ReturnType<typeof useDataGridActions>;
  const width = opts.width ?? 800;
  const height = opts.height ?? 500;
  const utils = await render(
    <div style={{ height, width }}>
      <DataGridProvider data={makeRows(opts.rowCount ?? 100)} columns={opts.columns as ReturnType<typeof makeColumns>} getRowId={(r) => r.id}>
        <ActionsCapture onActions={(a) => (actions = a)} />
        <DataGridRoot direction={opts.direction} className="size-full">
          <DataGridHeader />
          <DataGridBody />
        </DataGridRoot>
      </DataGridProvider>
    </div>,
  );
  return { ...utils, actions: () => actions };
}

function grid(): HTMLElement {
  return document.querySelector<HTMLElement>('[role="grid"]')!;
}

/** Scrolls to an inline-start-relative offset in whichever scrollLeft convention `direction` uses. */
async function scrollInlineTo(offset: number, direction: GridDirection): Promise<void> {
  const el = grid();
  el.scrollLeft = direction === "rtl" ? -offset : offset;
  el.dispatchEvent(new Event("scroll"));
  const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  const expected = Math.min(offset, maxLeft);
  // pinned-cell insets are `calc(var(--grid-scroll-left) + ...)`, so waiting for this var to reach
  // its post-scroll value is exactly the condition the geometry reads right after depend on.
  const viewport = el.querySelector<HTMLElement>("[style*='--grid-dir']")!;
  await vi.waitFor(() => expect(Math.round(parseFloat(viewport.style.getPropertyValue("--grid-scroll-left")))).toBe(Math.round(expected)));
}

function cellAt(colIndex: number): HTMLElement | undefined {
  const rows = document.querySelectorAll('[role="row"]');
  const firstDataRow = rows[1];
  return [...document.querySelectorAll<HTMLElement>('[role="gridcell"]')].find(
    (c) => c.closest('[role="row"]') === firstDataRow && Number(c.getAttribute("aria-colindex")) === colIndex + 1,
  );
}

/** Distance from the grid viewport's inline-start edge to a cell's inline-start edge. */
function inlineStartOf(el: HTMLElement, direction: GridDirection): number {
  const gridRect = grid().getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  return direction === "rtl" ? gridRect.right - rect.right : rect.left - gridRect.left;
}

describe("RTL — direction plumbing", () => {
  it("sets dir on the scroll root and the --grid-dir transform sign, per direction", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(10), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    expect(grid().getAttribute("dir")).toBe("rtl");
    const viewport = grid().querySelector<HTMLElement>("[style*='--grid-dir']")!;
    expect(viewport.style.getPropertyValue("--grid-dir").trim()).toBe("1");
  });

  it("keeps LTR on the unchanged default path (--grid-dir is -1)", async () => {
    await renderGrid({ direction: "ltr", columns: makeColumns(10), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    expect(grid().getAttribute("dir")).toBe("ltr");
    const viewport = grid().querySelector<HTMLElement>("[style*='--grid-dir']")!;
    expect(viewport.style.getPropertyValue("--grid-dir").trim()).toBe("-1");
  });

  it("mirrors column order: column 0 renders at the inline start in LTR", async () => {
    await renderGrid({ direction: "ltr", columns: makeColumns(10), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    expect(Math.abs(inlineStartOf(cellAt(0)!, "ltr"))).toBeLessThan(2);
  });

  it("mirrors column order: column 0 renders at the inline start (physically right) in RTL", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(10), rowCount: 20 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const first = cellAt(0)!;
    expect(Math.abs(inlineStartOf(first, "rtl"))).toBeLessThan(2);
    // column 0 at the inline start under RTL means it is at the PHYSICAL right edge
    const gridRect = grid().getBoundingClientRect();
    expect(Math.abs(first.getBoundingClientRect().right - gridRect.right)).toBeLessThan(2);
  });
});

describe("RTL — scroll geometry (the probe scenario)", () => {
  /** Inline-start offset of the pinned column at each scroll offset — the probe's measurement. */
  async function pinnedInlineOffsets(direction: GridDirection): Promise<number[]> {
    const out: number[] = [];
    for (const offset of [0, 250, 700]) {
      await scrollInlineTo(offset, direction);
      const pinned = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
      out.push(Math.round(inlineStartOf(pinned, direction)));
    }
    return out;
  }

  it("anchors a pinned-inline-start column at the viewport's inline start at every scroll offset, in LTR", async () => {
    await renderGrid({ direction: "ltr", columns: makeColumns(40, { firstPinnedLeft: true }), rowCount: 50, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const offsets = await pinnedInlineOffsets("ltr");
    expect(offsets.every((v) => Math.abs(v) < 2)).toBe(true);
  });

  it("anchors it identically in RTL — same inline geometry, measured in inline-start space", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(40, { firstPinnedLeft: true }), rowCount: 50, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const offsets = await pinnedInlineOffsets("rtl");
    expect(offsets.every((v) => Math.abs(v) < 2)).toBe(true);
  });

  it("keeps a pinned-inline-end column flush with the viewport's inline end while scrolling under RTL", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(40, { lastPinnedRight: true }), rowCount: 50, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    for (const offset of [0, 400, 1200]) {
      await scrollInlineTo(offset, "rtl");
      const pinned = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "right")}`)!;
      const gridRect = grid().getBoundingClientRect();
      // inline end under RTL is the physical LEFT edge
      expect(Math.abs(pinned.getBoundingClientRect().left - gridRect.left)).toBeLessThan(2);
    }
  });

  it("scrolls content: an unpinned column moves toward the inline start as scrollLeft grows (columns narrower than the viewport)", async () => {
    // MUI X shipped a regression test for exactly this class after an RTL clamping bug skipped
    // columns; our min(viewportWidth, contentWidth) pin anchor makes us susceptible to the same.
    await renderGrid({ direction: "rtl", columns: makeColumns(5), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // 5 * 100px = 500px of content in an 800px viewport: no overflow, nothing should shift
    const before = inlineStartOf(cellAt(0)!, "rtl");
    await scrollInlineTo(0, "rtl");
    const after = inlineStartOf(cellAt(0)!, "rtl");
    expect(Math.abs(after - before)).toBeLessThan(2);
    expect(Math.abs(after)).toBeLessThan(2);
  });
});

describe("RTL — pointer hit-testing", () => {
  it("clicking a visible cell selects THAT cell, across the viewport", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(12), rowCount: 30, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    // The highest-value RTL test: it catches the whole hit-test class in one assertion per column.
    for (const colIndex of [0, 3, 6]) {
      const cell = cellAt(colIndex);
      expect(cell).toBeDefined();
      await userEvent.click(cell!);
      const active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
      expect(Number(active?.getAttribute("aria-colindex")) - 1).toBe(colIndex);
    }
  });

  it("resolves a point exactly on a shared cell edge deterministically (half-open intervals)", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(12), rowCount: 30, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const first = cellAt(0)!;
    const second = cellAt(1)!;
    // the edge the two cells share; under RTL that is cell 0's physical LEFT edge
    const sharedEdge = first.getBoundingClientRect().left;
    expect(Math.abs(second.getBoundingClientRect().right - sharedEdge)).toBeLessThan(2);
    const y = first.getBoundingClientRect().top + first.getBoundingClientRect().height / 2;

    // The exact shared-edge pixel is not a reliable elementFromPoint/dispatch target: subpixel
    // rounding puts the browser's own hit-test on either box or neither, and dispatching on the
    // grid ROOT bypasses per-cell hit-testing entirely (always resolving to root.tsx's
    // onRootPointerDown, "click outside any cell clears selection", regardless of clientX/clientY —
    // the false negative this test used to hit). A half-open interval instead means: 1px inside
    // the edge belongs to that cell, 1px past it belongs to the other — test THAT boundary, on the
    // real per-cell DOM elements, through the real click pipeline.
    await userEvent.click(first);
    let active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(active).not.toBeNull();
    expect(Number(active!.getAttribute("aria-colindex")) - 1).toBe(0);

    await userEvent.click(second);
    active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(active).not.toBeNull();
    expect(Number(active!.getAttribute("aria-colindex")) - 1).toBe(1);

    // Sanity: elementFromPoint just inside each side of the shared edge still resolves to a real
    // cell (not an overlay) — the geometry itself has no dead zone at the boundary.
    expect(document.elementFromPoint(sharedEdge - 1, y)?.closest('[role="gridcell"]')).not.toBeNull();
    expect(document.elementFromPoint(sharedEdge + 1, y)?.closest('[role="gridcell"]')).not.toBeNull();
  });

  it("hit-tests inside the pinned band correctly under RTL", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(40, { firstPinnedLeft: true }), rowCount: 50, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await scrollInlineTo(600, "rtl");

    // Clicking the pinned cell must select the pinned column, not whatever unpinned column happens
    // to sit under it in content space — the pinned-band branch of columnAtX is what this covers.
    const pinned = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("pinned", "left")}`)!;
    await userEvent.click(pinned);

    const active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(active?.dataset["pinned"]).toBe("left");
  });
});

describe("RTL — keyboard semantics (visual movement)", () => {
  it("ArrowRight moves to the next VISUAL column, which is the previous index", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(10), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(cellAt(3)!);
    await userEvent.keyboard("{ArrowRight}");

    const active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(Number(active?.getAttribute("aria-colindex")) - 1).toBe(2);
  });

  it("ArrowLeft moves to the previous VISUAL column, which is the next index", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(10), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(cellAt(3)!);
    await userEvent.keyboard("{ArrowLeft}");

    const active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(Number(active?.getAttribute("aria-colindex")) - 1).toBe(4);
  });

  it("keeps LTR arrows unflipped", async () => {
    await renderGrid({ direction: "ltr", columns: makeColumns(10), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(cellAt(3)!);
    await userEvent.keyboard("{ArrowRight}");

    const active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(Number(active?.getAttribute("aria-colindex")) - 1).toBe(4);
  });

  it("does NOT flip Tab — it stays reading-order logical under RTL", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(10), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(cellAt(3)!);
    await userEvent.keyboard("{Tab}");

    const active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(Number(active?.getAttribute("aria-colindex")) - 1).toBe(4);
  });

  it("keeps Home logical under RTL: it lands on column 0, not the visually-first column", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(10), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.click(cellAt(3)!);
    await userEvent.keyboard("{Home}");

    const active = document.querySelector<HTMLElement>(`[role="gridcell"]${gridAttrSelector("active")}`);
    expect(Number(active?.getAttribute("aria-colindex")) - 1).toBe(0);
  });
});

describe("RTL — selection overlay alignment", () => {
  it("aligns a selection rectangle with the cells it covers", async () => {
    const { actions } = await renderGrid({ direction: "rtl", columns: makeColumns(10), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    actions().selectCell({ col: 2, row: 1 });
    actions().extendTo({ col: 4, row: 3 });

    const c2 = cellAt(2)!.getBoundingClientRect();
    const c4 = cellAt(4)!.getBoundingClientRect();
    // waits for the overlay to mount and repaint at the extended selection's rect, not a fixed settle time.
    await vi.waitFor(() => {
      const overlay = document.querySelector<HTMLElement>(gridAttrSelector("selectionOverlay"));
      expect(overlay).not.toBeNull();
      const overlayRect = overlay!.getBoundingClientRect();
      // under RTL, col 2 is physically to the RIGHT of col 4
      expect(Math.abs(overlayRect.right - c2.right)).toBeLessThan(3);
      expect(Math.abs(overlayRect.left - c4.left)).toBeLessThan(3);
    });
  });
});

describe("RTL — rendered cell content position", () => {
  // Every other test in this file measures cell BOXES, which mirror for free via CSS Grid. These
  // measure where the GLYPHS land inside the box — the axis a `dir="auto"` on the content wrapper
  // silently broke while all the box-geometry assertions above stayed green.

  /** Distance from an element's inline-start edge to the first painted glyph of its text. */
  function textInlineStartGap(el: HTMLElement, direction: GridDirection): number {
    // A Range over the TEXT NODE measures painted glyphs; a Range over an element would measure its
    // (here full-width) box and report the same number no matter which side the text sits on.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    expect(textNode, "cell has rendered text to measure").not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    const text = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return direction === "rtl" ? box.right - text.right : text.left - box.left;
  }

  function headerAt(colIndex: number): HTMLElement {
    return document.querySelectorAll<HTMLElement>('[role="columnheader"]')[colIndex]!;
  }

  function textColumns() {
    return [
      { id: "c0", header: "الاسم", accessorFn: (r: Row) => r.name, type: "text" as const, width: 160 },
      { id: "c1", header: "العمر", accessorFn: (r: Row) => r.age, type: "number" as const, width: 120 },
    ];
  }

  for (const direction of ["ltr", "rtl"] as const) {
    it(`start-aligned cell text begins at the same inline offset as its header, in ${direction}`, async () => {
      await renderGrid({ direction, columns: textColumns(), rowCount: 10, width: 700 });
      await expect.element(page.getByRole("grid")).toBeInTheDocument();

      // Latin values ("Person 0") inside an Arabic-headed RTL grid: the exact mixed-script case
      // where a content-resolved direction strands the text against the wrong physical edge.
      const cellGap = textInlineStartGap(cellAt(0)!, direction);
      const headerGap = textInlineStartGap(headerAt(0), direction);
      expect(Math.abs(cellGap - headerGap)).toBeLessThan(2);
      // and it is genuinely AT the inline start, not merely equal to an also-wrong header
      expect(cellGap).toBeLessThan(20);
    });
  }

  it("end-aligned (number) cell text hugs the inline END under RTL, not the physical right", async () => {
    await renderGrid({ direction: "rtl", columns: textColumns(), rowCount: 10, width: 700 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cell = cellAt(1)!;
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    range.selectNodeContents(walker.nextNode()!);
    const text = range.getBoundingClientRect();
    const box = cell.getBoundingClientRect();
    // inline end under RTL is the physical LEFT edge
    expect(text.left - box.left).toBeLessThan(20);
  });

  it("isolates cell content bidi without letting it re-align the box", async () => {
    await renderGrid({ direction: "rtl", columns: textColumns(), rowCount: 10, width: 700 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cell = cellAt(0)!;
    const bdi = cell.querySelector("bdi");
    expect(bdi).not.toBeNull();
    // a `dir` on the content wrapper is exactly the regression this file now guards: it makes
    // `text-align: start` resolve against the VALUE's direction instead of the grid's.
    expect(cell.querySelector("[dir]")).toBeNull();
  });
});

describe("RTL — editor input direction", () => {
  /** `accessorKey` (not `accessorFn`) so the column has a write path and the editor actually opens. */
  function editableColumns() {
    return [
      { id: "name", header: "الاسم", accessorKey: "name", type: "text" as const, width: 180 },
      { id: "age", header: "العمر", accessorKey: "age", type: "number" as const, width: 120 },
    ];
  }

  it("gives the editor the value's own direction so the caret sits where edits land", async () => {
    await renderGrid({ direction: "rtl", columns: editableColumns(), rowCount: 10, width: 700 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.dblClick(cellAt(0)!);
    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing")} input`)!;
    expect(input.getAttribute("dir")).toBe("auto");
    // "Person 0" has no strong RTL character, so it must render left-to-right even though the grid
    // around it is RTL — inheriting `rtl` is what put the caret opposite where edits landed.
    expect(getComputedStyle(input).direction).toBe("ltr");
  });

  it("edits land at the caret: deleting then typing appends at the end under RTL", async () => {
    await renderGrid({ direction: "rtl", columns: editableColumns(), rowCount: 10, width: 700 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    await userEvent.dblClick(cellAt(0)!);
    const input = document.querySelector<HTMLInputElement>(`[role="gridcell"]${gridAttrSelector("editing")} input`)!;
    const original = input.value;
    expect(original.length).toBeGreaterThan(1);

    input.setSelectionRange(original.length, original.length);
    await userEvent.keyboard("{Backspace}7");
    const expectedValue = `${original.slice(0, -1)}7`;
    await vi.waitFor(() => expect(input.value).toBe(expectedValue));

    expect(input.selectionStart).toBe(input.value.length);
  });
});

describe("RTL — column resize", () => {
  it("grows the column when the handle is dragged toward the inline end (physically left under RTL)", async () => {
    await renderGrid({ direction: "rtl", columns: makeColumns(8), rowCount: 20, width: 800 });
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const header = document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="c1"]')!;
    const startWidth = header.getBoundingClientRect().width;
    const handle = header.querySelector<HTMLElement>(`${gridAttrSelector("resizing")}, .cursor-col-resize`) ?? header.lastElementChild as HTMLElement;
    const handleRect = handle.getBoundingClientRect();

    const startX = handleRect.left + handleRect.width / 2;
    const y = handleRect.top + handleRect.height / 2;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: startX, clientY: y, button: 0, pointerId: 1 }));
    // toward the inline end under RTL = toward the physical left
    document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: startX - 40, clientY: y, pointerId: 1 }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: startX - 40, clientY: y, pointerId: 1 }));

    const getWidth = () =>
      document.querySelector<HTMLElement>('[role="columnheader"][data-column-id="c1"]')!.getBoundingClientRect().width;
    await vi.waitFor(() => expect(getWidth()).toBeGreaterThan(startWidth + 10));
  });
});
