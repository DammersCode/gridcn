import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRef, type ReactNode } from "react";
import {
  CompactSelection,
  cellTypes,
  DataGridProvider,
  useDataGridActions,
  useDataGridStoreApi,
  type ColumnDef,
  type DataChange,
  type DataGridProviderProps,
  type DataGridStoreState,
  type GridRect,
  type GridSelection,
  type InteractionLayout,
} from "@/registry/default/blocks/data-grid/data-grid";
import { createFillStore } from "./fill-store";
import { buildFillWrites, readRectAsText, useFillHandle } from "./use-fill-handle";

/** A fresh 1x1 selection anchored at `coord` — inlined (not imported) since `selectCell` is core-internal (selection/select-cell.ts), not part of the public barrel. */
function selectCellPure(coord: { col: number; row: number }): GridSelection {
  return {
    current: { cell: coord, range: { x: coord.col, y: coord.row, width: 1, height: 1 }, rangeStack: [] },
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  };
}

type Row = { id: string; name: string; qty: number | null };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "a", qty: 2 },
    { id: "2", name: "b", qty: 4 },
    { id: "3", name: "c", qty: null },
    { id: "4", name: "d", qty: null },
  ];
}

/** Minimal fake store state — the fill helpers only read data/viewIndex/visibleColumns/cellTypes. */
function fakeState(overrides: Record<string, unknown> = {}): DataGridStoreState {
  const data = (overrides["data"] as Row[] | undefined) ?? rows();
  return {
    data,
    columns,
    visibleColumns: columns,
    viewIndex: data.map((_, i) => i),
    getRowId: (r: Row) => r.id,
    cellTypes: cellTypes as unknown as DataGridStoreState["cellTypes"],
    selection: selectCellPure({ col: 1, row: 0 }),
    ...overrides,
  } as unknown as DataGridStoreState;
}

describe("readRectAsText", () => {
  it("serializes a rect via each column's toText", () => {
    const s = fakeState();
    expect(readRectAsText(s, { x: 1, y: 0, width: 1, height: 2 })).toEqual([["2"], ["4"]]);
  });
});

describe("buildFillWrites", () => {
  it("extends a detected arithmetic series downward", () => {
    const s = fakeState();
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 }; // qty column, "2","4"
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 };
    const { writes, filled } = buildFillWrites(s, source, strip);
    expect(writes).toEqual([
      { viewRow: 2, columnId: "qty", value: 6 },
      { viewRow: 3, columnId: "qty", value: 8 },
    ]);
    expect(filled).toEqual([["6"], ["8"]]);
  });

  it("forceCopy (Alt-drag) tiles the source instead of extrapolating a series", () => {
    const s = fakeState();
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 };
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 };
    const { writes } = buildFillWrites(s, source, strip, { forceCopy: true });
    expect(writes).toEqual([
      { viewRow: 2, columnId: "qty", value: 2 },
      { viewRow: 3, columnId: "qty", value: 4 },
    ]);
  });

  it("fills rightward converting text back through the destination column's fromText", () => {
    const data: Row[] = [{ id: "1", name: "x", qty: 3 }];
    const wideColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "a", header: "A", accessorKey: "name" },
      { id: "b", header: "B", accessorKey: "name" },
      { id: "c", header: "C", accessorKey: "name" },
    ];
    const s = fakeState({ data, columns: wideColumns, visibleColumns: wideColumns });
    // single source cell "x" tiles rightward (no series on non-numeric single value)
    const source: GridRect = { x: 0, y: 0, width: 1, height: 1 };
    const strip: GridRect = { x: 1, y: 0, width: 2, height: 1 };
    const { writes } = buildFillWrites(s, source, strip);
    expect(writes).toEqual([
      { viewRow: 0, columnId: "b", value: "x" },
      { viewRow: 0, columnId: "c", value: "x" },
    ]);
  });

  it("skips a readOnly destination column", () => {
    const roColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", readOnly: true },
    ];
    const s = fakeState({ columns: roColumns, visibleColumns: roColumns });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 };
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 1 };
    expect(buildFillWrites(s, source, strip).writes).toEqual([]);
  });

  it("skips a destination value rejected by validate", () => {
    const validated: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "qty",
        header: "Qty",
        accessorKey: "qty",
        type: "number",
        validate: (value) => (typeof value === "number" && value > 5 ? "too big" : null),
      },
    ];
    const s = fakeState({ columns: validated, visibleColumns: validated });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 }; // "2","4"
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 }; // would extrapolate to 6, 8 — both rejected
    expect(buildFillWrites(s, source, strip).writes).toEqual([]);
  });

  it("extends a horizontal series rightward", () => {
    type WideRow = { id: string; c0: string; c1: string; c2: string };
    const wideColumns: readonly ColumnDef<WideRow, unknown>[] = [
      { id: "c0", header: "C0", accessorKey: "c0" },
      { id: "c1", header: "C1", accessorKey: "c1" },
      { id: "c2", header: "C2", accessorKey: "c2" },
    ];
    const data: WideRow[] = [{ id: "1", c0: "2", c1: "4", c2: "" }];
    const s = fakeState({ data: data as unknown as Row[], columns: wideColumns as never, visibleColumns: wideColumns as never });
    const source: GridRect = { x: 0, y: 0, width: 2, height: 1 };
    const strip: GridRect = { x: 2, y: 0, width: 1, height: 1 };
    expect(buildFillWrites(s, source, strip).writes).toEqual([{ viewRow: 0, columnId: "c2", value: "6" }]);
  });
});

