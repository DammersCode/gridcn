import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRef, type ReactNode } from "react";
import {
  CompactSelection,
  cellTypes,
  DataGridProvider,
  useDataGridActions,
  type ColumnDef,
  type DataChange,
  type DataGridSyncProps,
  type GridRect,
  type GridSelection,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  type BulkResolution,
  type InteractionLayout,
  type DataGridStoreState,
} from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { getInternalActions, useDataGridStoreApi as useRawStoreApi } from "@/registry/default/blocks/data-grid/store";
import { lookupCellType } from "@/registry/default/blocks/data-grid-lookup/lookup-cell-type";
import type { LookupValue } from "@/registry/default/blocks/data-grid-lookup/lookup-model";
import { createFillStore } from "./fill-store";
import { buildFillWrites, readRectAsText, useFillHandle, type UseFillHandleOptions } from "./use-fill-handle";
import { viewIndexes } from "@/registry/default/blocks/data-grid/types";

/** Asserts the sync contract while calling: a sync-only column set must never return a Promise. */
function syncResolution(resolution: BulkResolution | Promise<BulkResolution>): BulkResolution {
  if (resolution instanceof Promise) throw new Error("expected a synchronous result");
  return resolution;
}

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
  it("rejects a cell whose cell type's fromText throws instead of aborting the fill", () => {
    const throwingNumber = { ...cellTypes["number"], fromText: () => { throw new Error("boom"); } };
    const s = fakeState({ cellTypes: { ...cellTypes, number: throwingNumber } });
    const { resolution } = buildFillWrites(s, { x: 1, y: 0, width: 1, height: 2 }, { x: 1, y: 2, width: 1, height: 2 });
    const settled = syncResolution(resolution);
    expect(settled.writes).toEqual([]);
    expect(settled.rejected.map((cell) => cell.viewRowIndex)).toEqual([2, 3]);
  });

  it("extends a detected arithmetic series downward", () => {
    const s = fakeState();
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 }; // qty column, "2","4"
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 };
    const { resolution, filled } = buildFillWrites(s, source, strip);
    expect(syncResolution(resolution).writes).toEqual([
      { viewRowIndex: 2, columnId: "qty", value: 6 },
      { viewRowIndex: 3, columnId: "qty", value: 8 },
    ]);
    expect(filled).toEqual([["6"], ["8"]]);
  });

  it("forceCopy (Alt-drag) tiles the source instead of extrapolating a series", () => {
    const s = fakeState();
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 };
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 };
    const { resolution } = buildFillWrites(s, source, strip, { forceCopy: true });
    expect(syncResolution(resolution).writes).toEqual([
      { viewRowIndex: 2, columnId: "qty", value: 2 },
      { viewRowIndex: 3, columnId: "qty", value: 4 },
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
    const { resolution } = buildFillWrites(s, source, strip);
    expect(syncResolution(resolution).writes).toEqual([
      { viewRowIndex: 0, columnId: "b", value: "x" },
      { viewRowIndex: 0, columnId: "c", value: "x" },
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
    expect(syncResolution(buildFillWrites(s, source, strip).resolution).writes).toEqual([]);
  });

  it("skips a computed column that has no write path, without validating it", () => {
    const computed: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "double", header: "Double", accessorFn: (r: Row) => (r.qty ?? 0) * 2, type: "number", validate: () => "never valid" },
    ];
    const s = fakeState({ columns: computed, visibleColumns: computed });
    const settled = syncResolution(buildFillWrites(s, { x: 1, y: 0, width: 1, height: 2 }, { x: 1, y: 2, width: 1, height: 1 }).resolution);
    expect({ writes: settled.writes, rejected: settled.rejected }).toEqual({ writes: [], rejected: [] });
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
    const settled = syncResolution(buildFillWrites(s, source, strip).resolution);
    expect(settled.writes).toEqual([]);
    expect(settled.rejected).toEqual([
      { rowId: "3", viewRowIndex: 2, columnId: "qty", value: 6, message: "too big" },
      { rowId: "4", viewRowIndex: 3, columnId: "qty", value: 8, message: "too big" },
    ]);
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
    expect(syncResolution(buildFillWrites(s, source, strip).resolution).writes).toEqual([{ viewRowIndex: 0, columnId: "c2", value: "6" }]);
  });
});

