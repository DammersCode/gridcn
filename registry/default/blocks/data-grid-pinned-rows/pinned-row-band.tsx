"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import { GRID_LAYER, type GridColumnLayout, type RenderedColumn } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { cn } from "@/lib/utils";
import { DataGridPinnedRow } from "./pinned-row";
import { isPinnedRowSource } from "./pinned-row-source";
import { DataGridPinnedSourceRow } from "./pinned-source-row";
import type { ServerAggregateStatus } from "./use-data-grid-server-aggregate";

const NO_STATUSES: ReadonlyMap<number, ServerAggregateStatus> = new Map();
const STATUS_PRECEDENCE: readonly ServerAggregateStatus[] = ["loading", "stale", "error"];

function worstStatus(statuses: ReadonlyMap<number, ServerAggregateStatus>): ServerAggregateStatus {
  const values = new Set(statuses.values());
  return STATUS_PRECEDENCE.find((s) => values.has(s)) ?? "ready";
}

/** Props for {@link DataGridPinnedRowBand}. */
export type DataGridPinnedRowBandProps = {
  position: "top" | "bottom";
  rows: readonly unknown[];
  renderedColumns: readonly RenderedColumn[];
  layout: GridColumnLayout;
  rowHeight: number;
  template: string;
  /** The sticky header track's own height (not including this or any pinned band) — where the top band's `insetBlockStart` lands, directly under the header. */
  headerHeight: number;
  /**
   * `aria-rowindex` base for this band's rows (root's aria index layout: header rows, pinned-top
   * next, then data rows, pinned-bottom last). Top band: `1 + headerRowCount` (right after the header
   * rows, `2` without column groups), plus the rows of earlier top bands. Bottom band: after every
   * pinned-top and data row — root computes both bases and passes them through `RowBandRenderCtx`.
   */
  ariaRowIndexBase: number;
  /** Server value state: anything but `"ready"` dims the band; `"loading"` and `"stale"` set `aria-busy`. Default: the status of the band's `serverAggregateRow` entries, else `"ready"`. */
  status?: ServerAggregateStatus;
};

/**
 * A pinned-row sticky band: same layering as core's header layer — absolutely positioned inside
 * the sticky Viewport, counter-translated horizontally by the live scroll var so its cells track
 * the column canvas 1:1, but never moves vertically (rows canvas is the only vertically-scrolling
 * layer). The top band sits directly under the header; the bottom band sits flush with the
 * viewport's bottom edge (`insetBlockEnd: 0`) — both stay "in place" while data rows scroll
 * underneath, which is what core's frozen-edge shadow (root.tsx) keys off of.
 * `useDataGridPinnedRows`'s `rowBands.render` calls this once per non-empty band.
 */
export function DataGridPinnedRowBand(props: DataGridPinnedRowBandProps): ReactNode {
  const { position, rows, renderedColumns, layout, rowHeight, template, headerHeight, ariaRowIndexBase } = props;
  const [sourceStatuses, setSourceStatuses] = useState(NO_STATUSES);
  const reportStatus = useCallback((bandIndex: number, next: ServerAggregateStatus | undefined) => {
    setSourceStatuses((prev) => {
      if (prev.get(bandIndex) === next) return prev;
      const map = new Map(prev);
      if (next === undefined) map.delete(bandIndex);
      else map.set(bandIndex, next);
      return map;
    });
  }, []);
  const status = props.status ?? worstStatus(sourceStatuses);
  if (rows.length === 0) return null;

  const bandHeight = rows.length * rowHeight;
  const layerStyle: CSSProperties = {
    position: "absolute",
    insetInlineStart: 0,
    display: "grid",
    gridTemplateColumns: template,
    gridAutoRows: `${rowHeight}px`,
    height: bandHeight,
    // stacking context, same reasoning as header.tsx's own zIndex comment — must paint above the
    // rows canvas in DOM order regardless of scroll-driven transforms; below the header (zIndex 4).
    zIndex: GRID_LAYER.pinnedRowBand,
    // --grid-dir (-1 LTR, 1 RTL) signs the horizontal term, same as core's header/canvas layers:
    // the grid tracks mirror themselves under dir=rtl but transforms stay physical.
    transform: "translate3d(calc(var(--grid-dir, -1) * var(--grid-scroll-left, 0px)), 0, 0)",
    ...(position === "top" ? { insetBlockStart: headerHeight } : { insetBlockEnd: 0 }),
  };

  return (
    <div
      role="rowgroup"
      data-grid-pinned-row-band={position}
      data-status={status}
      aria-busy={status === "loading" || status === "stale" ? true : undefined}
      className={cn(status !== "ready" && "opacity-60", status === "loading" && "motion-safe:animate-pulse")}
      style={layerStyle}
    >
      {rows.map((row, i) => {
        const rowProps = {
          position,
          bandIndex: i,
          renderedColumns,
          layout,
          gridRowStart: i + 1,
          ariaRowIndex: ariaRowIndexBase + i,
          className: position === "bottom" ? "border-t border-border" : undefined,
        };
        // oxlint-disable-next-line react/no-array-index-key -- a pinned row id can be a band id; band position is a stable key for a small consumer array.
        return isPinnedRowSource(row) ? <DataGridPinnedSourceRow key={i} {...rowProps} source={row} onStatus={reportStatus} /> : <DataGridPinnedRow key={i} {...rowProps} row={row} />;
      })}
    </div>
  );
}
