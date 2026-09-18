import { createContext, use, useMemo, type ReactElement, type ReactNode, type RefObject } from "react";
import type { GetCellClassName, GetRowClassName, OnCellClick, OnRowClick } from "./types";
import { useDataGridColumnWidths, useDataGridRowMarkers, type AnyColumnDef } from "./store";
import { resolveColumnWidth, distributeFlexWidths } from "./columns/resolve-column-width";
import { encodeTemplate } from "./columns/column-format-helpers";
import { pinLeftOffsets, pinRightOffsets } from "./columns/pin-offsets";
import { markerWidth } from "./rows/marker-width";
import type { GridInteractionHandlers } from "./interaction/use-grid-interaction";
import type { GridDirection } from "./windowing/direction";

/** Cumulative left edge (px) of each column's track within the full grid template. */
function trackLefts(widths: number[]): number[] {
  const lefts: number[] = [];
  let acc = 0;
  for (let i = 0; i < widths.length; i++) {
    lefts.push(acc);
    acc += widths[i]!; // i < widths.length by loop condition
  }
  return lefts;
}

/** Cumulative right edge (px) of each column's track within the full grid template. */
function trackRights(widths: number[], lefts: number[]): number[] {
  // lefts is trackLefts(widths)'s output: same length as widths by construction
  return widths.map((w, i) => lefts[i]! + w);
}

/**
 * Shared per-column layout used by header cells, data cells, and the grid template.
 * The marker column (when `markerWidth > 0`) is grid-template-column 1, BEFORE every data
 * column and before any pinned-left data column — data columns render at
 * `gridColumnStart: index + (markerWidth > 0 ? 2 : 1)`. `trackLefts`/`trackRights`/`leftOffsets`
 * are already shifted by `markerWidth` so callers never add it themselves; `CellCoord.col` and
 * this array's own `index` stay pure data-column indices throughout (PLAN §3: marker lives
 * outside the data index space).
 */
export type ColumnLayout = {
  template: string;
  leftOffsets: number[];
  rightOffsets: number[];
  trackLefts: number[];
  trackRights: number[];
  widths: number[];
  pins: (AnyColumnDef["pin"] | undefined)[];
  totalWidth: number;
  /** 0 when `rowMarkers` is 'none' — no marker track is added. */
  markerWidth: number;
};

/**
 * Computes shared column layout (widths, pin offsets, grid-template string) from live width
 * overrides. `availableWidth` is the viewport's clientWidth (excludes the scrollbar) used to
 * distribute `flex` leftover space; 0 on first render/SSR before measurement, which correctly
 * bails flex distribution to base widths until the real measurement lands.
 */
export function useColumnLayout(columns: readonly AnyColumnDef[], availableWidth = 0): ColumnLayout {
  const ids = useMemo(() => columns.map((c) => c.id), [columns]);
  const overrides = useDataGridColumnWidths(ids);
  const rowMarkers = useDataGridRowMarkers();
  return useMemo(() => {
    const mWidth = markerWidth(rowMarkers);
    const baseWidths = columns.map((column, i) => resolveColumnWidth(column, overrides[i]));
    // Manual resize (a live override) fixes the column and removes it from flex distribution.
    const flexes = columns.map((column, i) => (overrides[i] === undefined ? column.flex : undefined));
    const maxWidths = columns.map((column) => column.maxWidth ?? Number.POSITIVE_INFINITY);
    const widths = distributeFlexWidths(baseWidths, flexes, maxWidths, Math.max(0, availableWidth - mWidth));
    const pins = columns.map((c) => c.pin);
    const lefts = trackLefts(widths).map((l) => l + mWidth);
    const dataTemplate = encodeTemplate(widths);
    return {
      template: mWidth > 0 ? `${mWidth}px ${dataTemplate}` : dataTemplate,
      // the marker column is always pinned-left before any pinned data column, so every
      // pin-left offset shifts by its width; pin-right is unaffected (marker never pins right).
      leftOffsets: pinLeftOffsets(widths, pins).map((o) => o + mWidth),
      rightOffsets: pinRightOffsets(widths, pins),
      trackLefts: lefts,
      trackRights: trackRights(widths, lefts),
      widths,
      pins,
      totalWidth: widths.reduce((a, b) => a + b, 0) + mWidth,
      markerWidth: mWidth,
    };
  }, [columns, overrides, rowMarkers, availableWidth]);
}