describe("buildFillWrites over a closed value set (select)", () => {
  type TierRow = { id: string; tier: string | null };
  const tierColumns: readonly ColumnDef<TierRow, unknown>[] = [
    {
      id: "tier",
      header: "Tier",
      accessorKey: "tier",
      type: "select",
      options: {
        choices: [
          { value: "t1", label: "Tier 1" },
          { value: "t2", label: "Tier 2" },
        ],
      },
    },
  ];
  function tierState(values: (string | null)[]): DataGridStoreState {
    const data = values.map((tier, i) => ({ id: String(i), tier }));
    return fakeState({ data, columns: tierColumns, visibleColumns: tierColumns });
  }

  it("copies the stored values when the label series continues past the last choice", () => {
    const s = tierState(["t1", "t2", "t2", null]);
    const { resolution } = buildFillWrites(s, { x: 0, y: 0, width: 1, height: 2 }, { x: 0, y: 2, width: 1, height: 2 });
    expect(syncResolution(resolution).writes).toEqual([
      { viewRowIndex: 2, columnId: "tier", value: "t1" },
      { viewRowIndex: 3, columnId: "tier", value: "t2" },
    ]);
  });

  it("copies a stored value that has no choice", () => {
    const s = tierState(["orphan", "x"]);
    const { resolution } = buildFillWrites(s, { x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 1, width: 1, height: 1 });
    expect(syncResolution(resolution).writes).toEqual([{ viewRowIndex: 1, columnId: "tier", value: "orphan" }]);
  });

  it("copies upward from the far edge of the source", () => {
    const s = tierState([null, "t1", "t2"]);
    const { resolution } = buildFillWrites(s, { x: 0, y: 1, width: 1, height: 2 }, { x: 0, y: 0, width: 1, height: 1 });
    expect(syncResolution(resolution).writes).toEqual([{ viewRowIndex: 0, columnId: "tier", value: "t2" }]);
  });
});

