"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import type { SortSpec } from "../types";

/** Props for {@link DataGridSortIndicator}. */
export type DataGridSortIndicatorProps = {
  columnId: string;
  sortState: readonly SortSpec[];
};

/**
 * Sort direction arrow (muted, size-3.5) for a header, plus its multi-sort priority number when
 * more than one sort is active. Renders nothing when the column isn't sorted.
 */
export function DataGridSortIndicator(props: DataGridSortIndicatorProps): ReactNode {
  const { columnId, sortState } = props;
  const index = sortState.findIndex((s) => s.columnId === columnId);
  if (index === -1) return null;
  const { direction } = sortState[index]!; // index !== -1 checked above, so it's a valid position
  const Icon = direction === "asc" ? ChevronUp : ChevronDown;
  return (
    <span className="ms-1 inline-flex items-center gap-0.5 text-muted-foreground" data-grid-sort-indicator={direction}>
      <Icon className="size-3.5" />
      {sortState.length > 1 && <span className="text-[10px] tabular-nums">{index + 1}</span>}
    </span>
  );
}

/** Resolves a header's `aria-sort` attribute from the active multi-sort spec. */
export function ariaSortFor(columnId: string, sortState: readonly SortSpec[]): "ascending" | "descending" | "none" {
  const entry = sortState.find((s) => s.columnId === columnId);
  if (!entry) return "none";
  return entry.direction === "asc" ? "ascending" : "descending";
}
