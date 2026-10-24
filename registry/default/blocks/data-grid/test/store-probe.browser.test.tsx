import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { DataGridBody, DataGridHeader, DataGridProvider, DataGridRoot } from "../data-grid";
import { columns, makeRows } from "./perf-probe.test-helper";
import { InstrumentedStoreProbe, type StoreProbeReading } from "./store-instrumentation.test-helper";
import "@/app/global.css";

// Measured marginal: ~4.7 per cell (4 cell subscriptions + one row subscription per 3 cells).
const MAX_LISTENERS_PER_CELL = 5;

async function mountAndMeasure(rowCount: number) {
  let probe: StoreProbeReading | undefined;
  const screen = await render(
    <DataGridProvider data={makeRows(rowCount)} columns={columns.slice(0, 3)} getRowId={(r) => r.id}>
      <InstrumentedStoreProbe onReady={(p) => { probe = p; }} />
      <div style={{ height: 600 }}><DataGridRoot>
        <DataGridHeader />
        <DataGridBody />
      </DataGridRoot></div>
    </DataGridProvider>,
  );
  const cellCount = () => screen.container.querySelectorAll('[role="gridcell"]').length;
  try {
    let previous = -1;
    await expect.poll(() => {
      const current = cellCount();
      const stable = current > 0 && current === previous;
      previous = current;
      return stable;
    }).toBe(true);
    if (!probe) throw new Error("store probe never reported");
    return { cells: cellCount(), live: probe.liveListeners() };
  } finally {
    probe?.restore();
    await screen.unmount();
  }
}

describe("store subscriptions per mounted cell", () => {
  it("adds no more than the measured listeners per extra cell", async () => {
    const small = await mountAndMeasure(5);
    const large = await mountAndMeasure(10);
    const perCell = (large.live - small.live) / (large.cells - small.cells);
    console.info(`store-probe: small=${small.cells} cells/${small.live} listeners, large=${large.cells} cells/${large.live} listeners, marginal perCell=${perCell}`);
    expect(large.cells).toBeGreaterThan(small.cells);
    expect(perCell).toBeLessThanOrEqual(MAX_LISTENERS_PER_CELL);
  });
});
