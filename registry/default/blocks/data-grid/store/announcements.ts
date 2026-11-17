import { columnLabelText } from "../columns/column-format-helpers";
import type { GroupNode } from "../group-types";
import type { DataGridStoreState, LiveAnnouncement, LiveAnnouncementKind } from "./types";

/** The record after `prev`: a new `seq` makes the live region re-announce a repeated text. */
export function nextAnnouncement(prev: LiveAnnouncement | null, kind: LiveAnnouncementKind, count: number, partial = false, label?: string): LiveAnnouncement {
  return { kind, count, seq: (prev?.seq ?? 0) + 1, ...(partial ? { partial: true as const } : {}), ...(label === undefined ? {} : { label }) };
}

/** View rows that hold data; lazy holes and group rows do not count. */
export function loadedRowCount(viewIndex: readonly number[], data: readonly unknown[]): number {
  let count = 0;
  for (const dataIndex of viewIndex) if (dataIndex >= 0 && data[dataIndex] !== undefined) count++;
  return count;
}

/** The first group of `state` whose rows just failed to load: `status` is "failed" now and was not in `prev`. */
export function newlyFailedGroup(state: Pick<DataGridStoreState, "groupLayout" | "groupMode">, prev: Pick<DataGridStoreState, "groupLayout">): GroupNode | undefined {
  if (state.groupMode !== "server" || state.groupLayout === prev.groupLayout) return undefined;
  const failedBefore = new Set<string>();
  for (const node of prev.groupLayout?.rows ?? []) if (node.status === "failed") failedBefore.add(node.id);
  return state.groupLayout?.rows.find((node) => node.status === "failed" && !failedBefore.has(node.id));
}

/** How a group reads in an announcement: its column, then its key. */
export function groupAnnouncementLabel(s: Pick<DataGridStoreState, "columns" | "labels">, node: GroupNode): string {
  const column = s.columns.find((candidate) => candidate.id === node.columnId);
  return s.labels.grouping.groupName(column ? columnLabelText(column) : node.columnId, node.label || s.labels.grouping.empty);
}
