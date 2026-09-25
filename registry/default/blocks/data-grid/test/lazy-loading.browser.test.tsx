import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { DataGrid, gridAttrSelector } from "../data-grid";
// real stylesheet — layout/scroll must be real for these probes to mean anything
import "@/app/global.css";

const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 36;

type Row = { id: string; name: string };

/**
 * A sparse rows array with holes at every index not in `loadedIndices` — mirrors a lazy-loading
 * add-on's partial `data`. Cast to `Row[]` at the boundary: `DataGridProps.data` is typed
 * `readonly TData[]` (a real lazy-loading add-on's array is genuinely sparse at runtime while
 * still claiming `TData[]` for its loaded elements), matching how `store.tsx` itself treats
 * `data[i]` as possibly `undefined` regardless of the declared element type.
 */
function makeSparseRows(count: number, loadedIndices: Set<number>): Row[] {
  const rows: (Row | undefined)[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(loadedIndices.has(i) ? { id: `row-${i}`, name: `Person ${i}` } : undefined);
  }
  return rows as Row[];
}

const columns = [
  { id: "id", header: "ID", accessorKey: "id" as const, type: "text" as const, width: 120 },
  { id: "name", header: "Name", accessorKey: "name" as const, type: "text" as const, width: 180 },
];

describe("skeleton rows for undefined data holes", () => {
  it("renders skeleton cells (aria-busy, shimmer block) for an undefined row, marker column still shows the row number", async () => {
    const data = makeSparseRows(100, new Set([0, 1, 2]));
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid
          data={data}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-90 w-150"
          rowMarkers="number"
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const rows = [...document.querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]')];
    // aria-rowindex 2 is data row 0 (loaded), aria-rowindex 5 is data row 3 (a hole).
    const loadedRow = rows.find((r) => r.getAttribute("aria-rowindex") === "2")!;
    const skeletonRow = rows.find((r) => r.getAttribute("aria-rowindex") === "5")!;

    expect(loadedRow.getAttribute("aria-busy")).toBeNull();
    expect(skeletonRow.getAttribute("aria-busy")).toBe("true");

    const skeletonCells = skeletonRow.querySelectorAll('[role="gridcell"][data-skeleton]');
    expect(skeletonCells.length).toBe(columns.length);
    for (const cell of skeletonCells) {
      expect(cell.querySelector(".animate-pulse")).not.toBeNull();
      expect(cell.getAttribute("aria-busy")).toBe("true");
    }

    // marker column shows the row number regardless of data (index-derived, not read from `row`).
    const marker = skeletonRow.querySelector(gridAttrSelector("markerNumber"));
    expect(marker?.textContent).toBe("4"); // viewRowIndex 3 + 1

    // a loaded row renders real text content, no shimmer. `[data-column-id]` excludes the marker cell (also role=gridcell).
    const loadedCells = loadedRow.querySelectorAll('[role="gridcell"][data-column-id]');
    expect(loadedCells[0]!.textContent).toBe("row-0");
    expect(loadedRow.querySelector(".animate-pulse")).toBeNull();
  });

  it("an undefined row flipping to defined replaces the skeleton with real content (same DOM row, keyed by index fallback)", async () => {
    const initialData = makeSparseRows(50, new Set());
    const screen = await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={initialData} columns={columns} getRowId={(r) => r.id} className="h-90 w-150" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const rowsBefore = [...document.querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]')];
    const firstDataRow = rowsBefore.find((r) => r.getAttribute("aria-rowindex") === "2")!;
    expect(firstDataRow.getAttribute("aria-busy")).toBe("true");
    expect(firstDataRow.querySelector(".animate-pulse")).not.toBeNull();

    const filledData = makeSparseRows(50, new Set([0]));
    await screen.rerender(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={filledData} columns={columns} getRowId={(r) => r.id} className="h-90 w-150" />
      </div>,
    );

    const rowsAfter = [...document.querySelectorAll<HTMLElement>('[role="row"][aria-rowindex]')];
    const filledRow = rowsAfter.find((r) => r.getAttribute("aria-rowindex") === "2")!;
    expect(filledRow.getAttribute("aria-busy")).toBeNull();
    expect(filledRow.querySelector(".animate-pulse")).toBeNull();
    expect(filledRow.querySelectorAll('[role="gridcell"]')[0]!.textContent).toBe("row-0");
  });

  it("double-click on a skeleton cell does not open an editor", async () => {
    const data = makeSparseRows(50, new Set());
    await render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid data={data} columns={columns} getRowId={(r) => r.id} className="h-90 w-150" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();

    const cell = document.querySelector<HTMLElement>('[role="gridcell"][data-skeleton]')!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));

    expect(document.querySelector(gridAttrSelector("editing", "true"))).toBeNull();
  });
});

