import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { memo } from "react";
import type { ColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import {
  DataGridBody,
  DataGridHeader,
  DataGridProvider,
  DataGridRoot,
  useDataGridActions,
  useDataGridCellState,
  useDataGridRow,
  gridAttrSelector,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridPresence, useDataGridPresenceHighlights, type PresenceHighlightEntry, type PresenceStoreApi } from "../data-grid-presence";
import type { GridRect } from "@/registry/default/blocks/data-grid/data-grid";

type Row = { id: string; name: string; qty: number };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(i), name: `Row ${i}`, qty: i }));
}

afterEach(cleanup);

// jsdom performs no layout; drive useRowWindow's viewport math by stubbing clientHeight, same as
// core's own data-grid.test.tsx — needed here so DataGridBody actually mounts row/overlay DOM in
// the rowId-native resolution tests below (the zero-render probes above never invoke the plugin
// through a mounted DataGridBody, so they didn't need this).
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 360; // 10 rows visible at rowHeight 36
    },
  });
});

/**
 * Zero-cell-render presence probe, moved from core's own data-grid.test.tsx (workplan #48): presence
 * now lives entirely in this add-on's own store, so `setPresenceHighlights` must not touch core's
 * row/cell subscriptions at all — it's not even the same store instance any more.
 */
describe("multiplayer presence: setPresenceHighlights renders ONLY the highlights subscriber, never rows/cells", () => {
  it("does not re-render the row-level (per-getRowId) subscription", () => {
    const rowRenderCounts: number[] = [0, 0, 0];

    function CountingRow({ viewRowIndex }: { viewRowIndex: number }) {
      const row = useDataGridRow(viewRowIndex);
      rowRenderCounts[viewRowIndex] = (rowRenderCounts[viewRowIndex] ?? 0) + 1;
      return <span data-testid={`row-render-${viewRowIndex}`}>{JSON.stringify(row)}</span>;
    }
    const MemoCountingRow = memo(CountingRow);

    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function PresenceCapture() {
      const presence = useDataGridPresence();
      setPresenceHighlights = presence.setPresenceHighlights;
      return null;
    }

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id}>
        <PresenceCapture />
        <MemoCountingRow viewRowIndex={0} />
        <MemoCountingRow viewRowIndex={1} />
        <MemoCountingRow viewRowIndex={2} />
      </DataGridProvider>,
    );

    const before = [...rowRenderCounts];

    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "#f00", range: { x: 0, y: 0, width: 1, height: 1 }, label: "Ada" }]);
    });
    act(() => {
      setPresenceHighlights!([]);
    });

    // useDataGridRow subscribes only to `data[viewIndex[viewRowIndex]]`, which presence never touches.
    expect(rowRenderCounts).toEqual(before);
  });

  it("does not re-render a per-cell subscription (useDataGridCellState)", () => {
    let cellRenderCount = 0;
    function CountingCell({ col, row: rowIndex }: { col: number; row: number }) {
      useDataGridCellState({ col, row: rowIndex });
      cellRenderCount += 1;
      return null;
    }
    const MemoCountingCell = memo(CountingCell);

    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function PresenceCapture() {
      const presence = useDataGridPresence();
      setPresenceHighlights = presence.setPresenceHighlights;
      return null;
    }

    render(
      <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id}>
        <PresenceCapture />
        <MemoCountingCell col={0} row={0} />
      </DataGridProvider>,
    );

    const before = cellRenderCount;
    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "#f00", range: { x: 0, y: 0, width: 2, height: 2 } }]);
    });
    expect(cellRenderCount).toBe(before);
  });

  it("re-renders ONLY a component subscribed via useDataGridPresenceHighlights, exactly once per call", () => {
    let highlightsRenderCount = 0;
    let lastHighlights: unknown[] = [];
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;

    // useDataGridPresence mints a store per calling component, so the one owner passes its
    // storeApi down as a prop — no render-time mutation for a later render to observe.
    function HighlightsProbe({ storeApi }: { storeApi: PresenceStoreApi }) {
      lastHighlights = [...useDataGridPresenceHighlights(storeApi)];
      highlightsRenderCount += 1;
      return null;
    }
    const MemoHighlightsProbe = memo(HighlightsProbe);

    function Harness() {
      const presence = useDataGridPresence();
      setPresenceHighlights = presence.setPresenceHighlights;
      return (
        <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id}>
          <MemoHighlightsProbe storeApi={presence.storeApi} />
        </DataGridProvider>
      );
    }

    render(<Harness />);

    const before = highlightsRenderCount;
    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "#f00", range: { x: 0, y: 0, width: 1, height: 1 } }]);
    });
    expect(highlightsRenderCount).toBe(before + 1);
    expect(lastHighlights).toHaveLength(1);

    // clearing fires exactly one more render, not a burst.
    act(() => {
      setPresenceHighlights!([]);
    });
    expect(highlightsRenderCount).toBe(before + 2);
  });

  it("does not re-render the row-level (per-getRowId) subscription when a rowId-native highlight is set", () => {
    const rowRenderCounts: number[] = [0, 0, 0];

    function CountingRow({ viewRowIndex }: { viewRowIndex: number }) {
      const row = useDataGridRow(viewRowIndex);
      rowRenderCounts[viewRowIndex] = (rowRenderCounts[viewRowIndex] ?? 0) + 1;
      return <span data-testid={`row-render-${viewRowIndex}`}>{JSON.stringify(row)}</span>;
    }
    const MemoCountingRow = memo(CountingRow);

    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
      setPresenceHighlights = setHighlights;
      return (
        <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
          <MemoCountingRow viewRowIndex={0} />
          <MemoCountingRow viewRowIndex={1} />
          <MemoCountingRow viewRowIndex={2} />
        </DataGridProvider>
      );
    }

    render(<Harness />);
    const before = [...rowRenderCounts];

    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "#f00", rowId: "1", columnId: "qty", label: "Ada" }]);
    });
    act(() => {
      setPresenceHighlights!([]);
    });

    // rowId resolution happens inside the plugin/DataGridOverlays only — useDataGridRow's own
    // subscription (data[viewIndex[viewRowIndex]]) is untouched by it.
    expect(rowRenderCounts).toEqual(before);
  });

  it("does not re-render a per-cell subscription (useDataGridCellState) when a rowId-native highlight is set", () => {
    let cellRenderCount = 0;
    function CountingCell({ col, row: rowIndex }: { col: number; row: number }) {
      useDataGridCellState({ col, row: rowIndex });
      cellRenderCount += 1;
      return null;
    }
    const MemoCountingCell = memo(CountingCell);

    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
      setPresenceHighlights = setHighlights;
      return (
        <DataGridProvider data={makeRows(3)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
          <MemoCountingCell col={0} row={0} />
        </DataGridProvider>
      );
    }

    render(<Harness />);
    const before = cellRenderCount;
    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "#f00", rowId: "0", columnId: "name" }]);
    });
    expect(cellRenderCount).toBe(before);
  });
});

