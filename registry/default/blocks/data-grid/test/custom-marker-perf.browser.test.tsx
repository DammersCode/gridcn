import { page } from "vitest/browser";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";
import { Circle, Check, List, ListChecks } from "lucide-react";
import { DataGrid, useDataGridActions, type MarkerCellRenderCtx, type MarkerHeaderRenderCtx } from "../data-grid";
import { columns, makeRows, measureScrollFps } from "./perf-probe.test-helper";
// real stylesheet — layout/scroll must be real for a frame-timing probe to mean anything
import "@/app/global.css";

// Trivially cheap (icon only) renderers, module scope for stable identity: the measurement is meant
// to isolate the render-slot PLUMBING cost (one root-context read + one renderer call per marker
// cell, per row-window commit) against the built-in checkbox path on the same grid.
const customRenderMarker = ({ isRowChannelSelected }: MarkerCellRenderCtx): ReactNode => (
  <span className="flex size-5 items-center justify-center">
    {isRowChannelSelected ? <Check className="size-3.5 text-emerald-600" aria-hidden="true" /> : <Circle className="size-3.5 text-muted-foreground" aria-hidden="true" />}
  </span>
);

function CustomHeaderButton({ allSelected }: { allSelected: MarkerHeaderRenderCtx["allSelected"] }): ReactNode {
  const { setAllRowsSelected } = useDataGridActions();
  const checked = allSelected === "checked";
  return (
    <button type="button" aria-label={checked ? "Unselect all rows" : "Select all rows"} onClick={() => setAllRowsSelected(!checked)}>
      {checked ? <ListChecks className="size-3.5" aria-hidden="true" /> : <List className="size-3.5" aria-hidden="true" />}
    </button>
  );
}

const customRenderMarkerHeader = ({ allSelected }: MarkerHeaderRenderCtx): ReactNode => (
  <CustomHeaderButton allSelected={allSelected} />
);

/** Best-of-3 sustained full-window-swap (800px/frame) fps after an interleaved-style warm-up of the same speed. */
async function bestFullSwapFps(grid: HTMLElement): Promise<number> {
  for (let i = 0; i < 5; i++) {
    await measureScrollFps(grid, 800, 50);
  }
  let best = 0;
  for (let i = 0; i < 3; i++) {
    best = Math.max(best, await measureScrollFps(grid, 800, 200));
  }
  return best;
}

describe("custom marker renderers: full-window-swap FPS guardrail vs the built-in marker", () => {
  // Same method and dataset as perf.browser.test.tsx (100k rows, 800px/frame forced-layout
  // steps). This test adds the CUSTOM-marker side of that comparison: a module-scope renderMarker +
  // renderMarkerHeader on the same grid. The ratio assertion is the machine-relative guard (a custom
  // renderer should not cost more than ~30% of the built-in path on the same machine); the absolute
  // 15fps floor is the fast-reference-machine guard, relaxed to a fraction of THIS machine's built-in
  // fps on a slow/contended CI runner, where an absolute bar is not comparable (the built-in marker
  // itself sits far below reference fps there). The ratio gets the same treatment: on a runner that
  // cannot sustain a frame budget (built-in < 30fps), frame pacing dominates the ratio, so it binds
  // at the same relaxed 0.5 fraction instead of 0.7.
  it("keeps custom-marker full-swap FPS competitive with the built-in marker and above the floor", { timeout: 300_000 }, async () => {
    const rows = makeRows(100_000);

    const custom = await render(
      <div style={{ height: 600, width: 1200 }}>
        <DataGrid
          data={rows}
          columns={columns}
          getRowId={(r) => r.id}
          rowMarkers="checkbox"
          renderMarker={customRenderMarker}
          renderMarkerHeader={customRenderMarkerHeader}
          className="h-150 w-300"
        />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    let grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const customFps = await bestFullSwapFps(grid);
    await custom.unmount();

    const builtin = await render(
      <div style={{ height: 600, width: 1200 }}>
        <DataGrid data={rows} columns={columns} getRowId={(r) => r.id} rowMarkers="checkbox" className="h-150 w-300" />
      </div>,
    );
    await expect.element(page.getByRole("grid")).toBeInTheDocument();
    grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const builtinFps = await bestFullSwapFps(grid);
    await builtin.unmount();

    const ratio = customFps / builtinFps;
    console.log(`custom-marker perf: custom=${customFps.toFixed(1)}fps built-in=${builtinFps.toFixed(1)}fps ratio=${ratio.toFixed(3)}`);

    const ratioFloor = builtinFps >= 30 ? 0.7 : 0.5;
    expect(ratio).toBeGreaterThan(ratioFloor);
    // 0.5 is deliberately LOOSER than the strict ratio floor, so the ratio stays the binding guard on a
    // fast machine while a slow machine still holds a real bar.
    expect(customFps).toBeGreaterThanOrEqual(Math.min(15, builtinFps * 0.5));
  });
});
