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
import { MAX_RESOLVED_RECTS, resolveHighlights } from "../presence-overlay";
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
 * Zero-cell-render presence probe: presence lives entirely in this add-on's own store, so
 * `setPresenceHighlights` must not touch core's row/cell subscriptions at all — it's not even the
 * same store instance any more.
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

describe("multiplayer presence: rowId-native range highlight resolution", () => {
  it("paints a rowId-native range at the rows' current view positions", () => {
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
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowIds: ["1", "2"], columnIds: ["name", "qty"], label: "Ada" }]);
    });

    const overlays = document.querySelectorAll<HTMLElement>(gridAttrSelector("presenceOverlay"));
    expect(overlays.length).toBe(1);
    // rows "1".."2" -> view rows 1..2 (grid lines 2..4), both columns (grid lines 1..3 incl. colOffset)
    expect(overlays[0]!.style.gridRowStart).toBe("2");
    expect(overlays[0]!.style.gridRowEnd).toBe("4");
    expect(overlays[0]!.style.gridColumnStart).toBe("1");
    expect(overlays[0]!.style.gridColumnEnd).toBe("3");
  });

  it("fragments a rowId-native range into one rect per contiguous run when rows are not adjacent in the view", () => {
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
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowIds: ["0", "3"], columnIds: ["name"] }]);
    });

    const overlays = document.querySelectorAll<HTMLElement>(gridAttrSelector("presenceOverlay"));
    expect(overlays.length).toBe(2);
    expect(overlays[0]!.style.gridRowStart).toBe("1"); // view row 0
    expect(overlays[1]!.style.gridRowStart).toBe("4"); // view row 3
  });

  it("drops a rowId-native range entry silently when every row is filtered out of the view", () => {
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
      // every row except "Row 0" is filtered out; the range's rows "1" and "2" are both gone
      actionsRef!.setFilters([{ columnId: "name", operator: "equals", value: "Row 0" }]);
    });
    act(() => {
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowIds: ["1", "2"], columnIds: ["name"] }]);
    });

    expect(document.querySelector(gridAttrSelector("presenceOverlay"))).toBeNull();
  });

  it("drops unknown columnIds and dev-warns once (range form), shrinking the range to the visible columns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowIds: ["0"], columnIds: ["name", "missing"] }]);
    });

    const overlays = document.querySelectorAll<HTMLElement>(gridAttrSelector("presenceOverlay"));
    expect(overlays.length).toBe(1);
    // "missing" dropped -> width 1: grid lines 1..2 (colOffset 1)
    expect(overlays[0]!.style.gridColumnStart).toBe("1");
    expect(overlays[0]!.style.gridColumnEnd).toBe("2");
    // the plugin's once-wrapped callback dev-warns the unresolved column count (unlike the single-cell form's per-column warn)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("user-1")).length).toBe(1);
    warn.mockRestore();
  });

  it("deduplicates repeated rowIds and columnIds before painting", () => {
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
      setPresenceHighlights!([{ id: "user-1", color: "rgb(1,2,3)", rowIds: ["1", "1", "2"], columnIds: ["name", "name"] }]);
    });

    const overlays = document.querySelectorAll<HTMLElement>(gridAttrSelector("presenceOverlay"));
    expect(overlays.length).toBe(1);
    expect(overlays[0]!.style.gridRowEnd).toBe("4"); // rows 1..2, not 1..4
  });

  it("drops a range entry with an empty rowIds or columnIds array and dev-warns (store-level validation)", () => {
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
      setPresenceHighlights!([
        { id: "u1", color: "#f00", rowIds: [], columnIds: ["name"] },
        { id: "u2", color: "#f00", rowIds: ["0"], columnIds: [] },
      ]);
    });

    expect(storeApi!.getState().highlights).toHaveLength(0);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("paint nothing")).length).toBe(2);
    warn.mockRestore();
  });

  it("drops a range entry whose columnIds is not a string array and dev-warns (store-level validation)", () => {
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
      setPresenceHighlights!([{ id: "u1", color: "#f00", rowIds: ["0"], columnIds: "name" } as unknown as PresenceHighlightEntry]);
    });

    expect(storeApi!.getState().highlights).toHaveLength(0);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("columnIds")).length).toBe(1);
    warn.mockRestore();
  });

  it("caps one range entry at MAX_RESOLVED_RECTS fragments and reports the excess", () => {
    // 1200 non-contiguous rows (evens only) x 1 column = 1200 fragments, above the budget
    const rowIds = Array.from({ length: 1200 }, (_, i) => String(i * 2));
    const rowIdToViewRow = new Map<string, number>(rowIds.map((id) => [id, Number(id)]));
    const excess: [string, number, number][] = [];
    const resolved = resolveHighlights(
      [{ id: "u1", color: "#f00", rowIds, columnIds: ["name"] }],
      rowIdToViewRow,
      [{ id: "name" }],
      undefined,
      undefined,
      (entry, kept, total) => excess.push([entry.id, kept, total]),
    );
    expect(resolved).toHaveLength(MAX_RESOLVED_RECTS);
    expect(excess).toEqual([["u1", MAX_RESOLVED_RECTS, 1200]]);
  });

  it("reports unresolved columnIds of a range entry to the plugin's callback (the plugin dev-warns once)", () => {
    const unresolved: [string, number][] = [];
    const resolved = resolveHighlights(
      [{ id: "u1", color: "#f00", rowIds: ["0"], columnIds: ["name", "missing"] }],
      new Map([["0", 0]]),
      [{ id: "name" }],
      undefined,
      (entry, count) => unresolved.push([entry.id, count]),
    );
    expect(resolved).toHaveLength(1);
    expect(unresolved).toEqual([["u1", 1]]);
  });

  it("does not re-render a per-cell subscription when a rowId-native range highlight is set", () => {
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
        <DataGridProvider data={makeRows(5)} columns={columns} getRowId={(r) => r.id} overlayPlugins={[plugin]}>
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
      setPresenceHighlights!([{ id: "user-1", color: "#f00", rowIds: ["0", "1"], columnIds: ["name", "qty"] }]);
    });
    expect(cellRenderCount).toBe(before);
  });
});

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