/**
 * rowId-native entries (2026-08-02 optimization audit, "rowId-native presence adapter"): the plugin
 * resolves `{ rowId, columnId }` to a view-space cell using the SAME `useDataGridRowIdToViewRow()`
 * core hook the docs now point consumers at, instead of a manual `useShallow`-over-`useDataGridRowIds`
 * map that cost O(n) per store change. These tests exercise resolution through the real overlay
 * plugin pipeline (`DataGridRoot`/`DataGridBody` mounted), unlike the zero-render probes above which
 * never invoke the plugin at all.
 */
describe("multiplayer presence: rowId-native highlight resolution", () => {
  it("paints a rowId-native highlight at the row's current view position", async () => {
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
      setPresenceHighlights = setHighlights;
      return (
        <DataGridProvider data={makeRows(5)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }

    render(<Harness />);
    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowId: "2", columnId: "qty" }]);
    });

    const overlay = document.querySelector<HTMLElement>(gridAttrSelector("presenceOverlay"));
    expect(overlay).not.toBeNull();
    expect(overlay!.style.gridRowStart).toBe("3"); // view row 2 -> grid line 3 (1-based, header excluded from this canvas)
    expect(overlay!.style.gridColumnStart).toBe("2"); // "qty" is the 2nd column (index 1) + colOffset 1
  });

  it("drops a rowId-native entry silently when the row is filtered out of the view", () => {
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
      setPresenceHighlights = setHighlights;
      return (
        <DataGridProvider data={makeRows(5)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <ActionsCapture onReady={(actions) => (actionsRef = actions)} />
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }

    render(<Harness />);
    act(() => {
      // row "3" (name "Row 3") is filtered out by this "name equals Row 0" filter.
      actionsRef!.setFilters([{ columnId: "name", operator: "equals", value: "Row 0" }]);
    });
    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowId: "3", columnId: "qty" }]);
    });

    expect(document.querySelector(gridAttrSelector("presenceOverlay"))).toBeNull();
  });

  it("mixes rowId-native and view-space entries in the same call", () => {
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
      setPresenceHighlights = setHighlights;
      return (
        <DataGridProvider data={makeRows(5)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }

    render(<Harness />);
    act(() => {
      setPresenceHighlights!([
        { id: "user-1", color: "rgb(1,2,3)", rowId: "1", columnId: "name" },
        { id: "user-2", color: "rgb(4,5,6)", range: { x: 1, y: 0, width: 1, height: 1 } },
      ]);
    });

    expect(document.querySelectorAll(gridAttrSelector("presenceOverlay")).length).toBe(2);
  });
});

