import type { ColumnDef } from "../data-grid";
import type { GroupKey, ServerGroupLayout, ServerGroupSlot, ServerPivotLayout } from "../group-types";
import { createDataGridStore } from "../store/create-store";
import type { InternalSyncProps } from "../store/types";

export type NestedPivotRow = { id: string; region: string; country: string; city: string; year: number; amount: number; secret: string };

export const nestedPivotColumns: ColumnDef<NestedPivotRow, unknown>[] = [
  { id: "region", header: "Region", accessorKey: "region" },
  { id: "country", header: "Country", accessorKey: "country" },
  { id: "city", header: "City", accessorKey: "city" },
  { id: "year", header: "Year", accessorKey: "year", type: "number" },
  { id: "amount", header: "Amount", accessorKey: "amount", type: "number", aggregate: "sum" },
  { id: "secret", header: "Secret", accessorKey: "secret", hidden: true },
];

export const heldYears = (years: readonly GroupKey[] = [2023, 2024, 2025]): ServerPivotLayout => ({
  columnId: "year",
  values: [{ columnId: "amount", reducer: "sum" }],
  columns: years.map((key) => ({ path: [key], valueIndex: 0 })),
  omitted: 0,
});

const LEVELS = ["region", "country", "city"];

/** A pivot row at `viewRow` whose path follows `keys`; without `cells` its cells have not landed. */
export const pivotSlot = (viewRow: number, keys: readonly GroupKey[], childCount: number, cells?: readonly number[]): ServerGroupSlot => ({
  viewRow,
  path: keys.map((key, level) => ({ columnId: LEVELS[level]!, key })),
  count: 2,
  childCount,
  ...(cells ? { pivotCells: Float64Array.from(cells) } : null),
});

/**
 * Two levels and three generated columns: EU opens to DE and FR, view row 3 is a lazy hole, US has not landed its cells, and the
 * last group holds hostile keys.
 */
export const twoLevelLayout = (): ServerGroupLayout => ({
  rows: [
    pivotSlot(0, ["EU"], 2, [10, 20, 30.5]),
    pivotSlot(1, ["EU", "DE"], 0, [1, 2, 3]),
    pivotSlot(2, ["EU", "FR"], 0, [4, Number.NaN, 6]),
    pivotSlot(4, ["US"], 1),
    pivotSlot(5, ["=1+1"], 1, [7, 8, 9]),
    pivotSlot(6, ["=1+1", "__proto__"], 0, [-7, 0, Number.POSITIVE_INFINITY]),
  ],
  leafCount: 12,
  pivot: heldYears(),
});

export const threeLevelLayout = (): ServerGroupLayout => ({
  rows: [pivotSlot(0, ["EU"], 1, [10, 20, 30]), pivotSlot(1, ["EU", "DE"], 1, [5, 6, 7]), pivotSlot(2, ["EU", "DE", "Berlin"], 0, [1, 2, 3]), pivotSlot(3, ["US"], 0, [8, 9, 10])],
  leafCount: 6,
  pivot: heldYears(),
});

/** The view rows of `layout`; its `viewRow`s increase, so the last one is the largest. */
export const viewRowsOf = (layout: ServerGroupLayout) => (layout.rows.at(-1)?.viewRow ?? -1) + 1;

/** A store over `layout` with every view row unloaded, as the server hook holds a pivot view. */
export function nestedPivotStore(layout: ServerGroupLayout, groupBy: readonly string[] = LEVELS.slice(0, layout.rows.reduce((depth, row) => Math.max(depth, row.path.length), 0)), extra: Record<string, unknown> = {}) {
  const dataLength = viewRowsOf(layout);
  return createDataGridStore({
    data: Array.from({ length: dataLength }, () => undefined),
    columns: nestedPivotColumns,
    getRowId: (_r: NestedPivotRow, i: number) => `slot-${i}`,
    groupBy,
    groupLayout: layout,
    defaultExpanded: { mode: "expanded", ids: [] },
    enableRowSelection: true,
    ...extra,
  } as unknown as InternalSyncProps);
}
