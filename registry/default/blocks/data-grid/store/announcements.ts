import type { GridSelection } from "../types";
import type { LiveAnnouncement, LiveAnnouncementKind } from "./types";

/** The record after `prev`: a new `seq` makes the live region re-announce a repeated text. */
export function nextAnnouncement(prev: LiveAnnouncement | null, kind: LiveAnnouncementKind, count: number): LiveAnnouncement {
  return { kind, count, seq: (prev?.seq ?? 0) + 1 };
}

/** Rows a marker checkbox shows as checked: the rows channel united with every cell range. */
export function checkedRowCount(selection: GridSelection, rowCount: number): number {
  const { current } = selection;
  if (!current) return selection.rows.length;
  const spans = [current.range, ...current.rangeStack]
    .map((r) => [Math.max(0, r.y), Math.min(rowCount, r.y + r.height)] as const)
    .sort((a, b) => a[0] - b[0]);
  const rowsChannelEmpty = selection.rows.length === 0;
  let count = selection.rows.length;
  let cursor = 0;
  for (const [start, end] of spans) {
    const from = Math.max(start, cursor);
    if (rowsChannelEmpty) count += Math.max(0, end - from);
    else for (let row = from; row < end; row++) if (!selection.rows.hasIndex(row)) count++;
    cursor = Math.max(cursor, end);
  }
  return count;
}

/** View rows that hold data; lazy holes do not count. */
export function loadedRowCount(viewIndex: readonly number[], data: readonly unknown[]): number {
  let count = 0;
  for (const dataIndex of viewIndex) if (data[dataIndex] !== undefined) count++;
  return count;
}
