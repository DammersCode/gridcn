import { CompactSelection } from "../selection/compact-selection";
import type { GridSelection } from "../types";
import type { LiveAnnouncement, LiveAnnouncementKind } from "./types";

/** The record after `prev`: a new `seq` makes the live region re-announce a repeated text. */
export function nextAnnouncement(prev: LiveAnnouncement | null, kind: LiveAnnouncementKind, count: number, partial = false): LiveAnnouncement {
  return { kind, count, seq: (prev?.seq ?? 0) + 1, ...(partial ? { partial: true as const } : {}) };
}

/** Rows a marker checkbox shows as checked: the rows channel united with every cell range. */
export function checkedRowCount(selection: GridSelection, rowCount: number): number {
  const { current } = selection;
  const rowsLength = selection.rows.length;
  if (!current) return rowsLength;
  const sorted = [current.range, ...current.rangeStack]
    .map((r) => [Math.max(0, r.y), Math.min(rowCount, r.y + r.height)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<readonly [number, number]> = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], span[1])];
    else merged.push(span);
  }
  const spanTotal = merged.reduce((sum, [start, end]) => sum + end - start, 0);
  if (rowsLength === 0) return spanTotal;
  return rowsLength + spanTotal - CompactSelection.adopt(selection.rows).countWithin(merged);
}

/** View rows that hold data; lazy holes do not count. */
export function loadedRowCount(viewIndex: readonly number[], data: readonly unknown[]): number {
  let count = 0;
  for (const dataIndex of viewIndex) if (data[dataIndex] !== undefined) count++;
  return count;
}
