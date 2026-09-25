"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { cn } from "@/lib/utils";
import type { DensityMode, GetCellClassName, GetRowClassName, Keymap, OnCellClick, OnRowClick } from "./types";
import { DEFAULT_KEYMAP, validateKeymap } from "./keyboard";
import {
  useDataGridActions,
  useDataGridActiveColumn,
  useDataGridFillHandlers,
  useDataGridHasActiveCell,
  useDataGridLabels,
  useDataGridRowBands,
  useDataGridRowCount,
  useDataGridSelectionConfig,
  useDataGridVisibleColumns,
} from "./store";
import { useElementDimensions, useViewportElement } from "./windowing/use-scroll-snapshot";
import { directionSign, readResolvedDirection, type GridDirection } from "./windowing/direction";
import { useColumnWindow } from "./windowing/use-column-window";
import { useGridInteraction, type InteractionLayout } from "./interaction/use-grid-interaction";
import { useGridClipboard } from "./clipboard/use-grid-clipboard";
import {
  useColumnLayout,
  DataGridRootContext,
  type HeaderMenuRenderer,
  type MarkerCellRenderer,
  type MarkerHeaderRenderer,
} from "./layout-context";
import { resolveRowHeight } from "./rows/density";
import { useScrolledEdges } from "./windowing/use-scrolled-edges";
import { usePinShadowEdges } from "./windowing/use-pin-shadow-edges";
import { GRID_LAYER } from "./layers";
import { DataGridLoadingSkeleton, DataGridLoadingBar } from "./rows/loading-skeleton";
import { isDev } from "./is-dev";

/** Default sticky header track height (px); density/rowHeight only affect data rows, never the header. */
const HEADER_HEIGHT = 36;

/** Props for {@link DataGridRoot}. `TData` (default `unknown`) types the callback props below — annotate explicitly (e.g. `DataGridRoot<Person>`), there's no `data` prop here to infer it from. */
export type DataGridRootProps<TData = unknown> = {
  className?: string;
  /** Explicit row height (px); overrides `density` when set. */
  rowHeight?: number;
  /** Row-height preset: compact 28 / default 36 / comfortable 44. Ignored when `rowHeight` is set. */
  density?: DensityMode;
  /** Sticky header track height (px); `density` and `rowHeight` affect data rows only. Default 36. */
  headerHeight?: number;
  /** Extra unpinned columns rendered beyond the visible viewport on each side. Default 1. */
  columnOverscan?: number;
  /** Merged over `DEFAULT_KEYMAP`; per-action bindings here take precedence. */
  keymap?: Keymap;
  /**
   * Layout direction. Omitted, the grid reads the direction it inherits from the page (the `dir`
   * attribute on an ancestor, or the document default) once at mount — so a grid inside
   * `<html dir="rtl">` is right-to-left with no prop at all. Pass this to force one direction
   * independent of the page.
   *
   * `"rtl"` mirrors column order, pinned bands, pointer hit-testing, drag gestures, and the
   * chrome's popup placement. Arrow keys move VISUALLY: ArrowRight goes to the next column on the
   * screen, which is the previous column index. `Tab` keeps its reading order.
   */
  direction?: GridDirection;
  /** Disables editing and delete grid-wide, independent of any per-column `readOnly`. */
  readOnly?: boolean;
  /** Rendered centered in place of the body when there are zero rows in view. Never shown while `loading` is true. */
  emptyState?: ReactNode;
  /**
   * Presentational loading flag: zero rows renders viewport-filling
   * skeleton rows instead of the empty state; rows present keeps them visible and adds a slim
   * indeterminate bar under the header. Purely presentational — no data-fetch orchestration of its
   * own (that's `data-grid-lazy`'s job for per-window skeletons). Default `false`.
   */
  loading?: boolean;
  /**
   * Per-column header menu slot: rendered inline-end in each header cell as a ghost chevron
   * trigger, only when provided. The context-menu add-on's `DataGridHeaderDropdown` is the
   * intended renderer, reusing the same items as the header right-click menu.
   */
  renderHeaderMenu?: HeaderMenuRenderer;
  /**
   * Custom row-marker cell renderer: replaces the built-in row number/checkbox content inside the
   * marker column. Requires a non-`'none'` `rowMarkers` mode (the mode still drives the track width,
   * and the cell's own press/drag row-selection gesture stays on the wrapper); an interactive element
   * inside the rendered node owns its own events. See {@link MarkerCellRenderer}. Pass a stable identity.
   */
  renderMarker?: MarkerCellRenderer;
  /** Custom marker-header renderer: replaces the built-in select-all checkbox; same track and width. See {@link MarkerHeaderRenderer}. Pass a stable identity. */
  renderMarkerHeader?: MarkerHeaderRenderer;
  /** Row class hook, merged via `cn()` after the built-in row classes. Pass a stable identity — see {@link GetRowClassName}. */
  getRowClassName?: GetRowClassName<TData>;
  /** Cell class hook, merged via `cn()` after the built-in cell classes. Pass a stable identity — see {@link GetCellClassName}. */
  getCellClassName?: GetCellClassName<TData>;
  /** Fired on a plain click on any cell — see {@link OnCellClick}. Attached to the cell's own existing click handler, no new subscription. Pass a stable identity, same guidance as `getCellClassName`. */
  onCellClick?: OnCellClick<TData>;
  /** Fired alongside `onCellClick` once per click regardless of column — see {@link OnRowClick}. */
  onRowClick?: OnRowClick<TData>;
  /**
   * Fired after a row-window commit with the rendered data-row range `[start, end)` (inclusive
   * start, exclusive end — same convention as `useRowWindow`'s `RowWindow`). Only fires when the
   * range actually changed since the last call, including once for the initial mount commit; a
   * scroll tick that stays within the current window's overscan buffer does not re-fire it. Useful
   * for lazy-loading/prefetch/analytics add-ons; core has no fetching logic of its own.
   */
  onRowWindowChange?: (range: { start: number; end: number }) => void;
  children?: ReactNode;
};