describe("onRowWindowChange", () => {
  function renderGrid(rowCount: number, onRowWindowChange: (range: { start: number; end: number }) => void) {
    const rows: Row[] = [];
    for (let i = 0; i < rowCount; i++) rows.push({ id: `row-${i}`, name: `Person ${i}` });
    return render(
      <div style={{ height: 360, width: 600 }}>
        <DataGrid
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          className="h-90 w-150"
          onRowWindowChange={onRowWindowChange}
        />
      </div>,
    );
  }

  it("fires exactly once on mount, with the real measured range (not the pre-measurement fallback)", async () => {
    const onRowWindowChange = vi.fn();
    await renderGrid(10_000, onRowWindowChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    // Mount used to commit twice: an initial no-element-yet fallback window (computeWindow's
    // `!element` branch, a fixed 30-row guess) immediately followed by the real window once the
    // scroll element was measured, in the same effect flush — a genuine double-notify bug (both
    // {start,end} values differ, so a naive "only when the range changed" guard fired for both).
    // useRowWindow now reports `measured: false` for that fallback render and body.tsx skips
    // notifying for it, so only the real, measured window ever reaches the consumer.
    expect(onRowWindowChange).toHaveBeenCalledTimes(1);
    const [range] = onRowWindowChange.mock.calls[0]! as [{ start: number; end: number }];
    expect(range.start).toBe(0);
    expect(range.end).toBeGreaterThan(0);
  });

  it("fires again after a scroll that shifts the window, with the new range", async () => {
    const onRowWindowChange = vi.fn();
    await renderGrid(10_000, onRowWindowChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));
    onRowWindowChange.mockClear();

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.scrollTop = 500 * ROW_HEIGHT;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    expect(onRowWindowChange).toHaveBeenCalled();
    const lastCall = onRowWindowChange.mock.calls.at(-1) as [{ start: number; end: number }];
    const [range] = lastCall;
    const expectedStart = Math.floor((500 * ROW_HEIGHT - HEADER_HEIGHT) / ROW_HEIGHT);
    // allow for overscan slack either side rather than pinning the exact overscanned value.
    expect(range.start).toBeGreaterThan(0);
    expect(Math.abs(range.start - expectedStart)).toBeLessThan(50);
  });

  it("does NOT fire again on a same-window scroll tick within an ongoing drag", async () => {
    const onRowWindowChange = vi.fn();
    await renderGrid(10_000, onRowWindowChange);
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    // Settle far from the boundary and let the mount's own commit(s) + the scroll's isScrolling
    // settle debounce (150ms, use-row-window.ts ISSCROLLING_DEBOUNCE_MS) finish first — a settle
    // commit re-narrows the velocity-widened overscan, itself a genuine {start,end} change, so it
    // must land BEFORE mockClear or it shows up as a spurious post-clear call. Mid-row (+18px, half
    // a row height) so the coming same-direction jitter can never cross computeWindow's
    // floor()-based row boundary.
    grid.scrollTop = 500 * ROW_HEIGHT + 18;
    grid.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 200));

    // Warm up: same-direction +1px ticks each still decay use-row-window.ts's velocity estimate a
    // further VELOCITY_DECAY_FACTOR (0.5) toward its floor — `end`'s overscan keeps narrowing tick
    // by tick until the estimate bottoms out, which is itself a genuine (if shrinking) window change,
    // not the "same window" case. Run enough ticks for the estimate to fully settle before measuring.
    for (let i = 1; i <= 10; i++) {
      grid.scrollTop += 1;
      grid.dispatchEvent(new Event("scroll"));
    }
    await new Promise((r) => requestAnimationFrame(r));
    onRowWindowChange.mockClear();

    // Same-DIRECTION sub-pixel deltas while already isScrolling (mid-drag, no settle in between)
    // stay inside the now-settled overscan buffer and never flip deltaTop's sign — {start,end}
    // doesn't change, so this is the genuine same-window case. An alternating +1/-1 delta is NOT
    // this case: flipping deltaTop's sign flips which edge gets computeWindow's asymmetric
    // leading-edge overscan, which legitimately shifts {start,end} on every alternation.
    for (let i = 1; i <= 5; i++) {
      grid.scrollTop += 1;
      grid.dispatchEvent(new Event("scroll"));
    }
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => setTimeout(r, 0));

    expect(onRowWindowChange).not.toHaveBeenCalled();
  });
});
