"use client";

import type { CSSProperties, ReactNode } from "react";
import { GRID_LAYER, type GridColumnLayout, type WindowedColumn } from "@/registry/default/blocks/data-grid/data-grid";
import { DataGridPinnedRow } from "./pinned-row";

/** Props for {@link DataGridPinnedRowBand}. */
export type DataGridPinnedRowBandProps = {
  position: "top" | "bottom";
  rows: readonly unknown[];
  windowedColumns: readonly WindowedColumn[];
  layout: GridColumnLayout;
  rowHeight: number;
  template: string;
  /** The sticky header track's own height (not including this or any pinned band) — where the top band's `insetBlockStart` lands, directly under the header. */
  headerHeight: number;
  /**
   * `aria-rowindex` base for this band's rows (root's aria index layout: header=1, pinned-top
   * next, then data rows, pinned-bottom last). Top band: 2 (right after the header). Bottom band:
   * `2 + pinnedTopCount + dataRowCount` (right after every data row) — root computes both bases and
   * passes them through `RowBandRenderCtx`.
   */
  ariaRowIndexBase: number;
};

/**
 * A pinned-row sticky band: same layering as core's header layer — absolutely positioned inside
 * the sticky Viewport, counter-translated horizontally by the live scroll var so its cells track
 * the column canvas 1:1, but never moves vertically (rows canvas is the only vertically-scrolling
 * layer). The top band sits directly under the header; the bottom band sits flush with the
 * viewport's bottom edge (`insetBlockEnd: 0`) — both stay "in place" while data rows scroll
 * underneath, which is what core's frozen-edge shadow (root.tsx) keys off of.
 * `useDataGridPinnedRows`'s `rowBands.renderBand` calls this once per non-empty band.
 */
export function DataGridPinnedRowBand(props: DataGridPinnedRowBandProps): ReactNode {
  const { position, rows, windowedColumns, layout, rowHeight, template, headerHeight, ariaRowIndexBase } = props;
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
    <div role="rowgroup" data-grid-pinned-row-band={position} style={layerStyle}>
      {rows.map((row, i) => (
        <DataGridPinnedRow
          // oxlint-disable-next-line react/no-array-index-key -- pinned rows have no getRowId; band position is a stable-enough key for a small, consumer-controlled array (documented v1 scope).
          key={i}
          row={row}
          bandIndex={i}
          windowedColumns={windowedColumns}
          layout={layout}
          gridRowStart={i + 1}
          ariaRowIndex={ariaRowIndexBase + i}
          className={position === "bottom" ? "border-t border-border" : undefined}
        />
      ))}
    </div>
  );
}