describe("buildFillWrites over a lazy (sparse) grid", () => {
  it("skips unloaded rows and dev-warns once per fill", () => {
    const warn = vi.spyOn(console, "warn");
    // 4-row sparse data: rows 0-1 loaded, rows 2-3 are holes (undefined)
    const sparse: Row[] = new Array(4);
    sparse[0] = { id: "1", name: "a", qty: 2 };
    sparse[1] = { id: "2", name: "b", qty: 4 };
    // viewIndex spans the full length (holes included), as the lazy hook's store does
    const s = fakeState({ data: sparse, viewIndex: [0, 1, 2, 3] });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 }; // qty column, "2","4"
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 }; // both rows are holes
    const { writes } = buildFillWrites(s, source, strip);
    expect(writes).toEqual([]);
    // one warn per fill gesture, not one per skipped cell
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("buildFillWrites with an async schema", () => {
  const asyncQty = {
    "~standard": {
      version: 1,
      vendor: "mock",
      validate: async (value: unknown) =>
        typeof value === "number" && value > 5 ? { issues: [{ message: "too big" }] } : { value },
    },
  };

  const asyncColumns: readonly ColumnDef<Row, unknown>[] = [
    { id: "name", header: "Name", accessorKey: "name" },
    { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: asyncQty as never },
  ];

  it("holds the writes as a Promise while `filled` stays available synchronously for onFill", async () => {
    const s = fakeState({ columns: asyncColumns as never, visibleColumns: asyncColumns as never });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 };
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 };
    const { writes, filled } = buildFillWrites(s, source, strip);

    expect(filled).toEqual([["6"], ["8"]]); // the 2,4 series continues, before any validation
    expect(writes).toBeInstanceOf(Promise);
    // both continued values exceed the schema's limit, so the batch resolves to nothing
    await expect(writes).resolves.toEqual([]);
  });

  it("commits only the cells that pass", async () => {
    const s = fakeState({ columns: asyncColumns as never, visibleColumns: asyncColumns as never });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 1 };
    const strip: GridRect = { x: 1, y: 1, width: 1, height: 3 };
    const { writes } = buildFillWrites(s, source, strip, { forceCopy: true });
    // forceCopy tiles the source value 2 down the strip; 2 passes the "> 5" check every time.
    // a HELD batch carries rowId so the apply can re-resolve its view position after a reorder (#90)
    await expect(writes).resolves.toEqual([
      { viewRow: 1, columnId: "qty", value: 2, rowId: "2" },
      { viewRow: 2, columnId: "qty", value: 2, rowId: "3" },
      { viewRow: 3, columnId: "qty", value: 2, rowId: "4" },
    ]);
  });

  it("a fill that touches only sync columns stays synchronous", () => {
    const s = fakeState({ columns: asyncColumns as never, visibleColumns: asyncColumns as never });
    const source: GridRect = { x: 0, y: 0, width: 1, height: 1 };
    const strip: GridRect = { x: 0, y: 1, width: 1, height: 1 };
    expect(buildFillWrites(s, source, strip).writes).not.toBeInstanceOf(Promise);
  });
});