/**
 * Entry hardening (plan 012 P7 a-c): duplicate `id`s must not break reconciliation (entries are
 * keyed by entry position, not id), and malformed / misrouted / hidden-column foreign entries are
 * dropped with a dev warning instead of failing silently.
 */
describe("multiplayer presence: entry hardening", () => {
  it("renders two entries that share one id (keyed by entry position, not id)", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
      setPresenceHighlights = setHighlights;
      return (
        <DataGridProvider data={makeRows(5)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }

    render(<Harness />);
    act(() => {
      setPresenceHighlights!([
        { id: "user-1", color: "rgb(1,2,3)", rowId: "1", columnId: "name" },
        { id: "user-1", color: "rgb(4,5,6)", rowId: "2", columnId: "qty" },
      ]);
    });

    expect(document.querySelectorAll(gridAttrSelector("presenceOverlay")).length).toBe(2);
    // duplicate React keys are unsupported (unstable reconciliation across updates) — the id must
    // not be the key, only the entry position may be
    expect(error.mock.calls.some((c) => c.some((a) => String(a).includes("same key")))).toBe(false);
    error.mockRestore();
  });

  it("drops malformed entries (missing range, null range, NaN) and dev-warns each", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    let storeApi: PresenceStoreApi | null = null;
    // store-level validation happens BEFORE any grid view, so no provider/body is needed (the hook
    // itself is provider-independent by design)
    function Harness() {
      const presence = useDataGridPresence();
      setPresenceHighlights = presence.setPresenceHighlights;
      storeApi = presence.storeApi;
      return null;
    }

    render(<Harness />);
    act(() => {
      setPresenceHighlights!([
        { id: "u1", color: "#f00" } as unknown as PresenceHighlightEntry,
        { id: "u1", color: "#f00", range: null as unknown as GridRect },
        { id: "u1", color: "#f00", range: { x: 0, y: Number.NaN, width: 1, height: 1 } },
      ]);
    });

    expect(storeApi!.getState().highlights).toHaveLength(0);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("range")).length).toBe(3);
    warn.mockRestore();
  });

  it("does not misroute a rowId entry with a null rowId to the rowId path (dropped as malformed, dev-warned)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    let storeApi: PresenceStoreApi | null = null;
    function Harness() {
      const presence = useDataGridPresence();
      setPresenceHighlights = presence.setPresenceHighlights;
      storeApi = presence.storeApi;
      return null;
    }

    render(<Harness />);
    act(() => {
      setPresenceHighlights!([{ id: "u1", color: "#f00", rowId: null as unknown as string, columnId: "qty" }]);
    });

    expect(storeApi!.getState().highlights).toHaveLength(0);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("range")).length).toBe(1);
    warn.mockRestore();
  });

  it("drops a rowId-native entry whose column is hidden and dev-warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    let actionsRef: ReturnType<typeof useDataGridActions> | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence();
      setPresenceHighlights = setHighlights;
      return (
        <DataGridProvider data={makeRows(5)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
          <ActionsCapture onReady={(actions) => (actionsRef = actions)} />
          <DataGridRoot>
            <DataGridHeader />
            <DataGridBody />
          </DataGridRoot>
        </DataGridProvider>
      );
    }

    render(<Harness />);
    act(() => {
      actionsRef!.setColumnHidden("qty", true);
    });
    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowId: "1", columnId: "qty" }]);
    });

    expect(document.querySelector(gridAttrSelector("presenceOverlay"))).toBeNull();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("qty")).length).toBe(1);
    warn.mockRestore();
  });
});

/** Captures `actions` from inside the provider tree — used to drive filter changes for the rowId-filtered-out test. */
function ActionsCapture({ onReady }: { onReady: (actions: ReturnType<typeof useDataGridActions>) => void }) {
  onReady(useDataGridActions());
  return null;
}