describe("multiplayer presence: per-entry lifecycle (remove/clear)", () => {
  it("removePresenceHighlight removes only the entry with the given id", () => {
    let api: ReturnType<typeof useDataGridPresence> | null = null;
    function PresenceCapture() {
      api = useDataGridPresence();
      return null;
    }
    render(<PresenceCapture />);
    act(() => {
      api!.setPresenceHighlights([
        { id: "a", color: "#f00", range: { x: 0, y: 0, width: 1, height: 1 } },
        { id: "b", color: "#0f0", range: { x: 1, y: 1, width: 1, height: 1 } },
      ]);
    });
    expect(api!.storeApi.getState().highlights).toHaveLength(2);

    act(() => {
      api!.removePresenceHighlight("a");
    });
    const after = api!.storeApi.getState().highlights;
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe("b");
  });

  it("removePresenceHighlight is a no-op (same list identity) when no entry matches", () => {
    let api: ReturnType<typeof useDataGridPresence> | null = null;
    function PresenceCapture() {
      api = useDataGridPresence();
      return null;
    }
    render(<PresenceCapture />);
    act(() => {
      api!.setPresenceHighlights([{ id: "a", color: "#f00", range: { x: 0, y: 0, width: 1, height: 1 } }]);
    });
    const before = api!.storeApi.getState().highlights;
    act(() => {
      api!.removePresenceHighlight("missing");
    });
    expect(api!.storeApi.getState().highlights).toBe(before);
  });

  it("clearPresenceHighlights removes every entry", () => {
    let api: ReturnType<typeof useDataGridPresence> | null = null;
    function PresenceCapture() {
      api = useDataGridPresence();
      return null;
    }
    render(<PresenceCapture />);
    act(() => {
      api!.setPresenceHighlights([
        { id: "a", color: "#f00", range: { x: 0, y: 0, width: 1, height: 1 } },
        { id: "b", color: "#0f0", range: { x: 1, y: 1, width: 1, height: 1 } },
      ]);
    });
    act(() => {
      api!.clearPresenceHighlights();
    });
    expect(api!.storeApi.getState().highlights).toHaveLength(0);
  });
});