/**
 * The scroll container: a plain `overflow:auto` div (real scroll element, native scrollbar) with
 * an in-flow Content div that provides the full virtual scroll extent, and inside it a
 * `position:sticky` Viewport that is pinned to the scrollport (MUI "controlled virtualizer"
 * pattern, research/mui-controlled-virtualizer.md). Native scroll only moves the Content div under
 * the sticky Viewport; 100% of visible row/header motion is the JS-written transform on the two
 * layers inside — the compositor can never reveal unrendered rows because rows never move via
 * native scroll (see research/scroll-blanking.md).
 */
export function DataGridRoot<TData = unknown>(props: DataGridRootProps<TData>): ReactNode {
  const {
    className,
    rowHeight: rowHeightProp,
    density,
    headerHeight: headerHeightProp,
    columnOverscan,
    keymap,
    direction: directionProp,
    readOnly,
    emptyState,
    loading = false,
    renderHeaderMenu,
    renderMarker,
    renderMarkerHeader,
    getRowClassName,
    getCellClassName,
    onCellClick,
    onRowClick,
    onRowWindowChange,
    children,
  } = props;
  const rowHeight = resolveRowHeight(density, rowHeightProp);
  const headerHeight = headerHeightProp ?? HEADER_HEIGHT;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Roving-tabindex bootstrap (see the root's onFocus below) must only fire for a genuine
  // keyboard Tab into the grid — a mouse gesture on a header/marker cell (row/column channel
  // selection, no `activeCell`) also focuses the root as a side effect and must NOT clobber that
  // selection back to (0,0). Any pointerdown anywhere in the grid (captured phase, fires before
  // the resulting focus event in the same tick) marks the next focus as pointer-originated.
  const pointerInteractionRef = useRef(false);
  // DOM-inherited default: `ltr` until the scroll element exists, then the real computed direction.
  // Only an explicit prop skips the measurement entirely, so an `ltr` page (the overwhelmingly
  // common case) settles on the same value it started with and never re-renders for this.
  const [domDirection, setDomDirection] = useState<GridDirection>("ltr");
  useEffect(() => {
    if (directionProp !== undefined) return;
    setDomDirection(readResolvedDirection(scrollRef.current));
  }, [directionProp]);
  const direction = directionProp ?? domDirection;
  const isRtl = direction === "rtl";
  const visibleColumns = useDataGridVisibleColumns();
  const rowCount = useDataGridRowCount();
  // labels.grid.emptyState is the translatable default; the emptyState prop (ReactNode) still wins when provided.
  const gridLabels = useDataGridLabels().grid;
  const emptyStateLabel = gridLabels.emptyState;
  // Provider-level seam: defaults to EMPTY_ROW_BANDS (store.tsx) when no add-on registered one —
  // same identity-guardrailed sync-prop pattern as overlayPlugins, read here (not via a
  // DataGridRootProps prop) so it's available before DataGridRoot even mounts.
  const rowBands = useDataGridRowBands();
  const pinnedTopRows = rowBands.topRows;
  const pinnedBottomRows = rowBands.bottomRows;
  const pinnedTopHeight = pinnedTopRows.length * rowHeight;
  const pinnedBottomHeight = pinnedBottomRows.length * rowHeight;
  // Effective header height: the sticky header track PLUS any pinned-top band — every "data row 0
  // starts here" computation (row window, scroll-into-view, canvas transform) uses this, not
  // HEADER_HEIGHT alone, so the pinned-top band is treated as part of the fixed chrome above the
   // scrollable data rows.
  const effectiveHeaderHeight = headerHeight + pinnedTopHeight;
  // column-only primitive subscription: the root re-renders when the active COLUMN changes
  // (force-render-active-column below), never on row-only moves — vertical arrows stay cheap.
  const activeColumn = useDataGridActiveColumn();
  // primitive boolean, not the full activeCell — see useDataGridHasActiveCell's doc for why this
  // matters (a full CellCoord subscription here would re-render the root, and thus the whole tree
  // via its context value, on every single row/column move).
  const hasActiveCell = useDataGridHasActiveCell();
  // WAI-ARIA grid pattern: aria-multiselectable reflects whether more than one cell can be
  // selected at once — true whenever any multi-cell channel (range/row/column/multi-range) is on.
  const { enableRangeSelection, enableRowSelection, enableColumnSelection, enableMultiRange } = useDataGridSelectionConfig();
  const ariaMultiselectable = enableRangeSelection || enableRowSelection || enableColumnSelection || enableMultiRange;
  // Dimensions-only (resize-rate), not the full scroll snapshot — a plain useScrollSnapshot here
  // would re-render this whole tree on every scroll pixel, negating row memoization (mustFix).
  // Read before useColumnLayout: clientWidth drives flex-column distribution below.
  const dimensions = useElementDimensions(scrollRef);
  const layout = useColumnLayout(visibleColumns, dimensions.clientWidth);
  const { template, leftOffsets, rightOffsets, trackLefts: lefts, trackRights: rights, widths, pins, totalWidth } =
    layout;

  const effectiveKeymap = useMemo(() => ({ ...DEFAULT_KEYMAP, ...keymap }), [keymap]);
  const interactionLayout: InteractionLayout = useMemo(() => {
    // the marker column (when present) is always pinned-left before every data column, so it's
    // part of the static-pinned-left band for pointer hit-testing (pointerToCoord's columnAtX).
    let pinnedLeftWidth = layout.markerWidth;
    let pinnedRightWidth = 0;
    for (let i = 0; i < widths.length; i++) {
      // i < widths.length by loop condition, pins is same-length parallel array
      if (pins[i] === "left") pinnedLeftWidth += widths[i]!;
      if (pins[i] === "right") pinnedRightWidth += widths[i]!;
    }
    return {
      trackLefts: lefts,
      trackRights: rights,
      rowHeight,
      dataRowTop: effectiveHeaderHeight,
      pinnedBottomHeight,
      pinnedLeftWidth,
      pinnedRightWidth,
      pins,
      direction,
    };
  }, [lefts, rights, rowHeight, pins, widths, layout.markerWidth, effectiveHeaderHeight, pinnedBottomHeight, direction]);
  const hasPinnedLeft = interactionLayout.pinnedLeftWidth > 0;
  const hasPinnedRight = interactionLayout.pinnedRightWidth > 0;
  // Registered by the `data-grid-fill` add-on's tracker component — it must render
  // somewhere inside THIS subtree to reach scrollRef/layout via useDataGridRootContext, a level
  // below this very hook call, so it reaches back up through the store rather than a prop (see
  // `fillHandlers`'s doc comment in store.tsx). `null` (add-on absent, or not yet mounted) makes
  // mod+D/mod+R/Escape-mid-drag no-ops — useGridInteraction already treats each as optional.
  const fillHandlers = useDataGridFillHandlers();
  const interaction = useGridInteraction({
    scrollRef,
    layout: interactionLayout,
    keymap: effectiveKeymap,
    readOnly,
    fillDown: fillHandlers?.fillDown,
    fillRight: fillHandlers?.fillRight,
    cancelFillDrag: fillHandlers?.cancelFillDrag,
  });
  useGridClipboard({ rootRef: scrollRef, readOnly });

  // Registers this mount's scroll-into-view on the store so add-ons outside this subtree (e.g.
  // data-grid-toolbar's search, a DataGridRoot sibling) can reach it; cleared on unmount.
  const actions = useDataGridActions();
  useEffect(() => {
    actions._registerScrollToCell(interaction.scrollCellIntoView);
    return () => actions._registerScrollToCell(null);
  }, [actions, interaction.scrollCellIntoView]);

  // Mirrors `readOnly` into the store so add-on mutation surfaces outside this subtree (context
  // menu, useDataGridClipboard) honor it too — false on unmount, matching the prop's own default.
  useEffect(() => {
    actions._registerReadOnly(Boolean(readOnly));
    return () => actions._registerReadOnly(false);
  }, [actions, readOnly]);

  // Mirrors the effective (merged) keymap into the store so surfaces outside this subtree (the
  // data-grid-keybindings add-on's dialog) read the same single source of truth as interaction handling.
  useEffect(() => {
    actions._registerKeymap(effectiveKeymap);
    validateKeymap(effectiveKeymap);
    return () => actions._registerKeymap(DEFAULT_KEYMAP);
  }, [actions, effectiveKeymap]);

  useViewportElement(scrollRef, viewportRef);
  // Imperative data-scrolled-left/right writer (for the pinned-edge shadows) — no React re-render per tick.
  useScrolledEdges(scrollRef, viewportRef);
  // Measures the pin-shadow's real anchor from the boundary header cell's own rendered edge,
  // instead of a JS-summed width total that can drift a subpixel from CSS Grid's own track
  // rounding (see the hook's doc comment) — no React re-render, imperative CSS var write.
  // layout signature, not just pins: adding a marker column MOVES the pinned header sideways
  // without resizing it or the viewport, so the ResizeObserver never fires for it.
  usePinShadowEdges(viewportRef, hasPinnedLeft, hasPinnedRight, direction, `${pins.join(",")}|${layout.markerWidth}|${widths.join(",")}`);

  // Dev-only guardrail: getRowClassName/getCellClassName reach
  // row.tsx/cell.tsx through this root's context value rather than a per-row prop specifically so a
  // DataGridRoot re-render (rare — structural only, see the useScrollSnapshot comment above) doesn't
  // reach the memoized row/cell hot path; an unstable identity here would still bust the CONTEXT
  // consumers on every DataGridRoot render, same anti-pattern as unstable `columns`/`data`.
  const prevGetRowClassName = useRef(getRowClassName);
  const prevGetCellClassName = useRef(getCellClassName);
  const prevOnCellClick = useRef(onCellClick);
  const prevOnRowClick = useRef(onRowClick);
  useEffect(() => {
    if (isDev()) {
      if (prevGetRowClassName.current !== undefined && prevGetRowClassName.current !== getRowClassName) {
        console.warn("[data-grid] getRowClassName identity changed since the last render; pass a stable reference (e.g. useCallback) or every row re-renders");
      }
      if (prevGetCellClassName.current !== undefined && prevGetCellClassName.current !== getCellClassName) {
        console.warn("[data-grid] getCellClassName identity changed since the last render; pass a stable reference (e.g. useCallback) or every cell re-renders");
      }
      if (prevOnCellClick.current !== undefined && prevOnCellClick.current !== onCellClick) {
        console.warn("[data-grid] onCellClick identity changed since the last render; pass a stable reference (e.g. useCallback) or every cell re-renders");
      }
      if (prevOnRowClick.current !== undefined && prevOnRowClick.current !== onRowClick) {
        console.warn("[data-grid] onRowClick identity changed since the last render; pass a stable reference (e.g. useCallback) or every row re-renders");
      }
    }
    prevGetRowClassName.current = getRowClassName;
    prevGetCellClassName.current = getCellClassName;
    prevOnCellClick.current = onCellClick;
    prevOnRowClick.current = onRowClick;
  }, [getRowClassName, getCellClassName, onCellClick, onRowClick]);

  const { indices: columnWindowIndices } = useColumnWindow(scrollRef, {
    widths,
    pins,
    markerWidth: layout.markerWidth,
    contentWidth: totalWidth,
    overscan: columnOverscan,
  });
  const columnIndices = useMemo(() => {
    const indices = columnWindowIndices;
    // the active cell's column always renders, even off-window, so focus survives scroll
    if (activeColumn !== null && !indices.includes(activeColumn) && activeColumn < visibleColumns.length) {
      return [...indices, activeColumn].sort((a, b) => a - b);
    }
    return indices;
  }, [columnWindowIndices, activeColumn, visibleColumns.length]);

  // Full scroll extent includes both pinned bands: the top band sits above row 0 (part of
  // effectiveHeaderHeight already), the bottom band needs its own extra room reserved past the
  // last data row so the native scrollbar's range still covers exactly the data rows plus both bands.
  const contentHeight = effectiveHeaderHeight + rowCount * rowHeight + pinnedBottomHeight;

  // loading+empty: enough skeleton rows to fill the viewport below the header, plus
  // one so a partial row is visible at the bottom edge like the real windowed body would show.
  const showLoadingSkeleton = loading && rowCount === 0;
  const skeletonRowCount = showLoadingSkeleton
    ? Math.max(1, Math.ceil((dimensions.clientHeight - effectiveHeaderHeight) / rowHeight) + 1)
    : 0;
  const showLoadingBar = loading && rowCount > 0;

  const rootStyle: CSSProperties = {
    contain: "content",
    // Explicit, not incidental: contain's paint containment happens to create a stacking
    // context, but the guarantee the grid RELIES on is isolation — no internal GRID_LAYER
    // value may ever compete with the page's own stacking order (shadcn dialogs sit at z-50).
    isolation: "isolate",
  };

  const contentStyle: CSSProperties = {
    position: "relative",
    width: totalWidth,
    height: contentHeight,
  };

  const viewportStyle: CSSProperties & Record<string, string | number> = {
    position: "sticky",
    insetBlockStart: 0,
    insetInlineStart: 0,
    display: "block",
    width: dimensions.clientWidth || "100%",
    height: dimensions.clientHeight || "100%",
    overflow: "hidden",
    "--grid-row-height": `${rowHeight}px`,
    "--grid-viewport-width": `${dimensions.clientWidth}px`,
    "--grid-content-width": `${totalWidth}px`,
    // Sign of the horizontal scroll transform. CSS Grid and every inset-inline-* offset mirror
    // themselves under dir=rtl, but `transform` is always physical — so the canvas/header/band
    // transforms multiply the (always positive) scroll offset by this instead of a literal -1. The
    // browser resolves it at compositing time, which is what keeps the per-tick scroll write, and
    // the whole hot path, byte-for-byte identical in both directions.
    "--grid-dir": directionSign(direction),
  };
  visibleColumns.forEach((_, i) => {
    // Recomputed meaning: static parts only — the live scroll term is added in
    // the cell's own inset calc(), not baked in here, so one scroll-var write moves every pinned cell.
    viewportStyle[`--grid-pin-left-${i}`] = `${leftOffsets[i]}px`;
    viewportStyle[`--grid-pin-right-${i}`] = `${rightOffsets[i]}px`;
    viewportStyle[`--grid-track-left-${i}`] = `${lefts[i]}px`;
    viewportStyle[`--grid-track-right-${i}`] = `${rights[i]}px`;
  });

  // Windowed columns, in display order, with their real index preserved for grid placement.
  // columnIndices are indices into visibleColumns by useColumnWindow's contract.
  const windowedColumns = useMemo(
    () => columnIndices.map((index) => ({ column: visibleColumns[index]!, index })),
    [columnIndices, visibleColumns],
  );

  // Stable context value on real deps (mustFix): DataGridRoot re-renders on every activeCell move
  // (the activeColumn subscription above), and cell.tsx/header.tsx read this context directly —
  // a fresh object literal here would bust every context consumer (all windowed cells, header
  // cells) on every click/arrow-key move even though most of these fields didn't actually change.
  const contextValue = useMemo(
    () => ({
      scrollRef,
      viewportRef,
      columns: visibleColumns,
      windowedColumns,
      layout,
      rowHeight,
      headerHeight,
      pinnedTopHeight,
      pinnedBottomHeight,
      pinnedTopCount: pinnedTopRows.length,
      template,
      interaction,
      direction,
      readOnly,
      renderHeaderMenu,
      renderMarker,
      renderMarkerHeader,
      // Erasure boundary: DataGridRootContextValue is one shared non-generic context for every
      // DataGridRoot<TData>, so a typed caller's callbacks widen to <unknown> here — safe because
      // every row they ever receive at runtime came from this same subtree's DataGridProvider.
      getRowClassName: getRowClassName as GetRowClassName<unknown> | undefined,
      getCellClassName: getCellClassName as GetCellClassName<unknown> | undefined,
      onCellClick: onCellClick as OnCellClick<unknown> | undefined,
      onRowClick: onRowClick as OnRowClick<unknown> | undefined,
      onRowWindowChange,
    }),
    [
      scrollRef,
      viewportRef,
      visibleColumns,
      windowedColumns,
      layout,
      rowHeight,
      headerHeight,
      pinnedTopHeight,
      pinnedBottomHeight,
      pinnedTopRows.length,
      template,
      interaction,
      direction,
      readOnly,
      renderHeaderMenu,
      renderMarker,
      renderMarkerHeader,
      getRowClassName,
      getCellClassName,
      onCellClick,
      onRowClick,
      onRowWindowChange,
    ],
  );

  return (
    // Two switches, and neither substitutes for the other: `dir` on the scroll root drives every
    // CSS `rtl:` variant and all logical properties (React context is invisible to CSS), while
    // DirectionProvider drives Base UI's own JS positioning and roving focus for all the chrome —
    // menus, popovers, dialogs (the DOM attribute is invisible to React context).
    <DirectionProvider direction={direction}>
    <DataGridRootContext value={contextValue}>
      <div
        ref={scrollRef}
        role="grid"
        dir={direction}
        // Roving-tabindex bootstrap (WAI-ARIA APG grid pattern): before any cell has been made
        // active, every cell renders tabIndex=-1, so the root itself must be the one tabbable
        // entry point or a keyboard user can never reach the grid at all. Once a cell becomes
        // active it takes over as the sole tab stop (see cell.tsx), and the root reverts to -1.
        tabIndex={!hasActiveCell && rowCount > 0 ? 0 : -1}
        aria-rowcount={rowCount + 1 + pinnedTopRows.length + pinnedBottomRows.length}
        aria-colcount={visibleColumns.length}
        aria-multiselectable={ariaMultiselectable || undefined}
        aria-readonly={readOnly || undefined}
        aria-busy={loading || undefined}
        className={cn("relative select-none overflow-auto rounded-md border border-border bg-background text-sm", className)}
        style={rootStyle}
        onKeyDown={interaction.onKeyDown}
        onPointerDown={interaction.onRootPointerDown}
        onPointerDownCapture={() => {
          pointerInteractionRef.current = true;
        }}
        onFocus={(event) => {
          // only a focus landing directly on the root, NOT following a pointer gesture (Tab from
          // outside, the only case tabIndex=0 is reachable in) seeds the first cell — a header/
          // marker click's own row/column-channel selection must not be clobbered back to (0,0),
          // and focus bubbling up from a cell that already made itself active must not re-seed either.
          if (event.target === event.currentTarget && !pointerInteractionRef.current && !hasActiveCell && rowCount > 0) {
            actions.selectCell({ col: 0, row: 0 });
          }
          pointerInteractionRef.current = false;
        }}
      >
        {/* in-flow, sized to the full virtual extent — provides native scroll range; zero visible children besides the viewport */}
        <div style={contentStyle}>
          <div ref={viewportRef} style={viewportStyle}>
            {children}
            {pinnedTopRows.length > 0 &&
              rowBands.renderBand({
                position: "top",
                rows: pinnedTopRows,
                windowedColumns,
                layout,
                rowHeight,
                template,
                headerHeight,
                ariaRowIndexBase: 2,
              })}
            {pinnedBottomRows.length > 0 &&
              rowBands.renderBand({
                position: "bottom",
                rows: pinnedBottomRows,
                windowedColumns,
                layout,
                rowHeight,
                template,
                headerHeight,
                ariaRowIndexBase: 2 + pinnedTopRows.length + rowCount,
              })}
            {/* the empty state never shows while loading — a zero-row loading grid renders the skeleton below instead */}
            {rowCount === 0 && !loading && (
              <div
                data-grid-empty-state=""
                className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"
                style={{ insetBlockStart: effectiveHeaderHeight }}
              >
                {emptyState ?? emptyStateLabel}
              </div>
            )}
            {showLoadingSkeleton && (
              <DataGridLoadingSkeleton
                rowCount={skeletonRowCount}
                columnCount={visibleColumns.length}
                rowHeight={rowHeight}
                headerHeight={effectiveHeaderHeight}
                ariaLabel={gridLabels.loading}
              />
            )}
            {showLoadingBar && <DataGridLoadingBar headerHeight={effectiveHeaderHeight} ariaLabel={gridLabels.loading} />}
            {hasPinnedLeft && (
              <div
                data-grid-pin-shadow="left"
                aria-hidden="true"
                className="pointer-events-none absolute inset-block-start-0 h-full w-2 opacity-0 transition-opacity in-data-scrolled-left:opacity-100"
                style={{
                  insetInlineStart: `var(--grid-pin-shadow-left-x, ${interactionLayout.pinnedLeftWidth}px)`,
                  // background gradient, not box-shadow: a box-shadow's offset+blur paints its darkest
                  // pixels well outside this element's own box, floating the visible shadow off the
                  // pinned cell's edge — a gradient anchored at inset-inline-start:0 (the edge itself)
                  // guarantees the darkest pixel sits exactly on the boundary this element is measured to.
                  // Gradient direction keywords are physical, so the fade is mirrored explicitly here.
                  backgroundImage: `linear-gradient(to ${isRtl ? "left" : "right"}, var(--grid-pin-shadow), transparent)`,
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
            )}
            {hasPinnedRight && (
              <div
                data-grid-pin-shadow="right"
                aria-hidden="true"
                className="pointer-events-none absolute inset-block-start-0 h-full w-2 opacity-0 transition-opacity in-data-scrolled-right:opacity-100"
                style={{
                  insetInlineEnd: `var(--grid-pin-shadow-right-x, ${interactionLayout.pinnedRightWidth}px)`,
                  backgroundImage: `linear-gradient(to ${isRtl ? "right" : "left"}, var(--grid-pin-shadow), transparent)`,
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
            )}
            {pinnedTopRows.length > 0 && (
              <div
                data-grid-pin-shadow="top"
                aria-hidden="true"
                className="pointer-events-none absolute inset-inline-start-0 h-2 w-full opacity-0 transition-opacity in-data-scrolled-top:opacity-100"
                style={{
                  insetBlockStart: effectiveHeaderHeight,
                  backgroundImage: "linear-gradient(to bottom, var(--grid-pin-shadow), transparent)",
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
            )}
            {pinnedBottomRows.length > 0 && (
              <div
                data-grid-pin-shadow="bottom"
                aria-hidden="true"
                className="pointer-events-none absolute inset-inline-start-0 h-2 w-full opacity-0 transition-opacity in-data-scrolled-bottom:opacity-100"
                style={{
                  insetBlockEnd: pinnedBottomHeight,
                  backgroundImage: "linear-gradient(to top, var(--grid-pin-shadow), transparent)",
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </DataGridRootContext>
    </DirectionProvider>
  );
}