/** A visible column paired with its real (unwindowed) index, used for grid placement + pin var lookup. */
export type WindowedColumn = { column: AnyColumnDef; index: number };

/**
 * Context passed to {@link RowBandsSpec.renderBand} for one band — exactly what root.tsx already
 * computed to render `DataGridPinnedRowBand` pre-extraction (workplan #48 cut #3). `ariaRowIndexBase`
 * is root's own aria index-layout math (header=1, top band next, then data rows, bottom band last),
 * so the add-on never has to know rowCount or the other band's length.
 */
export type RowBandRenderCtx = {
  position: "top" | "bottom";
  rows: readonly unknown[];
  windowedColumns: readonly WindowedColumn[];
  layout: ColumnLayout;
  rowHeight: number;
  template: string;
  /** The sticky header track's own height (not including either band). */
  headerHeight: number;
  ariaRowIndexBase: number;
};

/**
 * Provider-level row-bands seam (workplan #48 cut #3): unlike `overlayPlugins` (pure paint, no
 * layout impact), bands affect band heights and `aria-rowcount`, which root.tsx must know
 * SYNCHRONOUSLY at first render (SSR + no one-frame layout shift) — so this is a spec object, not a
 * mount-effect registration like `fillHandlers`. Core only reads `topRows.length`/`bottomRows.length`
 * for its own arithmetic and calls `render` where it used to render `DataGridPinnedRowBand` directly;
 * it never inspects the row contents. `data-grid-pinned-rows`'s `useDataGridPinnedRows` is the
 * motivating (and so far only) producer.
 */
export type RowBandsSpec = {
  topRows: readonly unknown[];
  bottomRows: readonly unknown[];
  renderBand: (ctx: RowBandRenderCtx) => ReactNode;
};

/**
 * Render-prop for the per-column header menu slot (PLAN §3 "Pinning UX", diceui-style primary
 * pin/sort surface). `trigger` is the core's own ghost-chevron button element — the renderer wraps
 * it as its dropdown's trigger (e.g. `<DropdownMenuTrigger render={trigger} />`) so core keeps sole
 * ownership of the trigger's visuals/aria-label while the add-on owns the popover + menu items.
 * A concrete `ReactElement` (not the broader `ReactNode`): Base UI's `render` prop requires one.
 */
export type HeaderMenuRenderer = (ctx: { column: AnyColumnDef; index: number; trigger: ReactElement }) => ReactNode;

/** Context passed to {@link MarkerCellRenderer} for one row's marker cell. */
export type MarkerCellRenderCtx = {
  /** 0-based view row index (the marker column's own numbering space, minus one). */
  viewRowIndex: number;
  /** The ROWS channel only: this row is selected as a whole (marker press/drag, Shift+Space). Cell or column selection never flips it — mirrors `useDataGridIsRowChannelSelected`. */
  isRowChannelSelected: boolean;
  /** The CELL or COLUMN channel covers at least one cell of this row. Independent of `isRowChannelSelected`, so a renderer can tell "this row is selected" apart from "cells in this row are selected" — mirrors `useDataGridIsRowCellSelected`. */
  isCellSelected: boolean;
};

/** Context passed to {@link MarkerHeaderRenderer} for the marker column's header cell. */
export type MarkerHeaderRenderCtx = {
  /** The select-all state the built-in header checkbox shows. */
  allSelected: "checked" | "indeterminate" | "unchecked";
};

/**
 * Custom row-marker cell renderer: replaces the built-in row number/checkbox CONTENT inside the
 * marker column (requires a non-`'none'` `rowMarkers` mode; the mode still drives the track width,
 * and the cell's own press/drag row-selection gesture stays on the wrapper). Pass a stable identity.
 */
export type MarkerCellRenderer = (ctx: MarkerCellRenderCtx) => ReactNode;