describe("buildFillWrites applies a series only when every generated value fits the column", () => {
  type GridRow = { id: string; [key: string]: unknown };
  const stripAt = (y: number, height: number, x = 0, width = 1): GridRect => ({ x, y, width, height });
  const stateOf = (cols: readonly ColumnDef<GridRow, unknown>[], data: GridRow[], types: Record<string, unknown> = {}) =>
    fakeState({ data, columns: cols, visibleColumns: cols, cellTypes: { ...cellTypes, ...types } });
  const values = (state: DataGridStoreState, source: GridRect, strip: GridRect) =>
    syncResolution(buildFillWrites(state, source, strip).resolution).writes.map((write) => write.value);

  const tierChoices = [
    { value: "t1", label: "Tier 1" },
    { value: "t2", label: "Tier 2" },
    { value: "t3", label: "Tier 3" },
  ];
  const tierColumn: ColumnDef<GridRow, unknown> = { id: "tier", header: "Tier", accessorKey: "tier", type: "select", options: { choices: tierChoices } };

  it("copies the whole run of a select column when a later label is no choice, not only that cell", () => {
    const s = stateOf([tierColumn], ["t1", "t2", null, null, null].map((tier, i) => ({ id: String(i), tier })));
    expect(values(s, stripAt(0, 2), stripAt(2, 3))).toEqual(["t1", "t2", "t1"]);
  });

  it("continues a select series while every label is a choice", () => {
    const s = stateOf([{ ...tierColumn, options: { choices: [...tierChoices, { value: "t4", label: "Tier 4" }] } }], ["t1", "t2", null, null].map((tier, i) => ({ id: String(i), tier })));
    expect(values(s, stripAt(0, 2), stripAt(2, 2))).toEqual(["t3", "t4"]);
  });

  it("copies the whole run of a date column when one date is invalid", () => {
    const dateColumn: ColumnDef<GridRow, unknown> = { id: "due", header: "Due", accessorKey: "due", type: "date" };
    const s = stateOf([dateColumn], ["2026-01-29", "2026-01-30", null, null].map((due, i) => ({ id: String(i), due })));
    const written = values(s, stripAt(0, 2), stripAt(2, 2));
    expect(written).toEqual(["2026-01-29", "2026-01-30"]);
  });

  it("continues number and text series", () => {
    const cols: readonly ColumnDef<GridRow, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
    ];
    const s = stateOf(cols, [
      { id: "1", name: "Item 1", qty: 1 },
      { id: "2", name: "Item 2", qty: 2 },
      { id: "3", name: "", qty: null },
      { id: "4", name: "", qty: null },
    ]);
    expect(values(s, stripAt(0, 2, 0, 2), stripAt(2, 2, 0, 2))).toEqual(["Item 3", 3, "Item 4", 4]);
  });

  it("rejects a select label in another select column that lacks the choice and keeps that cell", () => {
    const status = (id: string, choices: { value: string; label: string }[]): ColumnDef<GridRow, unknown> => ({ id, header: id, accessorKey: id, type: "select", options: { choices } });
    const cols = [status("a", [{ value: "open", label: "Open" }]), status("b", [{ value: "low", label: "Low" }]), status("c", [{ value: "c-open", label: "Open" }])];
    const s = stateOf(cols, [{ id: "1", a: "open", b: null, c: null }]);
    expect(values(s, { x: 0, y: 0, width: 1, height: 1 }, { x: 1, y: 0, width: 2, height: 1 })).toEqual(["c-open"]);
  });

  describe("lookup column", () => {
    const lookupColumn = (unresolvedPaste?: "keep"): ColumnDef<GridRow, unknown> => ({
      id: "store",
      header: "Store",
      accessorKey: "store",
      type: "lookup",
      options: { fetchOptions: async () => [], ...(unresolvedPaste ? { unresolvedPaste } : {}) },
    });
    const stores = (...list: LookupValue[]) => [...list, null, null].map((store, i) => ({ id: String(i), store }));
    const a: LookupValue = { value: "a", label: "Store 1" };
    const b: LookupValue = { value: "b", label: "Store 1" };
    const s1: LookupValue = { value: "s1", label: "Store 1" };
    const s2: LookupValue = { value: "s2", label: "Store 2" };
    const types = { lookup: lookupCellType };

    it("copies a label that two options share, by default", () => {
      const s = stateOf([lookupColumn()], stores(a, b), types);
      expect(values(s, stripAt(0, 2), stripAt(2, 2))).toEqual([a, b]);
    });

    it("copies a label that two options share with unresolvedPaste keep", () => {
      const s = stateOf([lookupColumn("keep")], stores(a, b), types);
      expect(values(s, stripAt(0, 2), stripAt(2, 2))).toEqual([a, b]);
    });

    it("copies Store 1 and Store 2 by default, because the next labels resolve to nothing", () => {
      const s = stateOf([lookupColumn()], stores(s1, s2), types);
      expect(values(s, stripAt(0, 2), stripAt(2, 2))).toEqual([s1, s2]);
    });

    it("continues the series as bare keys with unresolvedPaste keep", () => {
      const s = stateOf([lookupColumn("keep")], stores(s1, s2), types);
      expect(values(s, stripAt(0, 2), stripAt(2, 2))).toEqual([
        { value: "Store 3", label: "" },
        { value: "Store 4", label: "" },
      ]);
    });

    it("rejects the option of one lookup column in another lookup column and keeps that cell", () => {
      const supplier: ColumnDef<GridRow, unknown> = { id: "supplier", header: "Supplier", accessorKey: "supplier", type: "lookup", options: { fetchOptions: async () => [] } };
      const s = stateOf([lookupColumn(), supplier], [{ id: "1", store: s1, supplier: null }], types);
      expect(values(s, { x: 0, y: 0, width: 1, height: 1 }, { x: 1, y: 0, width: 1, height: 1 })).toEqual([]);
    });
  });
});

