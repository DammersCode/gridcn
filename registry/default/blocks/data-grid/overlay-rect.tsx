import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { GRID_LAYER } from "./layers";
import { hasAnyPin, type OverlayPluginCtx } from "./overlays";
import type { GridRect } from "./types";

/** Props for {@link OverlayRect}. */
export type OverlayRectProps = {
  /** The props the grid passes to the plugin's `Overlay`. */
  ctx: OverlayPluginCtx;
  /** The rectangle in view indexes: `x` and `width` count visible columns, `y` and `height` count view rows. */
  rect: GridRect;
  /** Classes of each painted part, such as `bg-primary/10` or a border. */
  className?: string;
  /** Styles of each painted part; the grid-line placement and the pinned layer win over them. */
  style?: CSSProperties;
};

/**
 * Paints one rectangle of a plugin `Overlay`: clamps it to the rendered rows, splits it at pinned
 * columns, and places each part on the grid lines, out of the pointer path and hidden from
 * assistive technology, with pinned parts above pinned cells. Renders nothing for a rectangle
 * outside the rendered rows.
 */
export function OverlayRect({ ctx, rect, className, style }: OverlayRectProps): ReactNode {
  const clamped = ctx.clampRectToWindow(rect, ctx.clampRowStart, ctx.clampRowEnd, ctx.colCount);
  if (!clamped) return null;
  const parts = hasAnyPin(ctx.pinTrack) ? ctx.splitRectByPinZones(clamped, ctx.pinTrack) : [{ rect: clamped, pinStyle: undefined }];
  return parts.map(({ rect: part, pinStyle }) => (
    <div
      key={part.x}
      aria-hidden="true"
      data-pinned={pinStyle ? "" : undefined}
      className={cn("pointer-events-none", className)}
      style={{
        ...style,
        position: "absolute",
        inset: 0,
        gridColumnStart: part.x + ctx.colOffset,
        gridColumnEnd: part.x + part.width + ctx.colOffset,
        gridRowStart: part.y - ctx.windowStart + 1,
        gridRowEnd: part.y + part.height - ctx.windowStart + 1,
        ...(pinStyle ? { inset: undefined, ...pinStyle, zIndex: GRID_LAYER.pinnedOverlaySegment } : {}),
      }}
    />
  ));
}
