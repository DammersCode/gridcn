import { describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "../types";
import { cellTypes } from "../cell-types/cell-types";
import { emptySelection, selectCell as selectCellPure } from "../selection";
import { CompactSelection } from "../selection/compact-selection";
import {
  buildPasteWrites as buildPasteWritesRaw,
  pasteText,
  resolveCopyScope,
  resolvePasteTarget,
  serializeCopyScope,
  serializeRect,
  targetHeight,
  tileToHeight,
} from "./use-grid-clipboard";
import type { CellCoord } from "../types";
import type { BulkWrite } from "../validation/validate-batch";
import type { DataGridActions, DataGridStoreState } from "../store";

/** Asserts the sync contract while calling: a sync-only column set must never return a Promise. */
function buildPasteWrites(s: DataGridStoreState, cells: string[][], target: CellCoord): BulkWrite[] {
  const writes = buildPasteWritesRaw(s, cells, target);
  if (writes instanceof Promise) throw new Error("expected a synchronous result");
  return writes;
}

type Row = { id: string; name: string; qty: number | null };

const columns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

const readOnlyColumns: readonly ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name", readOnly: true },
  { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
];

function rows(): Row[] {
  return [
    { id: "1", name: "a", qty: 1 },
    { id: "2", name: "b", qty: 2 },
    { id: "3", name: "c", qty: 3 },
    { id: "4", name: "d", qty: 4 },
  ];
}

/** Minimal fake store state — clipboard helpers only read data/viewIndex/visibleColumns/cellTypes/selection/processX. */
function fakeState(overrides: Partial<DataGridStoreState> = {}): DataGridStoreState {
  const data = overrides.data ?? rows();
  return {
    data,
    columns,
    visibleColumns: columns,
    viewIndex: data.map((_, i) => i),
    getRowId: (r: Row) => r.id,
    cellTypes: cellTypes as unknown as DataGridStoreState["cellTypes"],
    selection: emptySelection(),
    ...overrides,
  } as unknown as DataGridStoreState;
}

describe("resolveCopyScope", () => {
  it("returns the primary range when a range selection exists", () => {
    const s = fakeState({ selection: selectCellPure({ col: 1, row: 0 }) });
    expect(resolveCopyScope(s)).toEqual({ kind: "rect", rect: { x: 1, y: 0, width: 1, height: 1 } });
  });

  it("ignores the range stack — scope is the primary range only", () => {
    const base = selectCellPure({ col: 0, row: 0 });
    const s = fakeState({
      selection: { ...base, current: { ...base.current!, rangeStack: [{ x: 1, y: 1, width: 1, height: 1 }] } },
    });
    expect(resolveCopyScope(s)).toEqual({ kind: "rect", rect: { x: 0, y: 0, width: 1, height: 1 } });
  });

  it("falls back to the selected rows' member list when there is no range", () => {
    const s = fakeState({ selection: { ...emptySelection(), rows: CompactSelection.fromArray([1, 2]) } });
    expect(resolveCopyScope(s)).toEqual({ kind: "rows", rows: [1, 2] });
  });

  it("falls back to the selected columns' member list when there is no range or row selection", () => {
    const s = fakeState({ selection: { ...emptySelection(), columns: CompactSelection.fromArray([1]) } });
    expect(resolveCopyScope(s)).toEqual({ kind: "columns", columns: [1] });
  });

  it("keeps disjoint row members separate, not a min..max bounding range", () => {
    const s = fakeState({ selection: { ...emptySelection(), rows: CompactSelection.fromArray([0, 3]) } });
    expect(resolveCopyScope(s)).toEqual({ kind: "rows", rows: [0, 3] });
  });

  it("returns null when nothing is selected", () => {
    expect(resolveCopyScope(fakeState())).toBeNull();
  });
});

describe("serializeRect", () => {
  it("serializes cells via each column's cell type toText", () => {
    const s = fakeState();
    expect(serializeRect(s, { x: 0, y: 0, width: 2, height: 2 })).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  it("uses processCellForClipboard when provided", () => {
    const s = fakeState({ processCellForClipboard: (value) => `<${String(value)}>` });
    expect(serializeRect(s, { x: 0, y: 0, width: 1, height: 1 })).toEqual([["<a>"]]);
  });
});

describe("serializeCopyScope", () => {
  it("serializes a rect scope like serializeRect", () => {
    const s = fakeState();
    expect(serializeCopyScope(s, { kind: "rect", rect: { x: 0, y: 0, width: 2, height: 1 } })).toEqual([["a", "1"]]);
  });

  it("serializes only the disjoint selected rows, full width, skipping rows in between", () => {
    const s = fakeState({ selection: { ...emptySelection(), rows: CompactSelection.fromArray([0, 3]) } });
    const scope = resolveCopyScope(s)!;
    expect(serializeCopyScope(s, scope)).toEqual([
      ["a", "1"],
      ["d", "4"],
    ]);
  });

  it("serializes only the disjoint selected columns, full height, skipping columns in between", () => {
    const s = fakeState({
      visibleColumns: [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "mid", header: "Mid", accessorKey: "name" },
        { id: "qty", header: "Qty", accessorKey: "qty", type: "number" },
      ] as unknown as DataGridStoreState["visibleColumns"],
      selection: { ...emptySelection(), columns: CompactSelection.fromArray([0, 2]) },
    });
    const scope = resolveCopyScope(s)!;
    expect(serializeCopyScope(s, scope)).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
      ["d", "4"],
    ]);
  });
});

