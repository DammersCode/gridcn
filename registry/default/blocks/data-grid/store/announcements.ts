import type { LiveAnnouncement, LiveAnnouncementKind } from "./types";

/** The record after `prev`: a new `seq` makes the live region re-announce a repeated text. */
export function nextAnnouncement(prev: LiveAnnouncement | null, kind: LiveAnnouncementKind, count: number, partial = false): LiveAnnouncement {
  return { kind, count, seq: (prev?.seq ?? 0) + 1, ...(partial ? { partial: true as const } : {}) };
}

/** View rows that hold data; lazy holes do not count. */
export function loadedRowCount(viewIndex: readonly number[], data: readonly unknown[]): number {
  let count = 0;
  for (const dataIndex of viewIndex) if (data[dataIndex] !== undefined) count++;
  return count;
}