/** Custom marker-header renderer: replaces the built-in select-all checkbox; same track and width. Pass a stable identity. */
export type MarkerHeaderRenderer = (ctx: MarkerHeaderRenderCtx) => ReactNode;

/** Layout context shared by header/body so they don't recompute widths independently and never desync on row height, and so both consume the SAME column window (no drift between two independent subscriptions). */
export type DataGridRootContextValue = {
  scrollRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
  columns: readonly AnyColumnDef[];
  /** Columns in the current column window, in display order, each tagged with its real index. */
  windowedColumns: readonly WindowedColumn[];
  layout: ColumnLayout;
  rowHeight: number;
  /** The sticky header track's own height — header.tsx's literal row height, NOT including any pinned band. Consumers computing "where data row 0 starts" need `headerHeight + pinnedTopHeight` (PLAN §3 "shrunken effective viewport"); body.tsx does this itself for `useRowWindow`/the canvas transform. */
  headerHeight: number;
  /** Pinned-top row band height (px); 0 when `rowBands` is unset or its `topRows` is empty. */
  pinnedTopHeight: number;
  /** Pinned-bottom row band height (px); 0 when `rowBands` is unset or its `bottomRows` is empty. */
  pinnedBottomHeight: number;
  /** `rowBands.topRows.length` (workplan #48 cut #3) — body.tsx's `ariaRowIndexOffset` needs only the count, never the row contents (core doesn't own pinned-row semantics anymore). */
  pinnedTopCount: number;
  /** Full RLE grid-template-columns string — the alignment source of truth for both layers. */
  template: string;
  interaction: GridInteractionHandlers;
  /** Resolved layout direction for this grid — the single value every direction-aware seam inside the root reads (header reorder half-test, resize delta, pin-shadow measurement). */
  direction: GridDirection;
  readOnly?: boolean;
  /** Optional per-column header menu slot (ghost chevron trigger); undefined renders nothing. */
  renderHeaderMenu?: HeaderMenuRenderer;
  /** Optional custom row-marker cell renderer; undefined renders the built-in number/checkbox. */
  renderMarker?: MarkerCellRenderer;
  /** Optional custom marker-header renderer; undefined renders the built-in select-all checkbox. */
  renderMarkerHeader?: MarkerHeaderRenderer;
  /**
   * Programmatic row/cell class hooks (PLAN §6), routed through this context rather than a
   * per-row/per-cell prop. `DataGridRoot` DOES re-render on active-cell moves (the activeColumn
   * subscription, root.tsx) as well as scroll/window-shift ticks, but its context value is
   * `useMemo`'d on real deps (root.tsx) — a render that doesn't change any field here (e.g. an
   * active-cell move within the same column window) hands out the identical value reference, so
   * `cell.tsx`'s direct `useDataGridRootContext()` read doesn't re-render either, keeping this off
   * the memoized `DataGridRow`/`DataGridCell` hot path the wasted-render regression test guards.
   */
  getRowClassName?: GetRowClassName<unknown>;
  getCellClassName?: GetCellClassName<unknown>;
  /** Forwarded to each cell's click handler; see {@link DataGridRootProps.onCellClick} in root.tsx. */
  onCellClick?: OnCellClick<unknown>;
  /** Forwarded alongside `onCellClick`; see {@link DataGridRootProps.onRowClick} in root.tsx. */
  onRowClick?: OnRowClick<unknown>;
  /** Fired by `DataGridBody` after a row-window commit; see {@link DataGridRootProps.onRowWindowChange} in root.tsx. */
  onRowWindowChange?: (range: { start: number; end: number }) => void;
};

export const DataGridRootContext = createContext<DataGridRootContextValue | null>(null);

/** Resolves the shared root layout context; throws outside a `<DataGridRoot>`. */
export function useDataGridRootContext(): DataGridRootContextValue {
  const ctx = use(DataGridRootContext);
  if (!ctx) throw new Error("gridcn: DataGridHeader/DataGridBody must be used inside a <DataGridRoot>.");
  return ctx;
}