describe("multiplayer presence: rect budget (maxRects / onExcessRects)", () => {
  it("resolveHighlights honors a custom maxRects and reports the excess", () => {
    // scattered view rows (gaps between them) → one run per row: 4 rows × 1 column = 4 fragments
    const rowIdToViewRow = new Map<string, number>([
      ["0", 0],
      ["1", 2],
      ["2", 4],
      ["3", 6],
    ]);
    const visibleColumns = [{ id: "name" }];
    const onExcess = vi.fn();
    const resolved = resolveHighlights(
      [{ id: "big", color: "#f00", rowIds: ["0", "1", "2", "3"], columnIds: ["name"] }],
      rowIdToViewRow,
      visibleColumns,
      undefined,
      undefined,
      onExcess,
      2,
    );
    expect(resolved).toHaveLength(2);
    expect(onExcess).toHaveBeenCalledTimes(1);
    expect(onExcess.mock.calls[0]?.[1]).toBe(2); // kept
    expect(onExcess.mock.calls[0]?.[2]).toBe(4); // total
  });

  it("paints at most 2 rects for a fractional maxRects of 1.5 (>= cap check, not ===)", () => {
    // scattered view rows (gaps between them) → one run per row: 4 rows × 1 column = 4 fragments
    const rowIdToViewRow = new Map<string, number>([
      ["0", 0],
      ["1", 2],
      ["2", 4],
      ["3", 6],
    ]);
    const visibleColumns = [{ id: "name" }];
    const onExcess = vi.fn();
    const resolved = resolveHighlights(
      [{ id: "big", color: "#f00", rowIds: ["0", "1", "2", "3"], columnIds: ["name"] }],
      rowIdToViewRow,
      visibleColumns,
      undefined,
      undefined,
      onExcess,
      1.5,
    );
    expect(resolved).toHaveLength(2);
    expect(onExcess).toHaveBeenCalledTimes(1);
    expect(onExcess.mock.calls[0]?.[2]).toBe(4); // total
  });

  it("defaults to MAX_RESOLVED_RECTS when maxRects is omitted", () => {
    // scattered view rows (a gap between each) → one run per row: exactly the cap, no excess
    const rowIdToViewRow = new Map<string, number>();
    const visibleColumns = [{ id: "name" }];
    const rowIds: string[] = [];
    for (let i = 0; i < MAX_RESOLVED_RECTS; i += 1) {
      rowIdToViewRow.set(String(i), i * 2);
      rowIds.push(String(i));
    }
    const onExcess = vi.fn();
    const resolved = resolveHighlights(
      [{ id: "big", color: "#f00", rowIds, columnIds: ["name"] }],
      rowIdToViewRow,
      visibleColumns,
      undefined,
      undefined,
      onExcess,
    );
    expect(resolved).toHaveLength(MAX_RESOLVED_RECTS);
    expect(onExcess).not.toHaveBeenCalled();
  });

  it("the hook's onExcessRects option is called when a range entry exceeds the budget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onExcess = vi.fn();
    let setPresenceHighlights: ReturnType<typeof useDataGridPresence>["setPresenceHighlights"] | null = null;
    function Harness() {
      const { plugin, setPresenceHighlights: setHighlights } = useDataGridPresence({ maxRects: 1, onExcessRects: onExcess });
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
      // 2 non-contiguous row runs × 1 column run = 2 fragments, budget 1
      setPresenceHighlights!([{ id: "big", color: "#f00", rowIds: ["0", "2"], columnIds: ["name", "qty"] }]);
    });
    expect(onExcess).toHaveBeenCalled();
    expect(onExcess.mock.calls[0]?.[1]).toBe(1); // kept
    expect(onExcess.mock.calls[0]?.[2]).toBe(2); // total
    warn.mockRestore();
  });
});

/** Captures `actions` from inside the provider tree — used to drive filter changes for the rowId-filtered-out test. */
function ActionsCapture({ onReady }: { onReady: (actions: ReturnType<typeof useDataGridActions>) => void }) {
  onReady(useDataGridActions());
  return null;
}
