"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import type { RowMarkersMode } from "../types";
import { GRID_LAYER } from "../layers";
import { gridAttrSelector } from "../data-attributes";
import { useDataGridRootContext } from "../layout-context";
import {
  useDataGridActions,
  useDataGridIsRowCellSelected,
  useDataGridIsRowChannelSelected,
  useDataGridIsRowSelected,
  useDataGridLabels,
  useDataGridRowReorderEnabled,
} from "../store";

/** Props for {@link DataGridMarkerCell}. */
export type DataGridMarkerCellProps = {
  mode: RowMarkersMode;
  viewRowIndex: number;
  /** Resolves the plain/shift/ctrl click-select gesture and starts a row-range drag (see use-grid-interaction.ts' onMarkerPointerDown). */
  onPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Arms the same row-range drag from a press on the checkbox glyph itself, without pre-empting its own click->toggle (see use-grid-interaction.ts' onMarkerCheckboxPointerDown). */
  onCheckboxPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** Arms the row-reorder drag from a press on the cell (never the checkbox glyph); a stable callback from the body's useRowReorder instance. */
  onReorderPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** True while this row is the reorder-drag source (dims the marker, like the column reorder does to its header cell). */
  isReorderDragging: boolean;
};

/**
 * The marker column's per-row cell: row number ('number'/'both'), a row-select checkbox
 * ('checkbox'/'both'), both with the number hidden on hover/selected via group-hover
 * ('both'), or a grip handle ('reorder') that drags the row to a new position. Always pinned-left
 * at grid track 1 with a fixed zero offset (nothing pins before it) — outside the data column's
 * aria-colindex space (see {@link DataGridMarkerHeader} for why it carries no `aria-colindex`).
 */
export function DataGridMarkerCell(props: DataGridMarkerCellProps): ReactNode {
  const { mode, viewRowIndex, onPointerDown, onCheckboxPointerDown, onReorderPointerDown, isReorderDragging } = props;
  const actions = useDataGridActions();
  // chrome (wrapper tint/data-row-selected) and the built-in checkbox keep the any-channel union
  const isSelected = useDataGridIsRowSelected(viewRowIndex);
  // the renderer gets the channels apart: row selection vs cell selection (see MarkerCellRenderCtx)
  const isRowChannelSelected = useDataGridIsRowChannelSelected(viewRowIndex);
  const isCellSelected = useDataGridIsRowCellSelected(viewRowIndex);
  const labels = useDataGridLabels();
  const reorderEnabled = useDataGridRowReorderEnabled();
  const { renderMarker } = useDataGridRootContext();

  const style: CSSProperties = {
    gridColumnStart: 1,
    position: "relative",
    insetInlineStart: "var(--grid-scroll-left, 0px)",
    // every cell is position:relative, so DOM order decides paint order among them — the
    // marker is FIRST in the row, so without this it paints under every scrolled data cell.
    zIndex: GRID_LAYER.markerCell,
  };

  const showNumber = mode === "number" || mode === "both";
  const showCheckbox = mode === "checkbox" || mode === "both";

  return (
    <div
      role="gridcell"
      data-grid-marker-cell=""
      data-row-selected={isSelected || undefined}
      data-dragging={isReorderDragging || undefined}
      aria-label={mode === "reorder" ? labels.markers.reorderRow(viewRowIndex + 1) : undefined}
      className={cn(
        "group flex items-center justify-center border-b border-border bg-background transition-colors group-hover/row:transition-none",
        // Same rule as a pinned-column cell (see cell.tsx): this sits opaque above the scrolled
        // canvas, so a translucent tint would let the scrolled content show through it.
        // color-mix() pre-composites the identical tint as an OPAQUE color, in both themes.
        "group-hover/row:bg-[color-mix(in_oklch,var(--color-muted)_50%,var(--color-background))]",
        isSelected && "bg-[color-mix(in_oklch,var(--color-muted)_50%,var(--color-background))]",
        (mode === "reorder" || reorderEnabled) && "cursor-grab",
        isReorderDragging && "opacity-50",
      )}
      style={style}
      onPointerDown={(event) => {
        onPointerDown(viewRowIndex, event);
        // the checkbox glyph keeps its own row-select drag (see onCheckboxPointerDown); a press on
        // the rest of the cell arms the reorder path instead (use-row-reorder.ts' disambiguation rule)
        const target = event.target;
        if (!(target instanceof Element && target.closest(gridAttrSelector("markerCheckbox")))) {
          onReorderPointerDown(viewRowIndex, event);
        }
      }}
    >
      {renderMarker ? (
        renderMarker({ viewRowIndex, isRowChannelSelected, isCellSelected })
      ) : (
        <>
          {showCheckbox && (
            <Checkbox
              data-grid-marker-checkbox=""
              className={cn(mode === "both" && "hidden group-hover:flex data-checked:flex", isSelected && "flex")}
              checked={isSelected}
              onCheckedChange={(checked) => actions.setRowSelected(viewRowIndex, checked === true)}
              // a stationary press+release still resolves via onCheckedChange's additive toggle above
              // (native click, unaffected by this); a press that moves arms a row-range drag instead —
              // see DataGridMarkerCellProps.onCheckboxPointerDown for why this can't just stopPropagation.
              onPointerDown={(event) => onCheckboxPointerDown(viewRowIndex, event)}
              aria-label={labels.markers.selectRow(viewRowIndex + 1)}
            />
          )}
          {showNumber && (
            <span
              data-grid-marker-number=""
              className={cn(
                "select-none text-xs tabular-nums text-muted-foreground",
                mode === "both" && "group-hover:hidden",
                mode === "both" && isSelected && "hidden",
              )}
            >
              {viewRowIndex + 1}
            </span>
          )}
          {mode === "reorder" && (
            <span data-grid-reorder-handle="" aria-hidden="true" className="touch-none text-muted-foreground select-none">
              <GripVertical className="size-3.5" />
            </span>
          )}
        </>
      )}
    </div>
  );
}