describe("buildFillWrites over a lazy (sparse) grid", () => {
  it("skips unloaded rows and dev-warns once per fill", () => {
    const warn = vi.spyOn(console, "warn");
    // 4-row sparse data: rows 0-1 loaded, rows 2-3 are holes (undefined)
    const sparse: Row[] = new Array(4);
    sparse[0] = { id: "1", name: "a", qty: 2 };
    sparse[1] = { id: "2", name: "b", qty: 4 };
    // viewIndex spans the full length (holes included), as the scroll-mode store does
    const s = fakeState({ data: sparse, viewIndex: [0, 1, 2, 3] });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 }; // qty column, "2","4"
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 }; // both rows are holes
    const { resolution } = buildFillWrites(s, source, strip);
    expect(syncResolution(resolution).writes).toEqual([]);
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

  it("holds the writes as a Promise while `filled` stays available synchronously for processFill", async () => {
    const s = fakeState({ columns: asyncColumns as never, visibleColumns: asyncColumns as never });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 2 };
    const strip: GridRect = { x: 1, y: 2, width: 1, height: 2 };
    const { resolution, filled } = buildFillWrites(s, source, strip);

    expect(filled).toEqual([["6"], ["8"]]); // the 2,4 series continues, before any validation
    expect(resolution).toBeInstanceOf(Promise);
    // both continued values exceed the schema's limit, so the batch resolves to nothing rejected
    await expect(resolution).resolves.toEqual({
      writes: [],
      rejected: [
        { rowId: "3", viewRowIndex: 2, columnId: "qty", value: 6, message: "too big" },
        { rowId: "4", viewRowIndex: 3, columnId: "qty", value: 8, message: "too big" },
      ],
      warnings: [],
    });
  });

  it("commits only the cells that pass", async () => {
    const s = fakeState({ columns: asyncColumns as never, visibleColumns: asyncColumns as never });
    const source: GridRect = { x: 1, y: 0, width: 1, height: 1 };
    const strip: GridRect = { x: 1, y: 1, width: 1, height: 3 };
    const { resolution } = buildFillWrites(s, source, strip, { forceCopy: true });
    // forceCopy tiles the source value 2 down the strip; 2 passes the "> 5" check every time.
    // a HELD batch carries rowId so the apply can re-resolve its view position after a reorder (#90)
    await expect(resolution).resolves.toEqual({
      writes: [
        { viewRowIndex: 1, columnId: "qty", value: 2, rowId: "2" },
        { viewRowIndex: 2, columnId: "qty", value: 2, rowId: "3" },
        { viewRowIndex: 3, columnId: "qty", value: 2, rowId: "4" },
      ],
      rejected: [],
      warnings: [],
    });
  });

  it("a fill that touches only sync columns stays synchronous", () => {
    const s = fakeState({ columns: asyncColumns as never, visibleColumns: asyncColumns as never });
    const source: GridRect = { x: 0, y: 0, width: 1, height: 1 };
    const strip: GridRect = { x: 0, y: 1, width: 1, height: 1 };
    expect(buildFillWrites(s, source, strip).resolution).not.toBeInstanceOf(Promise);
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

  function makeWrapper(columns: readonly ColumnDef<Row, unknown>[], overrides: Partial<DataGridSyncProps<Row>> = {}) {
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
  function setUpFill(wrapper: ReturnType<typeof makeWrapper>, processFill?: UseFillHandleOptions["processFill"]) {
    const { result } = renderHook(
      () => {
        const actions = useDataGridActions();
        const storeApi = useRawStoreApi();
        const internal = getInternalActions(storeApi);
        const scrollRef = useRef<HTMLElement | null>(null);
        const fill = useFillHandle({
          scrollRef,
          layout: {} as InteractionLayout,
          fillStore: createFillStore(),
          processFill,
        });
        return { actions, storeApi, internal, fill };
      },
      { wrapper },
    );
    act(() => {
      result.current.actions.selectCellAt({ col: 1, row: 0 }); // qty, row 0
      result.current.actions.extendToAt({ col: 1, row: 1 }); // qty, row 1 — source row 0, strip row 1
    });
    return result;
  }

  /** Lets every queued microtask drain, which is all a held batch needs to resolve. */
  const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

  it("fires onValidationError with source fill after the accepted cells apply", () => {
    const order: string[] = [];
    const onDataChange = vi.fn(() => order.push("data"));
    const onValidationError = vi.fn(() => order.push("validation"));
    const rowAwareColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: (_value, row) => (row.id === "3" ? "row 3 is locked" : null) },
    ];
    const result = setUpFill(makeWrapper(rowAwareColumns, { onDataChange, onValidationError }));
    act(() => result.current.actions.extendToAt({ col: 1, row: 2 }));

    act(() => result.current.fill.fillDown());

    expect(order).toEqual(["data", "validation"]);
    expect(onValidationError).toHaveBeenCalledWith({
      source: "fill",
      rejected: [{ rowId: "3", columnId: "qty", viewRowIndex: 2, value: 2, message: "row 3 is locked" }],
    });
  });

  it("rejects a fill value through the cell type's validate when the column declares none", () => {
    const onValidationError = vi.fn();
    const typedColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "noTwos" as never },
    ];
    const noTwos = { ...cellTypes.number, validate: (value: unknown) => (value === 2 ? "no twos" : null) };
    const result = setUpFill(makeWrapper(typedColumns, { onValidationError, cellTypes: { noTwos } as never }));

    act(() => result.current.fill.fillDown());

    expect(onValidationError).toHaveBeenCalledWith({
      source: "fill",
      rejected: [{ rowId: "2", columnId: "qty", viewRowIndex: 1, value: 2, message: "no twos" }],
    });
  });

  it("fires onValidationError with source fill once a held fill settles", async () => {
    const onValidationError = vi.fn();
    const rejectingColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "qty",
        header: "Qty",
        accessorKey: "qty",
        type: "number",
        validate: { "~standard": { version: 1, vendor: "mock", validate: async () => ({ issues: [{ message: "bad" }] }) } } as never,
      },
    ];
    const result = setUpFill(makeWrapper(rejectingColumns, { onValidationError }));

    act(() => result.current.fill.fillDown());
    expect(onValidationError).not.toHaveBeenCalled();
    await settle();

    expect(onValidationError).toHaveBeenCalledWith({
      source: "fill",
      rejected: [{ rowId: "2", columnId: "qty", viewRowIndex: 1, value: 2, message: "bad" }],
    });
  });

  it("processFill returning false vetoes the fill and keeps the selection", () => {
    const onDataChange = vi.fn();
    const result = setUpFill(makeWrapper(columns, { onDataChange }), () => false);
    act(() => result.current.fill.fillDown());
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it("processFill can rewrite the values that the fill parses and writes", () => {
    const onDataChange = vi.fn();
    const result = setUpFill(makeWrapper(columns, { onDataChange }), ({ cells }) => cells.map((row) => row.map(() => "99")));
    act(() => result.current.fill.fillDown());
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange.mock.calls[0]![1].ops).toEqual([expect.objectContaining({ rowId: "2", cells: [expect.objectContaining({ columnId: "qty", value: 99 })] })]);
  });

  it("drops a held fill and its rejections when the grid turns read-only before it settles", async () => {
    const onDataChange = vi.fn();
    const onValidationError = vi.fn();
    let reject!: () => void;
    const gate = new Promise<{ issues: { message: string }[] }>((resolve) => (reject = () => resolve({ issues: [{ message: "bad" }] })));
    const rejectingColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: { "~standard": { version: 1, vendor: "mock", validate: () => gate } } as never },
    ];
    const result = setUpFill(makeWrapper(rejectingColumns, { onDataChange, onValidationError }));

    act(() => result.current.fill.fillDown());
    act(() => result.current.storeApi.setState({ readOnly: true }));
    reject();
    await settle();

    expect(onDataChange).not.toHaveBeenCalled();
    expect(onValidationError).not.toHaveBeenCalled();
  });

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
    act(() => result.current.actions.deleteRowsAt(viewIndexes([1])));
    release(2);
    await settle();

    // deleteRows itself fires one onDataChange (the row-operation); the held fill must NOT add a second.
    expect(onDataChange).toHaveBeenCalledTimes(1);
    const [, change] = onDataChange.mock.calls[0] as [readonly Row[], DataChange<Row>];
    expect(change.source).toBe("row-operation");
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
      result.current.internal._syncProps({
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
          processFill: ({ cells }) => cells,
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
      result.current.actions.selectCellAt({ col: 1, row: 0 });
      result.current.actions.extendToAt({ col: 1, row: 1 });
    });
    act(() => result.current.fill.fillDown());

    expect(result.current.fill.fillDown).toBe(firstFillDown);
    expect(detectCalls).toEqual(["second"]);
  });
});