describe("useFillHandle staleness guard — async fill held against a real store", () => {
  /** A `qty` schema validator whose resolution the test controls, so a mutation can land while the batch is genuinely still in flight. */
  function heldSchema() {
    let resolveFn!: (result: { value: unknown }) => void;
    const gate = new Promise<{ value: unknown }>((resolve) => (resolveFn = resolve));
    const columns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "qty",
        header: "Qty",
        accessorKey: "qty",
        type: "number",
        validate: { "~standard": { version: 1, vendor: "mock", validate: () => gate } } as never,
      },
    ];
    return { columns, release: (value: unknown) => resolveFn({ value }) };
  }

  function makeWrapper(columns: readonly ColumnDef<Row, unknown>[], overrides: Partial<DataGridProviderProps<Row>> = {}) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <DataGridProvider data={rows()} columns={columns} getRowId={(r) => r.id} {...overrides}>
          {children}
        </DataGridProvider>
      );
    };
  }

  /**
   * Mounts `useFillHandle` off the same store as `useDataGridActions`/`useDataGridStoreApi` (one
   * `DataGridProvider`, like `use-data-grid-clipboard.test.tsx`'s `setUpGrid`). Selects a 2-row
   * range in the `qty` column so `fillDown` has a source (row 0) and a one-row strip (row 1) to
   * fill; `scrollRef`/`layout` are unused by `fillDown`/`fillRight` (only the pointer-drag path
   * reads them), so they're stubbed.
   */
  function setUpFill(wrapper: ReturnType<typeof makeWrapper>) {
    const { result } = renderHook(
      () => {
        const actions = useDataGridActions();
        const storeApi = useDataGridStoreApi();
        const scrollRef = useRef<HTMLElement | null>(null);
        const fill = useFillHandle({
          scrollRef,
          layout: {} as InteractionLayout,
          fillStore: createFillStore(),
        });
        return { actions, storeApi, fill };
      },
      { wrapper },
    );
    act(() => {
      result.current.actions.selectCell({ col: 1, row: 0 }); // qty, row 0
      result.current.actions.extendTo({ col: 1, row: 1 }); // qty, row 1 — source row 0, strip row 1
    });
    return result;
  }

  /** Lets every queued microtask drain, which is all a held batch needs to resolve. */
  const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

  it("drops a held fill when the sort changes before it settles", async () => {
    const onDataChange = vi.fn();
    const { columns: heldColumns, release } = heldSchema();
    const wrapper = makeWrapper(heldColumns, { onDataChange });
    const result = setUpFill(wrapper);

    act(() => result.current.fill.fillDown());
    act(() => result.current.actions.setSorts([{ columnId: "name", direction: "asc" }]));
    release(2);
    await settle();

    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("drops a held fill when its target row is deleted before it settles", async () => {
    const onDataChange = vi.fn();
    const { columns: heldColumns, release } = heldSchema();
    const wrapper = makeWrapper(heldColumns, { onDataChange });
    const result = setUpFill(wrapper);

    // strip is view row 1 ({ id: "2", name: "b" }) — delete it out from under the held fill.
    act(() => result.current.fill.fillDown());
    act(() => result.current.actions.deleteRows([1]));
    release(2);
    await settle();

    // deleteRows itself fires one onDataChange (the row-op); the held fill must NOT add a second.
    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("row-op");
  });

  it("commits a held fill onto the row id it targeted after a pure reorder", async () => {
    const onDataChange = vi.fn();
    const { columns: heldColumns, release } = heldSchema();
    const reordered = [rows()[1]!, rows()[0]!, rows()[2]!, rows()[3]!]; // same ids, new order
    const wrapper = makeWrapper(heldColumns, { onDataChange });
    const result = setUpFill(wrapper);

    // source is row 0 (id "1", qty 2), strip targets row 1 (id "2", qty 4 -> overwritten by fill).
    act(() => result.current.fill.fillDown());
    act(() =>
      result.current.storeApi.getState().actions._syncProps({
        data: reordered,
        columns: heldColumns as never,
        getRowId: ((r: Row) => r.id) as never,
      }),
    );
    release(99);
    await settle();

    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [next, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("fill");
    expect(next.find((r) => r.id === "2")!.qty).toBe(99);
    expect(next.find((r) => r.id === "1")!.qty).toBe(2); // the row that moved into view row 1 is untouched
  });
});

describe("useFillHandle callback identity", () => {
  it("keeps fillDown stable across inline callbacks and calls the latest detectSeries", () => {
    const data = rows();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataGridProvider data={data} columns={columns} getRowId={(r) => r.id}>
        {children}
      </DataGridProvider>
    );
    const detectCalls: string[] = [];
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) => {
        const actions = useDataGridActions();
        const scrollRef = useRef<HTMLElement | null>(null);
        const fill = useFillHandle({
          scrollRef,
          layout: {} as InteractionLayout,
          fillStore: createFillStore(),
          onFill: () => {},
          detectSeries: () => {
            detectCalls.push(tag);
            return null;
          },
        });
        return { actions, fill };
      },
      { wrapper, initialProps: { tag: "first" } },
    );
    const firstFillDown = result.current.fill.fillDown;

    rerender({ tag: "second" });
    act(() => {
      result.current.actions.selectCell({ col: 1, row: 0 });
      result.current.actions.extendTo({ col: 1, row: 1 });
    });
    act(() => result.current.fill.fillDown());

    expect(result.current.fill.fillDown).toBe(firstFillDown);
    expect(detectCalls).toEqual(["second"]);
  });
});