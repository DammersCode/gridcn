import type { DataGridStoreState } from "./types";
import { fullViewOf } from "./compute";

/** The size of the result "all matching" covers: `totalRowCount`, else the whole client list behind a paged or collapsed view (group rows left out); `undefined` when the view shows the whole result. */
export function matchingRowTotal(s: Pick<DataGridStoreState, "totalRowCount" | "viewIndex" | "groupLayout">): number | null | undefined {
  if (s.totalRowCount !== undefined) return s.totalRowCount;
  const full = fullViewOf(s.viewIndex);
  const layout = s.groupLayout;
  if (layout) return full === s.viewIndex && full.length - layout.rows.length === layout.leafCount ? undefined : layout.leafCount;
  return full === s.viewIndex ? undefined : full.length;
}
