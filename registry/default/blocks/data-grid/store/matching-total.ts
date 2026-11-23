import type { DataGridStoreState } from "./types";
import { fullViewOf } from "./compute";

/** The size of the result "all matching" covers: the leaf count a server lays out (`groupLayout.leafCount`), else `totalRowCount`, else the whole client list behind a paged or collapsed view (group rows left out); `undefined` when the view shows the whole result. */
export function matchingRowTotal(s: Pick<DataGridStoreState, "totalRowCount" | "viewIndex" | "groupLayout"> & Partial<Pick<DataGridStoreState, "groupMode" | "serverHeld">>): number | null | undefined {
  // The held rows belong to the previous spec, so their count is no count of the current one.
  if (s.serverHeld) return null;
  if (s.groupMode === "server" && s.groupLayout) return s.groupLayout.leafCount;
  if (s.totalRowCount !== undefined) return s.totalRowCount;
  const full = fullViewOf(s.viewIndex);
  const layout = s.groupLayout;
  if (layout) return full === s.viewIndex && full.length - layout.rows.length === layout.leafCount ? undefined : layout.leafCount;
  return full === s.viewIndex ? undefined : full.length;
}
