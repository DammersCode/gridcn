"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ColumnGroupDef } from "../types";
import type { HeaderSegment } from "./column-groups";
import { COLUMN_BORDER } from "./column-border";
import { pinnedInsetStyle } from "./pinned-inset-style";

const MIN_VISIBLE_LABEL_PX = 128;

/** Props for {@link DataGridGroupHeaderCell}. */
export type DataGridGroupHeaderCellProps = {
  segment: HeaderSegment;
  group: ColumnGroupDef;
  gridColOffset: number;
  /** Segment width in px. */
  width: number;
  /** Left edge of the segment's first track, in content coordinates. */
  trackLeft: number;
  /** Width of the marker column plus the pinned-start columns: the label stays right of it while the segment scrolls. */
  pinnedStartEdge: number;
};

/**
 * One group header cell: a label over the visible columns `[start, end)` of a group at one level.
 * A pinned segment sticks like the pinned columns under it. The label of a wide unpinned segment
 * follows the scroll position through a CSS offset, so it stays readable without per-tick JS.
 */
export function DataGridGroupHeaderCell({ segment, group, gridColOffset, width, trackLeft, pinnedStartEdge }: DataGridGroupHeaderCellProps): ReactNode {
  const { start, end, pin, depth } = segment;
  const style: CSSProperties = {
    gridRow: depth + 1,
    gridColumn: `${start + gridColOffset} / ${end + gridColOffset}`,
    zIndex: pin ? 3 : 2,
    ...pinnedInsetStyle(pin, pin === "right" ? end - 1 : start),
  };
  const followsScroll = !pin && width > MIN_VISIBLE_LABEL_PX;
  const labelStyle: CSSProperties | undefined = followsScroll
    ? { paddingInlineStart: `max(0px, min(calc(var(--grid-scroll-left, 0px) + ${pinnedStartEdge}px - ${trackLeft}px), ${width - MIN_VISIBLE_LABEL_PX}px))` }
    : undefined;
  return (
    <div
      role="columnheader"
      aria-colindex={start + 1}
      aria-colspan={end - start}
      aria-label={typeof group.header === "string" ? undefined : group.headerText}
      data-grid-group-header=""
      data-group-id={group.id}
      data-pinned={pin || undefined}
      className={cn("group relative flex items-center border-b border-border bg-muted px-2 font-medium select-none", COLUMN_BORDER, group.headerClassName)}
      style={style}
    >
      {typeof group.header === "string" ? (
        <span className="block min-w-0 truncate" style={labelStyle}>
          {group.header}
        </span>
      ) : (
        group.header
      )}
    </div>
  );
}
