/**
 * The grid's internal stacking order, in one place.
 *
 * HARD CEILING: every value stays BELOW 50. shadcn puts each portalled overlay (dialog,
 * dropdown-menu, popover, select, tooltip, context-menu) at `z-50`, and a dialog must always
 * paint over the grid — including for consumers who install this through the registry, whose
 * pages we cannot patch. The grid root also sets `isolation: isolate` (root.tsx), so these
 * values are contained and can never leak into the page's stacking context; the ceiling is the
 * second line of defense for consumers who restyle the root.
 *
 * Steps of 4 so a new layer can slot between two existing ones without renumbering.
 *
 * Two rules the numbers encode, both learned from real bugs:
 *
 * 1. Cells are `position: relative`, so among equally-ranked siblings DOM order decides paint
 *    order. The marker is FIRST in each row, so it must outrank the data cells that follow it.
 * 2. Pinning is a spatial guarantee; active is a focus state. A pinned cell therefore outranks an
 *    active UNPINNED cell — otherwise clicking a cell and scrolling floats it over the pinned
 *    column. An active PINNED cell ranks above both.
 */
export const GRID_LAYER = {
  /** Unpinned body cell — in flow, no stacking context of its own. */
  cell: 0,
  /** Active (focused) unpinned cell: above its neighbours, below anything pinned. */
  activeCell: 4,
  /** Pinned-left/right body cell — must cover any unpinned cell scrolled under it. */
  pinnedCell: 8,
  /** Active pinned cell: the focus ring must not be clipped by its own band. */
  activePinnedCell: 12,
  /** Selection/fill/presence segment covering the pinned band — above the pinned cells it decorates, below the marker. */
  pinnedOverlaySegment: 14,
  /** Row-marker body cell — first in DOM order, so it needs to outrank every data cell. */
  markerCell: 16,
  /** Pinned top/bottom row band — spans the full width above the scrolling body. */
  pinnedRowBand: 20,
  /** Header row — above every body cell, including pinned ones. */
  header: 24,
  /** Pinned header cell, and the marker header, within the header row. */
  pinnedHeader: 28,
  /** Pin-edge shadows — above the cells whose boundary they mark. */
  pinShadow: 32,
  /** Selection / fill / presence overlays drawn over the whole grid. */
  overlay: 36,
  /** Loading skeleton — covers everything while the grid has no data to show. */
  skeleton: 40,
} as const;

/** A value from {@link GRID_LAYER}. */
export type GridLayer = (typeof GRID_LAYER)[keyof typeof GRID_LAYER];

/** The stacking rank a body cell should carry, given its pinned and active state. */
export function cellLayer(pinned: boolean, active: boolean): number | undefined {
  if (pinned) return active ? GRID_LAYER.activePinnedCell : GRID_LAYER.pinnedCell;
  if (active) return GRID_LAYER.activeCell;
  return undefined;
}