describe("resolvePasteTarget", () => {
  it("uses the top-left of current.range when a range selection exists", () => {
    const base = selectCellPure({ col: 0, row: 0 });
    const s = fakeState({
      selection: { ...base, current: { ...base.current!, range: { x: 1, y: 2, width: 2, height: 2 } } },
      activeCell: null,
    });
    expect(resolvePasteTarget(s)).toEqual({ col: 1, row: 2 });
  });

  it("falls back to the selected column at row 0 when there is no range and no activeCell (header click)", () => {
    const s = fakeState({ selection: { ...emptySelection(), columns: CompactSelection.fromArray([1]) }, activeCell: null });
    expect(resolvePasteTarget(s)).toEqual({ col: 1, row: 0 });
  });

  it("falls back to the selected row at col 0 when there is no range and no activeCell (row-marker click)", () => {
    const s = fakeState({ selection: { ...emptySelection(), rows: CompactSelection.fromArray([2]) }, activeCell: null });
    expect(resolvePasteTarget(s)).toEqual({ col: 0, row: 2 });
  });

  it("falls back to activeCell when no selection channel is populated", () => {
    const s = fakeState({ selection: emptySelection(), activeCell: { col: 1, row: 1 } });
    expect(resolvePasteTarget(s)).toEqual({ col: 1, row: 1 });
  });

  it("returns null when nothing is selected and there is no activeCell", () => {
    expect(resolvePasteTarget(fakeState({ selection: emptySelection(), activeCell: null }))).toBeNull();
  });
});

describe("tileToHeight", () => {
  it("tiles a single pasted row down to fill a taller target height", () => {
    expect(tileToHeight([["x", "y"]], 3)).toEqual([
      ["x", "y"],
      ["x", "y"],
      ["x", "y"],
    ]);
  });

  it("leaves a multi-row paste untouched even if the target is taller", () => {
    const cells = [["a"], ["b"]];
    expect(tileToHeight(cells, 5)).toBe(cells);
  });

  it("leaves a single row untouched when the target height is 1", () => {
    const cells = [["a"]];
    expect(tileToHeight(cells, 1)).toBe(cells);
  });
});

describe("targetHeight", () => {
  it("is 1 for a single-cell selection (anchored expand)", () => {
    const s = fakeState({ selection: selectCellPure({ col: 0, row: 0 }) });
    expect(targetHeight(s)).toBe(1);
  });

  it("is the range height when the selection spans multiple rows", () => {
    const base = selectCellPure({ col: 0, row: 0 });
    const s = fakeState({
      selection: { ...base, current: { ...base.current!, range: { x: 0, y: 0, width: 1, height: 3 } } },
    });
    expect(targetHeight(s)).toBe(3);
  });
});

