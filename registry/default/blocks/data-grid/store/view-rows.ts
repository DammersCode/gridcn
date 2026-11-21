import type { GroupLayout } from "../group-types";
import type { DataGridStoreState } from "./types";

const layoutsByView = new WeakMap<object, GroupLayout>();

/** Remembers the group rows that the entries below 0 of `view` name. */
export function registerGroupLayout(view: readonly number[], layout: GroupLayout): void {
  layoutsByView.set(view, layout);
}

/** The group rows of a grouped view; `null` for a view that holds none. */
export function groupLayoutOfView(view: ArrayLike<number>): GroupLayout | null {
  return layoutsByView.get(view) ?? null;
}

/** What a view row stands for across rebuilds: a data index, or the group id of a group row. `undefined` for a missing row. */
export function recordKeyAt(view: ArrayLike<number>, viewRow: number): number | string | undefined {
  const entry = view[viewRow];
  if (entry === undefined || entry >= 0) return entry;
  return groupLayoutOfView(view)?.rows[-entry - 1]?.id;
}

/** The view row that shows the group `groupId`, or -1. */
export function viewRowOfGroupId(view: readonly number[], groupId: string): number {
  const rows = groupLayoutOfView(view)?.rows;
  const at = rows ? rows.findIndex((row) => row.id === groupId) : -1;
  return at === -1 ? -1 : view.indexOf(-at - 1);
}

/** The view row in `nextView` of the nearest group above `prevViewRow` of `prevView` (its own group for a data row) that `nextView` still shows, or -1. */
export function viewRowOfSurvivingParent(prevView: readonly number[], prevViewRow: number, nextView: readonly number[]): number {
  const rows = groupLayoutOfView(prevView)?.rows;
  if (!rows) return -1;
  let header = prevViewRow;
  while (header > 0 && !(prevView[header]! < 0)) header--;
  if (!(prevView[header]! < 0)) return -1;
  const at = -prevView[header]! - 1;
  let depth = header === prevViewRow ? rows[at]!.depth : rows[at]!.depth + 1;
  for (let i = at; i >= 0 && depth > 0; i--) {
    if (rows[i]!.depth >= depth) continue;
    depth = rows[i]!.depth;
    const next = viewRowOfGroupId(nextView, rows[i]!.id);
    if (next !== -1) return next;
  }
  return -1;
}

type ViewRowsState = { readonly viewIndex: ArrayLike<number>; readonly data: readonly unknown[] };

/** What a view row shows: a data row, a group row (an entry below 0), or a hole (out of range or an unloaded row). */
export type ViewEntry =
  | { readonly kind: "data"; readonly dataIndex: number }
  | { readonly kind: "group"; readonly groupIndex: number }
  | { readonly kind: "hole"; readonly dataIndex?: number };

/** The data index at `viewRow` of `view`; `undefined` when the row is out of range or an entry below 0 names a group row. */
export function dataIndexOf(view: ArrayLike<number>, viewRow: number): number | undefined {
  const dataIndex = view[viewRow];
  return dataIndex !== undefined && dataIndex >= 0 ? dataIndex : undefined;
}

/** The data index shown at `viewRow`; `undefined` for a missing row or a group row. */
export function dataIndexAt(s: { readonly viewIndex: ArrayLike<number> }, viewRow: number): number | undefined {
  return dataIndexOf(s.viewIndex, viewRow);
}

/** The data row shown at `viewRow`; `undefined` for a missing row, an unloaded row, or a group row. */
export function rowAtViewRow(s: ViewRowsState, viewRow: number): unknown {
  const dataIndex = dataIndexOf(s.viewIndex, viewRow);
  return dataIndex === undefined ? undefined : s.data[dataIndex];
}

export function viewEntryAt(s: ViewRowsState, viewRow: number): ViewEntry {
  const entry = s.viewIndex[viewRow];
  if (entry === undefined) return { kind: "hole" };
  if (entry < 0) return { kind: "group", groupIndex: -entry - 1 };
  return s.data[entry] === undefined ? { kind: "hole", dataIndex: entry } : { kind: "data", dataIndex: entry };
}

/** Calls `fn` for every entry of `view` that names a data row, in view order. */
export function forEachDataIndex(view: ArrayLike<number>, fn: (dataIndex: number, viewRow: number) => void): void {
  for (let viewRow = 0; viewRow < view.length; viewRow++) {
    const dataIndex = view[viewRow]!; // viewRow < length by loop condition
    if (dataIndex >= 0) fn(dataIndex, viewRow);
  }
}

/** Row id shown at `viewRow`: the group id for a group row, `undefined` for a missing or unloaded row. */
export function rowIdAtViewRow(
  s: ViewRowsState & { getRowId: DataGridStoreState["getRowId"] },
  viewRow: number,
): string | undefined {
  const dataIndex = dataIndexOf(s.viewIndex, viewRow);
  if (dataIndex === undefined) return recordKeyAt(s.viewIndex, viewRow) as string | undefined;
  const row = s.data[dataIndex];
  return row === undefined ? undefined : s.getRowId(row, dataIndex);
}

/** The index into `groupLayout.rows` of the group row at `viewRow`; `undefined` for a data row or a missing row. */
export function groupIndexAt(view: ArrayLike<number>, viewRow: number): number | undefined {
  const entry = view[viewRow];
  return entry !== undefined && entry < 0 ? -entry - 1 : undefined;
}
