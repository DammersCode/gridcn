import type { DataGridStoreState } from "./types";

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

/** Row id shown at `viewRow`, or `undefined` for a missing or unloaded row. */
export function rowIdAtViewRow(
  s: ViewRowsState & { getRowId: DataGridStoreState["getRowId"] },
  viewRow: number,
): string | undefined {
  const dataIndex = dataIndexOf(s.viewIndex, viewRow);
  if (dataIndex === undefined) return undefined;
  const row = s.data[dataIndex];
  return row === undefined ? undefined : s.getRowId(row, dataIndex);
}