describe("buildPasteWrites", () => {
  it("writes a rectangular block at the target top-left (anchored expand)", () => {
    const s = fakeState();
    const writes = buildPasteWrites(s, [["x", "9"], ["y", "8"]], { col: 0, row: 1 });
    expect(writes).toEqual([
      { viewRow: 1, columnId: "name", value: "x" },
      { viewRow: 1, columnId: "qty", value: 9 },
      { viewRow: 2, columnId: "name", value: "y" },
      { viewRow: 2, columnId: "qty", value: 8 },
    ]);
  });

  it("clips at the grid's row and column bounds", () => {
    const s = fakeState();
    const writes = buildPasteWrites(s, [["x", "9"], ["y", "8"], ["z", "7"]], { col: 0, row: 3 });
    // target row 3 is the grid's last row (rowCount=4); the paste's row 1/2 ("y"/"z") fall past the edge and are clipped away.
    expect(writes).toEqual([
      { viewRow: 3, columnId: "name", value: "x" },
      { viewRow: 3, columnId: "qty", value: 9 },
    ]);
  });

  it("clips columns that fall past the grid's right edge", () => {
    const s = fakeState();
    const writes = buildPasteWrites(s, [["x", "9", "extra"]], { col: 0, row: 0 });
    expect(writes).toEqual([
      { viewRow: 0, columnId: "name", value: "x" },
      { viewRow: 0, columnId: "qty", value: 9 },
    ]);
  });

  it("skips a readOnly column", () => {
    const s = fakeState({ visibleColumns: readOnlyColumns as unknown as DataGridStoreState["visibleColumns"] });
    const writes = buildPasteWrites(s, [["x", "9"]], { col: 0, row: 0 });
    expect(writes).toEqual([{ viewRow: 0, columnId: "qty", value: 9 }]);
  });

  it("skips a cell whose parsed value fails validate, without blocking the rest of the batch", () => {
    const validatingColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "qty",
        header: "Qty",
        accessorKey: "qty",
        type: "number",
        validate: (value) => (typeof value === "number" && value < 0 ? "must be >= 0" : null),
      },
    ];
    const s = fakeState({ visibleColumns: validatingColumns as unknown as DataGridStoreState["visibleColumns"] });
    const writes = buildPasteWrites(s, [["x", "-5"]], { col: 0, row: 0 });
    expect(writes).toEqual([{ viewRow: 0, columnId: "name", value: "x" }]);
  });

  it("uses processCellFromClipboard when provided", () => {
    const s = fakeState({ processCellFromClipboard: (text) => text.toUpperCase() });
    const writes = buildPasteWrites(s, [["hi", "1"]], { col: 0, row: 0 });
    expect(writes[0]).toEqual({ viewRow: 0, columnId: "name", value: "HI" });
  });

  it("a passing sync Standard Schema commits its transformed value (workplan #53)", () => {
    const schema = { "~standard": { version: 1, vendor: "mock", validate: (v: unknown) => ({ value: Math.round(v as number) }) } };
    const schemaColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: schema as never },
    ];
    const s = fakeState({ visibleColumns: schemaColumns as unknown as DataGridStoreState["visibleColumns"] });
    const writes = buildPasteWrites(s, [["x", "9.6"]], { col: 0, row: 0 });
    expect(writes).toEqual([
      { viewRow: 0, columnId: "name", value: "x" },
      { viewRow: 0, columnId: "qty", value: 10 },
    ]);
  });

  it("an async Standard Schema holds the batch: a Promise of the writes, with the transformed value (workplan #79)", async () => {
    const schema = { "~standard": { version: 1, vendor: "mock", validate: async (v: unknown) => ({ value: (v as number) * 10 }) } };
    const schemaColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: schema as never },
    ];
    const s = fakeState({ visibleColumns: schemaColumns as unknown as DataGridStoreState["visibleColumns"] });
    const writes = buildPasteWritesRaw(s, [["x", "9"]], { col: 0, row: 0 });
    expect(writes).toBeInstanceOf(Promise);
    // a HELD batch carries rowId so the apply can re-resolve its view position after a reorder (#90)
    await expect(writes).resolves.toEqual([
      { viewRow: 0, columnId: "name", value: "x", rowId: "1" },
      { viewRow: 0, columnId: "qty", value: 90, rowId: "1" },
    ]);
  });

  it("an async rejection drops only that cell, exactly like a sync rejection", async () => {
    const schema = {
      "~standard": {
        version: 1,
        vendor: "mock",
        validate: async (v: unknown) => ((v as number) < 0 ? { issues: [{ message: "must be >= 0" }] } : { value: v }),
      },
    };
    const schemaColumns: readonly ColumnDef<Row, unknown>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "qty", header: "Qty", accessorKey: "qty", type: "number", validate: schema as never },
    ];
    const s = fakeState({ visibleColumns: schemaColumns as unknown as DataGridStoreState["visibleColumns"] });
    await expect(buildPasteWritesRaw(s, [["x", "-5"], ["y", "3"]], { col: 0, row: 0 })).resolves.toEqual([
      { viewRow: 0, columnId: "name", value: "x", rowId: "1" },
      { viewRow: 1, columnId: "name", value: "y", rowId: "2" },
      { viewRow: 1, columnId: "qty", value: 3, rowId: "2" },
    ]);
  });
});

