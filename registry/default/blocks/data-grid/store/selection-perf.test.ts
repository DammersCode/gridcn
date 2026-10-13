import { describe, expect, it } from "vitest";
import type { ColumnDef, SelectionState } from "../types";
import { CompactSelection } from "../selection/compact-selection";
import { createDataGridStore } from "./create-store";
import type { InternalSyncProps } from "./types";

// Shared GitHub Actions runners are several × slower than a dev machine; the ceilings guard the
// order of magnitude, not machine jitter (baseline + 20 %, recorded below).
const CI_FACTOR = process.env["CI"] ? 2 : 1;

const DRAG_STEPS = 1000;
const ROW_COUNT = 100_000;

type WideRow = { id: string; v: number };

const getRowId = (row: WideRow) => row.id;

const columns: readonly ColumnDef<WideRow, unknown>[] = [
  { id: "v", header: "V", accessorKey: "v", type: "number" },
  { id: "x", header: "X" },
];

function makeRows(count: number): WideRow[] {
  // Nearly reverse-sorted on `v`: a sort moves almost every row.
  return Array.from({ length: count }, (_, i) => ({ id: String(i), v: (count - i) % 97 }));
}

const EMPTY_SELECTION: SelectionState = { anchor: null, range: null, rangeStack: [], rowIds: [], columnIds: [] };

function makeStore(rows: WideRow[], onSelectionChange?: (next: SelectionState) => void) {
  const init = { data: rows, columns, getRowId, selection: EMPTY_SELECTION, onSelectionChange } as unknown as InternalSyncProps;
  return createDataGridStore(init);
}

/** A 1,000-row channel selection at view rows 0..999. */
function rowChannelSelection() {
  return {
    current: { cell: { row: 0, col: 0 }, range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] },
    rows: CompactSelection.fromArray(Array.from({ length: 1000 }, (_, i) => i)),
    columns: CompactSelection.empty(),
  };
}

describe("controlled selection perf (100k rows)", () => {
  it("keeps a controlled drag step (set + derive + echo sync) below the ceiling", () => {
    const rows = makeRows(ROW_COUNT);
    let emitted: SelectionState | null = null;
    const onSelectionChange = (next: SelectionState) => {
      emitted = next;
    };
    const store = makeStore(rows, onSelectionChange);
    const unsub = store.getState().actions._subscribeSelection();
    const props = { data: rows, columns, getRowId, selection: EMPTY_SELECTION, onSelectionChange } as unknown as InternalSyncProps;

    store.getState().actions._syncProps(props); // warmup: establishes the last-props references
    store.getState().actions.selectCellAt({ row: 0, col: 0 });
    store.getState().actions._syncProps({ ...props, selection: emitted! });

    const iterations = 3;
    const start = performance.now();
    for (let pass = 0; pass < iterations; pass++) {
      for (let step = 1; step < DRAG_STEPS; step++) {
        store.getState().actions.extendToAt({ row: step % 1000, col: 0 });
        store.getState().actions._syncProps({ ...props, selection: emitted! });
      }
    }
    const ms = (performance.now() - start) / (iterations * (DRAG_STEPS - 1));
    unsub();
    console.log(`controlled drag step at 100k rows: ${ms.toFixed(3)}ms/step`);
    // Baseline ~0.02 ms/step (one set, three corner refs, one early-return sync).
    expect(ms).toBeLessThan(0.1 * CI_FACTOR);
  }, 30_000);

  it("keeps a sort with a 1,000-row channel selection near the plain-sort cost", () => {
    const rows = makeRows(ROW_COUNT);
    const plain = makeStore(rows);
    const withSelection = makeStore(rows);
    withSelection.setState({ selection: rowChannelSelection() });

    let plainMs = 0;
    let remapMs = 0;
    const iterations = 3;
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      plain.getState().actions.setSorts([{ columnId: "v", direction: "asc" }]);
      plain.getState().actions.setSorts([{ columnId: "v", direction: "desc" }]);
      plainMs += performance.now() - t0;

      const t1 = performance.now();
      withSelection.getState().actions.setSorts([{ columnId: "v", direction: "asc" }]);
      withSelection.getState().actions.setSorts([{ columnId: "v", direction: "desc" }]);
      remapMs += performance.now() - t1;
    }
    plainMs /= iterations;
    remapMs /= iterations;
    console.log(`sort at 100k rows: plain ${plainMs.toFixed(2)}ms, with 1000-row channel ${remapMs.toFixed(2)}ms`);
    // The channel remap is O(channel): the overhead is a small fraction of the O(n log n) sort.
    expect(remapMs).toBeLessThan(plainMs * 1.5 + 20 * CI_FACTOR);
  }, 30_000);

  it("keeps an immediate updateCells tick with a 1,000-row channel selection small", () => {
    const rows = makeRows(ROW_COUNT);
    const store = makeStore(rows);
    store.getState().actions.setSorts([{ columnId: "v", direction: "asc" }]);
    store.setState({ selection: rowChannelSelection() });

    const t0 = performance.now();
    store.getState().actions.updateCells([{ rowId: "0", columnId: "v", value: 1_000_000_000 }], { reorder: "immediate" });
    const ms = performance.now() - t0;
    console.log(`immediate updateCells tick at 100k rows with 1000-row channel: ${ms.toFixed(2)}ms`);
    // The batch cost scales with the batch (1 row), not the row count or the channel.
    expect(ms).toBeLessThan(100 * CI_FACTOR);
  }, 30_000);
});

describe("controlled selection perf (1M rows)", () => {
  it("emits select-all-once with an O(n) rowIds derivation over the 1M row channel", () => {
    const rows = makeRows(1_000_000);
    let emissions = 0;
    let emitted: SelectionState | null = null;
    const store = makeStore(rows, (next) => {
      emissions++;
      emitted = next;
    });
    const unsub = store.getState().actions._subscribeSelection();
    const t0 = performance.now();
    store.getState().actions.setAllRowsSelected(true);
    const ms = performance.now() - t0;
    unsub();

    expect(emissions).toBe(1);
    expect(emitted!.rowIds).toHaveLength(1_000_000);
    console.log(`row channel at 1M rows: ${ms.toFixed(1)}ms, rowIds length ${emitted!.rowIds.length}`);
    // O(n) rowIds over 1M rows: the ceiling guards against an accidental per-row allocation storm.
    expect(ms).toBeLessThan(2000 * CI_FACTOR);
  }, 30_000);
});
