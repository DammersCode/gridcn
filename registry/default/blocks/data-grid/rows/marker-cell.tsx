"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLUMN_BORDER } from "../columns/column-border";
import { Checkbox } from "@/components/ui/checkbox";
import type { RowMarkersMode } from "../types";
import { GRID_LAYER } from "../layers";
import { gridAttrSelector } from "../data-attributes";
import { useDataGridRootContext } from "../layout-context";
import { isReorderMarkerMode, markerContent } from "./marker-width";
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
  /** Number/rest zone of the cell: resolves the plain/shift/ctrl click-select gesture and starts a row-range drag (see use-grid-interaction.ts' onMarkerPointerDown). */
  onPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Grip zone of the cell (reorder family): click-select without a row-range drag (see use-grid-interaction.ts' onMarkerGripPointerDown). */
  onGripPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Arms the same row-range drag from a press on the checkbox glyph itself, without pre-empting its own click->toggle (see use-grid-interaction.ts' onMarkerCheckboxPointerDown). */
  onCheckboxPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** Arms the row-reorder drag from a press on the grip zone; a stable callback from the body's useRowReorder instance. */
  onReorderPointerDown: (viewRowIndex: number, event: ReactPointerEvent<HTMLElement>) => void;
  /** True while this row is the reorder-drag source (dims the marker, like the column reorder does to its header cell). */
  isReorderDragging: boolean;
};

/**
 * The marker column's per-row cell: row number (modes whose content includes number), a row-select
 * checkbox (content includes checkbox), both with the number hidden on hover/selected via
 * group-hover (content 'both'), and — for the `reorder` family — a grip handle that drags the row
 * to a new position on top of the suffix's content. Always pinned-left
 * at grid track 1 with a fixed zero offset (nothing pins before it) — outside the data column's
 * aria-colindex space (see {@link DataGridMarkerHeader} for why it carries no `aria-colindex`).
 *
 * Hit registration is zone-based so the press location — not later pointer movement — decides the
 * gesture: the checkbox glyph is a pure row-select toggle/range, the grip (reorder family) is the
 * only zone that arms the row-reorder drag (and click-selects on a stationary press), and the
 * number/rest of the cell is the plain row-select surface.
 */
export function DataGridMarkerCell(props: DataGridMarkerCellProps): ReactNode {
  const { mode, viewRowIndex, onPointerDown, onGripPointerDown, onCheckboxPointerDown, onReorderPointerDown, isReorderDragging } = props;
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

  const content = markerContent(mode);
  const showNumber = content === "number" || content === "both";
  const showCheckbox = content === "checkbox" || content === "both";
  // the grip renders (and the grab cursor + reorder aria-label apply) only in the reorder family
  // — plain modes keep the marker a pure row-select surface.
  const showGrip = isReorderMarkerMode(mode);
  const swapOnHover = content === "both";

  return (
    <div
      role="gridcell"
      data-grid-marker-cell=""
      data-row-selected={isSelected || undefined}
      data-dragging={isReorderDragging || undefined}
      aria-label={showGrip ? labels.markers.reorderRow(viewRowIndex + 1) : undefined}
      className={cn(
        "group flex items-center justify-center border-b border-border bg-background transition-colors group-hover/row:transition-none",
        COLUMN_BORDER,
        // Same rule as a pinned-column cell (see cell.tsx): this sits opaque above the scrolled
        // canvas, so a translucent tint would let the scrolled content show through it.
        // color-mix() pre-composites the identical tint as an OPAQUE color, in both themes.
        "group-hover/row:bg-[color-mix(in_oklch,var(--color-muted)_50%,var(--color-background))]",
        isSelected && "bg-[color-mix(in_oklch,var(--color-muted)_50%,var(--color-background))]",
        // the grip zone (everything but the number/checkbox) is the reorder handle
        showGrip && reorderEnabled && "cursor-grab",
        showGrip && (showNumber || showCheckbox) && "gap-1",
        isReorderDragging && "opacity-50",
      )}
      style={style}
      onPointerDown={(event) => {
        // Zone routing: the press location decides the gesture, not later pointer movement.
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(gridAttrSelector("markerCheckbox"))) {
          // the checkbox glyph's own onPointerDown (below) already ran for this press: additive
          // toggle on a stationary click, row-range drag on move. Running the wrapper's exclusive
          // selectRow here too would clobber an existing multi-row selection.
          return;
        }
        if (showGrip && (content === "none" || !target?.closest(gridAttrSelector("markerNumber")))) {
          // grip zone — a pure 'reorder' cell is grip across the whole cell; in the content modes
          // it is everything except the number/checkbox glyphs. A stationary press selects the
          // row; a vertical drag that leaves the origin row reorders
          onGripPointerDown(viewRowIndex, event);
          onReorderPointerDown(viewRowIndex, event);
          return;
        }
        // the number (reorder family) / rest of the cell (plain modes): the plain row-select
        // surface — range drag, never reorder
        onPointerDown(viewRowIndex, event);
      }}
    >
      {renderMarker ? (
        renderMarker({ viewRowIndex, isRowChannelSelected, isCellSelected })
      ) : (
        <>
          {showGrip && (
            <span data-grid-reorder-handle="" aria-hidden="true" className="touch-none text-muted-foreground select-none">
              <GripVertical className="size-3.5" />
            </span>
          )}
          {showCheckbox && (
            <Checkbox
              data-grid-marker-checkbox=""
              className={cn(
                // row-select zone — override the wrapper's grab cursor in the reorder family
                showGrip && "cursor-pointer",
                swapOnHover && "hidden group-hover:flex data-checked:flex",
                isSelected && "flex",
              )}
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
                // the number is a row-select zone — override the wrapper's grab cursor
                showGrip && "cursor-default",
                swapOnHover && "group-hover:hidden",
                swapOnHover && isSelected && "hidden",
              )}
            >
              {viewRowIndex + 1}
            </span>
          )}
        </>
      )}
    </div>
  );
}