describe("pasteText", () => {
  function fakeActions(): DataGridActions {
    return { applyCellUpdates: vi.fn() } as unknown as DataGridActions;
  }

  it("parses TSV text and applies it via applyCellUpdates('paste'), returning true", () => {
    const s = fakeState({ selection: selectCellPure({ col: 0, row: 1 }) });
    const actions = fakeActions();
    const applied = pasteText(s, actions, "x\t9");
    expect(applied).toBe(true);
    expect(actions.applyCellUpdates).toHaveBeenCalledWith(
      [
        { viewRow: 1, columnId: "name", value: "x" },
        { viewRow: 1, columnId: "qty", value: 9 },
      ],
      "paste",
    );
  });

  it("returns false and applies nothing while a cell is being edited", () => {
    const s = fakeState({
      selection: selectCellPure({ col: 0, row: 0 }),
      editing: { coord: { col: 0, row: 0 } },
    } as unknown as Partial<DataGridStoreState>);
    const actions = fakeActions();
    expect(pasteText(s, actions, "x")).toBe(false);
    expect(actions.applyCellUpdates).not.toHaveBeenCalled();
  });

  it("returns false when there's no paste target", () => {
    const s = fakeState({ selection: emptySelection(), activeCell: null } as unknown as Partial<DataGridStoreState>);
    const actions = fakeActions();
    expect(pasteText(s, actions, "x")).toBe(false);
    expect(actions.applyCellUpdates).not.toHaveBeenCalled();
  });

  it("returns false for empty/whitespace-only text (nothing to parse)", () => {
    const s = fakeState({ selection: selectCellPure({ col: 0, row: 0 }) });
    const actions = fakeActions();
    expect(pasteText(s, actions, "")).toBe(false);
    expect(actions.applyCellUpdates).not.toHaveBeenCalled();
  });

  it("returns false when processPaste vetoes the paste", () => {
    const s = fakeState({ selection: selectCellPure({ col: 0, row: 0 }), processPaste: () => false });
    const actions = fakeActions();
    expect(pasteText(s, actions, "x")).toBe(false);
    expect(actions.applyCellUpdates).not.toHaveBeenCalled();
  });

  it("returns false and applies nothing on a readOnly grid", () => {
    const s = fakeState({
      selection: selectCellPure({ col: 0, row: 0 }),
      readOnly: true,
    } as unknown as Partial<DataGridStoreState>);
    const actions = fakeActions();
    expect(pasteText(s, actions, "x")).toBe(false);
    expect(actions.applyCellUpdates).not.toHaveBeenCalled();
  });
});
