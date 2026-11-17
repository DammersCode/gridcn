"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { computeHeaderRows } from "./columns/column-groups";
import { cn } from "@/lib/utils";
import type { DensityMode, GetCellClassName, GetRowClassName } from "./types";
import {
  useDataGridActions,
  useDataGridInternalActions,
  useDataGridHasActiveCell,
  useDataGridInstanceId,
  useDataGridKeymap,
  useDataGridLabels,
  useDataGridPluginBands,
  useDataGridPluginMounts,
  useDataGridReadOnly,
  useDataGridRowCount,
  useDataGridSelectionConfig,
  useDataGridStore,
  useDataGridStoreApi,
  useDataGridVisibleColumns,
  useDataGridColumnGroupModel,
} from "./store";
import { useElementDimensions, useViewportElement } from "./virtualization/use-scroll-snapshot";
import { directionSign, readResolvedDirection, type GridDirection } from "./virtualization/direction";
import { useColumnWindow } from "./virtualization/use-column-window";
import { useRowHover } from "./virtualization/use-row-hover";
import { dispatchGridAction, useGridInteraction, type InteractionLayout } from "./interaction/use-grid-interaction";
import { useGridClipboard } from "./clipboard/use-grid-clipboard";
import {
  useColumnLayout,
  DataGridRootContext,
  type HeaderFilterRenderer,
  type HeaderMenuRenderer,
  type MarkerCellRenderer,
  type MarkerHeaderRenderer,
  type GroupLabelRenderer,
} from "./layout-context";
import { MAX_RENDERED_ROWS } from "./virtualization/use-row-window";
import { resolveHeaderHeight, resolveRowHeight } from "./rows/density";
import { useScrolledEdges } from "./virtualization/use-scrolled-edges";
import { usePinShadowEdges } from "./virtualization/use-pin-shadow-edges";
import { GRID_LAYER } from "./layers";
import { useLoadAnnouncement } from "./use-load-announcement";
import { DataGridLoadingSkeleton, DataGridLoadingBar, DataGridLoadingProgress } from "./rows/loading-skeleton";
import { Button } from "@/components/ui/button";
import { useSecondRootWarning, useUnnamedGridWarning } from "./root-dev-warnings";
import { useClassNameRevision, type RenderedRows } from "./rows/use-class-name-revision";
import { useLatestRenderer } from "./rows/use-latest-renderer";
import { GRID_ATTR, gridAttrSelector } from "./data-attributes";
import { closestGridRoot } from "./interaction/closest-grid-root";

// The item's cssVars theme this token on CLI install; the fallback covers a manual copy without them.
const PIN_SHADOW = "var(--grid-pin-shadow, oklch(0 0 0 / 10%))";
// Edge shadows default to the pin color; `--grid-scroll-shadow: transparent` hides them and keeps pinned-band shadows.
const SCROLL_SHADOW = `var(--grid-scroll-shadow, ${PIN_SHADOW})`;
const SHADOW_SIZE = "var(--grid-shadow-size, 8px)";
const shadowColor = (pinned: boolean) => (pinned ? PIN_SHADOW : SCROLL_SHADOW);
const shadowVar = (color: string) => ({ "--grid-shadow-color": color }) as CSSProperties;

/** Why the empty state shows: no rows in the data at all, or rows exist but none are in view (a server filter or search that returned no rows counts as `"filtered"`). */
export type EmptyStateReason = "no-data" | "filtered";

/** Function form of {@link DataGridRootProps.emptyState} — receives why the view is empty. */
export type EmptyStateRenderer = (ctx: { reason: EmptyStateReason }) => ReactNode;

/** Which built-in loading presentation the slot is replacing: the skeleton (zero rows in view) or the header bar (rows present). */
export type LoadingStateReason = "no-data" | "rows-present";

/** Context of the function form of {@link DataGridRootProps.errorState}. */
export type ErrorStateContext = { error: unknown; retry: (() => void) | undefined };

/** Function form of {@link DataGridRootProps.errorState}. */
export type ErrorStateRenderer = (ctx: ErrorStateContext) => ReactNode;

/** Function form of {@link DataGridRootProps.loadingState} — receives which built-in presentation the node replaces. */
export type LoadingStateRenderer = (ctx: { reason: LoadingStateReason }) => ReactNode;

/** Props for {@link DataGridRoot}. `TData` (default `unknown`) types the callback props below — annotate explicitly (e.g. `DataGridRoot<Person>`), there's no `data` prop here to infer it from. */
export type DataGridRootProps<TData = unknown> = {
  className?: string;
  /** Accessible name of the grid. Set it, or `aria-labelledby`: a grid takes no name from a labelled ancestor. */
  "aria-label"?: string;
  /** Id of the element that names the grid. */
  "aria-labelledby"?: string;
  /** Explicit row height (px); overrides `density` when set. */
  rowHeight?: number;
  /** Marker track width (px); overrides the width of the `rowMarkers` mode. Ignored with `rowMarkers="none"`. */
  markerWidth?: number;
  /** Row-height preset: compact 28 / default 36 / comfortable 44. Ignored when `rowHeight` is set. */
  density?: DensityMode;
  /** Sticky header track height (px) of one header row. Default follows `density`: 32, 36, or 40. */
  headerHeight?: number;
  /** Extra unpinned columns rendered beyond the visible viewport on each side. Default 1. */
  columnOverscan?: number;
  /**
   * Layout direction. Omitted, the grid reads the direction it inherits from the page (the `dir`
   * attribute on an ancestor, or the document default) at mount and again whenever a `dir`
   * attribute in the document changes — so a grid inside `<html dir="rtl">` is right-to-left with
   * no prop at all. Pass this to force one direction independent of the page.
   *
   * `"rtl"` mirrors column order, pinned bands, pointer hit-testing, drag gestures, and the
   * chrome's popup placement. Arrow keys move VISUALLY: ArrowRight goes to the next column on the
   * screen, which is the previous column index. `Tab` keeps its reading order.
   */
  direction?: GridDirection;
  /**
   * Rendered centered in place of the body when there are zero rows in view. Accepts a node or a
   * function receiving `{ reason }` — `"no-data"` when the data array is empty, `"filtered"` when
   * rows exist but none are in view, or when `data` is empty under `filterMode="server"` with an
   * active filter or quick search. Never shown while `loading` is true or `error` is set.
   */
  emptyState?: ReactNode | EmptyStateRenderer;
  /**
   * Presentational loading flag: zero rows renders viewport-filling
   * skeleton rows instead of the empty state; rows present keeps them visible and adds a slim
   * indeterminate bar under the header. Purely presentational — no data-fetch orchestration of its
   * own (that's scroll mode's job for per-block skeletons). Default `false`.
   */
  loading?: boolean;
  /**
   * Replaces the built-in loading presentation while `loading` is true: the viewport-filling
   * skeleton (zero rows in view) or the slim indeterminate bar under the header (rows present).
   * Rendered positioned directly under the header at full width, in place of the built-in it
   * replaces. The node owns its own accessibility — the built-ins' progressbar semantics do not
   * apply to it.
   */
  loadingState?: ReactNode | LoadingStateRenderer;
  /**
   * A failed load. Any value but `undefined` and `null` shows the error state: with zero rows a centered
   * message with a Retry button, with rows a slim alert bar under the header that keeps the rows visible.
   * The text is `labels.grid.errorState`; the error itself is never rendered. Presentational only: pair it
   * with `onRetry` (the server-rows hook passes both through `gridProps`).
   */
  error?: unknown;
  /** Called by the Retry button of the built-in error state. Without it the button is not shown. */
  onRetry?: () => void;
  /** Replaces the built-in error state. A node, or a function receiving `{ error, retry }`. When a focused control inside it unmounts with the bar, focus returns to the grid. */
  errorState?: ReactNode | ErrorStateRenderer;
  /**
   * Per-column header menu slot: rendered inline-end in each header cell as a ghost chevron
   * trigger, only when provided. The context-menu add-on's `DataGridHeaderDropdown` is the
   * intended renderer, reusing the same items as the header right-click menu.
   */
  renderHeaderMenu?: HeaderMenuRenderer;
  /**
   * Per-column header filter slot: rendered inline-end in each header cell, only for columns that offer a
   * set filter (`isAnyOf` or `isNoneOf`) and are not `filterable: false`. The toolbar add-on's
   * `DataGridHeaderFilter` is the intended renderer.
   */
  renderHeaderFilter?: HeaderFilterRenderer;
  /**
   * Custom row-marker cell renderer: replaces the built-in row number/checkbox content inside the
   * marker column. Requires a non-`'none'` `rowMarkers` mode (the mode still drives the track width,
   * and the cell's own press/drag row-selection gesture stays on the wrapper); an interactive element
   * inside the rendered node owns its own events. See {@link MarkerCellRenderer}. Pass a stable identity.
   */
  renderMarker?: MarkerCellRenderer;
  /** Custom marker-header renderer: replaces the built-in select-all checkbox; same track and width. See {@link MarkerHeaderRenderer}. Pass a stable identity. */
  renderMarkerHeader?: MarkerHeaderRenderer;
  /** @internal Renders the content of a group row label; the default is "column: key (count)". Pass a stable identity. */
  renderGroupLabel?: GroupLabelRenderer;
  /** Row class hook, merged via `cn()` after the built-in row classes. An inline function is fine — see {@link GetRowClassName}. */
  getRowClassName?: GetRowClassName<TData>;
  /** Cell class hook, merged via `cn()` after the built-in cell classes. An inline function is fine — see {@link GetCellClassName}. */
  getCellClassName?: GetCellClassName<TData>;
  /** Composition parts: header + body, or your own. The `DataGrid` wrapper defaults to header + body when omitted. */
  children?: ReactNode;
};

/** Every `DataGridRootProps` key the `DataGrid` wrapper keeps for the root; the rest (the sync props plus `store`) goes to the provider. */
export const DATA_GRID_ROOT_PROP_KEYS = [
  "className",
  "aria-label",
  "aria-labelledby",
  "rowHeight",
  "markerWidth",
  "density",
  "headerHeight",
  "columnOverscan",
  "direction",
  "emptyState",
  "loading",
  "loadingState",
  "error",
  "onRetry",
  "errorState",
  "renderHeaderMenu",
  "renderHeaderFilter",
  "renderMarker",
  "renderMarkerHeader",
  "renderGroupLabel",
  "getRowClassName",
  "getCellClassName",
  "children",
] as const satisfies readonly (keyof DataGridRootProps)[];

/**
 * The scroll container: a plain `overflow:auto` div (real scroll element, native scrollbar) with
 * an in-flow Content div that provides the full virtual scroll extent, and inside it a
 * `position:sticky` Viewport that is pinned to the scrollport (controlled-virtualizer pattern).
 * Native scroll only moves the Content div under the sticky Viewport; 100% of visible row/header motion is the JS-written transform on the two
 * layers inside — the compositor can never reveal unrendered rows because rows never move via
 * native scroll.
 */
function suppressNativeTouchContextMenu(event: ReactMouseEvent<HTMLElement>) {
  // a portaled popup (comments, find and replace) bubbles through React; its fields keep the native menu
  if ((event.nativeEvent as PointerEvent).pointerType !== "touch" || !event.currentTarget.contains(event.target as Node)) return;
  event.preventDefault();
  event.stopPropagation();
}

export function DataGridRoot<TData = unknown>(props: DataGridRootProps<TData>): ReactNode {
  const {
    className,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    rowHeight: rowHeightProp,
    markerWidth: markerWidthProp,
    density,
    headerHeight: headerHeightProp,
    columnOverscan,
    direction: directionProp,
    emptyState,
    loading = false,
    loadingState,
    error,
    onRetry,
    errorState,
    renderHeaderMenu,
    renderHeaderFilter,
    renderMarker,
    renderMarkerHeader,
    renderGroupLabel,
    getRowClassName,
    getCellClassName,
    children,
  } = props;
  const rowHeight = resolveRowHeight(density, rowHeightProp);
  const headerRowHeight = resolveHeaderHeight(density, headerHeightProp);
  const instanceId = useDataGridInstanceId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // The roving-tabindex bootstrap (root onFocus below) fires only for a keyboard Tab in: a captured pointerdown marks the next focus as pointer-originated,
  // so a header or marker click does not reset the row or column selection to (0,0).
  const pointerInteractionRef = useRef(false);
  // `ltr` until the parent is measured. The root sets its own `dir`, so the inherited direction is read from the parent.
  const [domDirection, setDomDirection] = useState<GridDirection>("ltr");
  useLayoutEffect(() => {
    if (directionProp !== undefined) return;
    const read = () => setDomDirection(readResolvedDirection(scrollRef.current?.parentElement ?? null));
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"], subtree: true });
    return () => observer.disconnect();
  }, [directionProp]);
  const direction = directionProp ?? domDirection;
  const visibleColumns = useDataGridVisibleColumns();
  const columnGroupModel = useDataGridColumnGroupModel();
  const headerRows = useMemo(() => computeHeaderRows(visibleColumns, columnGroupModel), [visibleColumns, columnGroupModel]);
  const headerRowCount = headerRows.length + 1;
  const headerHeight = headerRowHeight * headerRowCount;
  const rowCount = useDataGridRowCount();
  const dataLength = useDataGridStore((s) => s.data.length);
  const gatesPending = useDataGridStore((s) => (s.gatesPending.size === 0 ? "" : Array.from(s.gatesPending).join(" ")));
  const grouped = useDataGridStore((s) => s.groupLayout !== null);
  const serverFiltered = useDataGridStore((s) => s.filterMode === "server" && (s.filterState.length > 0 || s.searchText !== ""));
  const hasError = error !== undefined && error !== null;
  // labels.grid.emptyState is the translatable default; the emptyState prop (node or function) still wins when provided.
  const gridLabels = useDataGridLabels().grid;
  const emptyReason: EmptyStateReason = dataLength === 0 && !serverFiltered ? "no-data" : "filtered";
  const emptyStateLabel = emptyReason === "filtered" ? gridLabels.noResults : gridLabels.emptyState;
  useLoadAnnouncement(loading, error);
  // The resolved row-band segments (every plugin's `rowBands`, in plugin array order); an empty
  // shared identity when no plugin contributes bands.
  const bands = useDataGridPluginBands();
  const topBandRowCount = bands.top.reduce((n, seg) => n + seg.rows.length, 0);
  const bottomBandRowCount = bands.bottom.reduce((n, seg) => n + seg.rows.length, 0);
  const mounts = useDataGridPluginMounts();
  // A band's segments stack in plugin array order; a segment's ARIA row offset is the rows the earlier segments take.
  // No render-scope accumulator: the compiler bails on a `let` reassigned inside the map callback.
  const topSegments = bands.top.map((segment, index) => ({
    segment,
    offset: bands.top.slice(0, index).reduce((n, seg) => n + seg.rows.length, 0),
  }));
  const bottomSegments = bands.bottom.map((segment, index) => ({
    segment,
    offset: bands.bottom.slice(0, index).reduce((n, seg) => n + seg.rows.length, 0),
  }));
  const pinnedTopHeight = topBandRowCount * rowHeight;
  const pinnedBottomHeight = bottomBandRowCount * rowHeight;
  // Where data row 0 starts: the header track plus the pinned-top band.
  const effectiveHeaderHeight = headerHeight + pinnedTopHeight;
  // a boolean, not the full activeCell: a ViewCoord subscription would re-render the root on every cell move
  const hasActiveCell = useDataGridHasActiveCell();
  const storeApi = useDataGridStoreApi();
  // WAI-ARIA grid pattern: aria-multiselectable reflects whether more than one cell can be
  // selected at once — true whenever any multi-cell channel (range/row/column/multi-range) is on.
  const { enableRangeSelection, enableRowSelection, enableColumnSelection, enableMultiRange } = useDataGridSelectionConfig();
  const ariaMultiselectable = enableRangeSelection || enableRowSelection || enableColumnSelection || enableMultiRange;
  // Dimensions-only (resize-rate), not the full scroll snapshot — subscribing to every scroll tick
  // here would re-render this whole tree on every scroll pixel, negating row memoization (mustFix).
  // Read before useColumnLayout: clientWidth drives flex-column distribution below.
  const dimensions = useElementDimensions(scrollRef);
  const layout = useColumnLayout(visibleColumns, dimensions.clientWidth, markerWidthProp);
  const { template, leftOffsets, rightOffsets, trackLefts: lefts, trackRights: rights, widths, pins, totalWidth } =
    layout;

  const keymap = useDataGridKeymap();
  const readOnly = useDataGridReadOnly();
  const interactionLayout: InteractionLayout = useMemo(() => {
    // the marker column (when present) is always pinned-left before every data column, so it's
    // part of the static-pinned-left band for pointer hit-testing (pointerToCoord's columnAtX).
    let pinnedLeftWidth = layout.markerWidth;
    let pinnedRightWidth = 0;
    for (let i = 0; i < widths.length; i++) {
      // i < widths.length by loop condition, pins is same-length parallel array
      if (pins[i] === "start") pinnedLeftWidth += widths[i]!;
      if (pins[i] === "end") pinnedRightWidth += widths[i]!;
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
  const interaction = useGridInteraction({
    scrollRef,
    layout: interactionLayout,
    keymap,
  });
  useGridClipboard({ rootRef: scrollRef });

  // Registers this mount's scroll-into-view on the store so add-ons outside this subtree (e.g.
  // data-grid-toolbar's search, a DataGridRoot sibling) can reach it; cleared on unmount.
  const warnSecondRoot = useSecondRootWarning();
  const actions = useDataGridActions();
  const internalActions = useDataGridInternalActions();
  useEffect(() => {
    warnSecondRoot(storeApi.getState().scrollToCellImpl !== null);
    internalActions._registerScrollToCell(interaction.scrollCellIntoView);
    scrollRef.current?.setAttribute(GRID_ATTR.settled, "");
    return () => internalActions._registerScrollToCell(null);
  }, [internalActions, interaction.scrollCellIntoView]);

  useUnnamedGridWarning(ariaLabel, ariaLabelledBy);

  useEffect(() => {
    internalActions._registerFocus(() => {
      const root = scrollRef.current;
      if (!root) return;
      const active = Array.from(root.querySelectorAll<HTMLElement>(gridAttrSelector("active"))).find((el) => closestGridRoot(el) === root);
      (active ?? root).focus({ preventScroll: true });
    });
    return () => internalActions._registerFocus(null);
  }, [internalActions]);

  useEffect(() => {
    internalActions._registerRunShortcut((action, event) => {
      const state = storeApi.getState();
      const scope = state.commands?.[action]?.scope;
      if (state.editing ? scope !== "editing" && scope !== "always" : scope === "editing") return;
      dispatchGridAction({
        action,
        actions,
        storeApi,
        scrollRef,
        scrollCellIntoView: interaction.scrollCellIntoView,
        rowHeight,
        triggerKey: event?.triggerKey,
        preventDefault: event?.preventDefault ?? (() => {}),
      });
    });
    return () => internalActions._registerRunShortcut(null);
  }, [internalActions, actions, storeApi, interaction.scrollCellIntoView, rowHeight]);

  // Registers the autosize measure context (fonts, mounted row window, header-menu flag) so
  // store actions can size columns with canvas `measureText` without their own DOM query;
  // cleared on unmount.
  useEffect(() => {
    internalActions._registerMeasureFonts(() => {
      const root = scrollRef.current;
      if (!root) return null;
      const canvas = root.querySelector<HTMLElement>("[data-grid-rows-canvas]");
      const cell = root.querySelector<HTMLElement>('[role="gridcell"][data-column-id]');
      const header = root.querySelector<HTMLElement>('[role="columnheader"]');
      // Body cells inherit the root's font; with no row mounted yet the root stands in.
      const cellStyle = getComputedStyle(cell ?? root);
      return {
        cellFont: cellStyle.font,
        cellPadding: cell ? parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight) : undefined,
        headerFont: header ? getComputedStyle(header).font : "",
        window: canvas
          ? {
              start: Number(canvas.dataset["gridWindowStart"] ?? 0),
              end: Number(canvas.dataset["gridWindowEnd"] ?? 0),
            }
          : null,
        hasHeaderMenu: Boolean(renderHeaderMenu),
        hasHeaderFilter: Boolean(renderHeaderFilter),
      };
    });
    return () => internalActions._registerMeasureFonts(null);
  }, [internalActions, renderHeaderMenu, renderHeaderFilter]);

  useViewportElement(scrollRef, viewportRef);
  // Imperative data-scrolled-start/end writer (for the pinned-edge shadows) — no React re-render per tick.
  useScrolledEdges(scrollRef, viewportRef);
  useRowHover(scrollRef, rowHeight);
  // Measures the pin-shadow's real anchor from the boundary header cell's own rendered edge,
  // instead of a JS-summed width total that can drift a subpixel from CSS Grid's own track
  // rounding (see the hook's doc comment) — no React re-render, imperative CSS var write.
  // layout signature, not just pins: adding a marker column MOVES the pinned header sideways
  // without resizing it or the viewport, so the ResizeObserver never fires for it.
  usePinShadowEdges(viewportRef, hasPinnedLeft, hasPinnedRight, direction, `${pins.join(",")}|${layout.markerWidth}|${widths.join(",")}`);

  const { indices: columnWindowIndices } = useColumnWindow(scrollRef, {
    widths,
    pins,
    markerWidth: layout.markerWidth,
    contentWidth: totalWidth,
    overscan: columnOverscan,
  });
  // The active column only when it sits outside the rendered window: moves inside the window never re-render the root.
  const offWindowActiveColumn = useDataGridStore((s) => {
    const col = s.activeCell?.col;
    return col === undefined || columnWindowIndices.includes(col) ? null : col;
  });
  const columnIndices = useMemo(() => {
    // the active cell's column always renders, even off-window, so focus survives scroll
    if (offWindowActiveColumn !== null && offWindowActiveColumn < visibleColumns.length) {
      return [...columnWindowIndices, offWindowActiveColumn].sort((a, b) => a - b);
    }
    return columnWindowIndices;
  }, [columnWindowIndices, offWindowActiveColumn, visibleColumns.length]);

  // Full scroll extent includes both pinned bands: the top band sits above row 0 (part of
  // effectiveHeaderHeight already), the bottom band needs its own extra room reserved past the
  // last data row so the native scrollbar's range still covers exactly the data rows plus both bands.
  const contentHeight = effectiveHeaderHeight + rowCount * rowHeight + pinnedBottomHeight;

  // loading+empty: enough skeleton rows to fill the viewport below the header, plus
  // one so a partial row is visible at the bottom edge like the real virtualized body would show.
  const showLoadingSkeleton = loading && rowCount === 0 && !hasError;
  const skeletonRowCount = showLoadingSkeleton
    ? Math.max(1, Math.ceil((dimensions.clientHeight - effectiveHeaderHeight) / rowHeight) + 1)
    : 0;
  const showLoadingBar = loading && rowCount > 0;

  const [unbounded, setUnbounded] = useState(false);
  if (!unbounded && dimensions.clientHeight / rowHeight > MAX_RENDERED_ROWS) setUnbounded(true);

  const rootStyle: CSSProperties = {
    ...(unbounded && { maxHeight: "var(--data-grid-fallback-height, 100dvh)" }),
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
    // The clipped track spans this box, so it must cover the viewport of a short or narrow grid.
    minWidth: dimensions.clientWidth,
    minHeight: dimensions.clientHeight,
  };

  // Clipped so a track top below shrunken content never extends the scroll range.
  const stickyTrackStyle: CSSProperties = { position: "absolute", inset: 0, overflow: "clip" };

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
    // Sign of the horizontal scroll transform: grid tracks and inset-inline-* mirror under dir=rtl but `transform` stays physical,
    // so the transforms multiply the scroll offset by this and the per-tick scroll write is identical in both directions.
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

  // Virtualized columns, in display order, with their real index preserved for grid placement.
  // columnIndices are indices into visibleColumns by useColumnWindow's contract.
  const renderedColumns = useMemo(
    () => columnIndices.map((index) => ({ column: visibleColumns[index]!, index })),
    [columnIndices, visibleColumns],
  );

  const renderedRowsRef = useRef<RenderedRows | null>(null);
  const [stableRenderMarker, stableRenderMarkerHeader, stableRenderGroupLabel] = [useLatestRenderer(renderMarker), useLatestRenderer(renderMarkerHeader), useLatestRenderer(renderGroupLabel)];
  const classNames = useClassNameRevision({ getRowClassName: getRowClassName as GetRowClassName<unknown> | undefined, getCellClassName: getCellClassName as GetCellClassName<unknown> | undefined }, renderedRowsRef);
  // Stable context value on real deps (mustFix): DataGridRoot re-renders when the active
  // cell leaves the rendered column window, and cell.tsx/header.tsx read this context directly —
  // a fresh object literal here would bust every context consumer (all virtualized cells, header
  // cells) on every click/arrow-key move even though most of these fields didn't actually change.
  const contextValue = useMemo(
    () => ({
      scrollRef,
      viewportRef,
      columns: visibleColumns,
      renderedColumns,
      layout,
      rowHeight,
      headerHeight,
      headerRowHeight,
      headerRowCount,
      headerRows,
      columnGroupModel,
      pinnedTopHeight,
      pinnedBottomHeight,
      pinnedTopCount: topBandRowCount,
      template,
      interaction,
      direction,
      renderHeaderMenu,
      renderHeaderFilter,
      renderMarker: stableRenderMarker,
      renderMarkerHeader: stableRenderMarkerHeader,
      renderGroupLabel: stableRenderGroupLabel,
      // Erasure boundary: DataGridRootContextValue is one shared non-generic context for every
      // DataGridRoot<TData>, so a typed caller's callbacks widen to <unknown> here — safe because
      // every row they ever receive at runtime came from this same subtree's DataGridProvider.
      getRowClassName: classNames.getRowClassName,
      getCellClassName: classNames.getCellClassName,
      classNameRevision: classNames.revision,
      renderedRowsRef,
    }),
    [
      scrollRef,
      viewportRef,
      visibleColumns,
      renderedColumns,
      layout,
      rowHeight,
      headerHeight,
      headerRowHeight,
      headerRowCount,
      headerRows,
      columnGroupModel,
      pinnedTopHeight,
      pinnedBottomHeight,
      topBandRowCount,
      template,
      interaction,
      direction,
      renderHeaderMenu,
      renderHeaderFilter,
      stableRenderMarker, stableRenderMarkerHeader, stableRenderGroupLabel,
      classNames,
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
        role={grouped ? "treegrid" : "grid"}
        aria-label={ariaLabel ?? (ariaLabelledBy ? undefined : gridLabels.gridName)}
        aria-labelledby={ariaLabelledBy}
        dir={direction}
        {...{ [GRID_ATTR.instance]: instanceId }}
        // Roving-tabindex bootstrap (WAI-ARIA APG grid pattern): before any cell has been made
        // active, every cell renders tabIndex=-1, so the root itself must be the one tabbable
        // entry point or a keyboard user can never reach the grid at all. Once a cell becomes
        // active it takes over as the sole tab stop (see cell.tsx), and the root reverts to -1.
        tabIndex={!hasActiveCell && rowCount > 0 ? 0 : -1}
        aria-rowcount={rowCount + headerRowCount + topBandRowCount + bottomBandRowCount}
        aria-colcount={visibleColumns.length}
        aria-multiselectable={ariaMultiselectable || undefined}
        aria-readonly={readOnly || undefined}
        aria-busy={loading || undefined}
        {...{ [GRID_ATTR.gatePending]: gatesPending || undefined }}
        {...{ [GRID_ATTR.unbounded]: unbounded ? "" : undefined }}
        className={cn("relative touch-manipulation select-none overflow-auto rounded-md border border-border bg-background text-sm", className)}
        style={rootStyle}
        onKeyDown={interaction.onKeyDown}
        onPointerDown={interaction.onRootPointerDown}
        onContextMenuCapture={suppressNativeTouchContextMenu}
        onPointerDownCapture={(event) => {
          interaction.onRootPointerDownCapture(event);
          pointerInteractionRef.current = true;
        }}
        onFocus={(event) => {
          // only a focus landing directly on the root, NOT following a pointer gesture (Tab from
          // outside, the only case tabIndex=0 is reachable in) seeds the first cell — a header/
          // marker click's own row/column-channel selection must not be clobbered back to (0,0),
          // and focus bubbling up from a cell that already made itself active must not re-seed either.
          // The store, not the render, holds the cursor: an api call may set it in the same tick.
          if (event.target === event.currentTarget && !pointerInteractionRef.current && storeApi.getState().activeCell === null && rowCount > 0) {
            actions.selectCellAt({ col: 0, row: 0 });
          }
          pointerInteractionRef.current = false;
        }}
      >
        {/* in-flow, sized to the full virtual extent — provides native scroll range; zero visible children besides the viewport */}
        <div style={contentStyle}>
          <div data-grid-sticky-track="" style={stickyTrackStyle}>
            <div ref={viewportRef} style={viewportStyle}>
              {children}
              {mounts.map(({ name, Mount }) => (
                <Mount key={name} />
              ))}
              {topSegments.map(({ segment, offset }) => (
                <Fragment key={segment.name}>
                  {segment.render({
                    position: "top",
                    rows: segment.rows,
                    rowOffset: offset,
                    renderedColumns,
                    layout,
                    rowHeight,
                    template,
                    headerHeight,
                    ariaRowIndexBase: 1 + headerRowCount + offset,
                  })}
                </Fragment>
              ))}
              {bottomSegments.map(({ segment, offset }) => (
                <Fragment key={segment.name}>
                  {segment.render({
                    position: "bottom",
                    rows: segment.rows,
                    rowOffset: offset,
                    renderedColumns,
                    layout,
                    rowHeight,
                    template,
                    headerHeight,
                    ariaRowIndexBase: 1 + headerRowCount + topBandRowCount + rowCount + offset,
                  })}
                </Fragment>
              ))}
              {/* the empty state never shows while loading — a zero-row loading grid renders the skeleton below instead */}
              {rowCount === 0 && !loading && !hasError && (
                <div
                  data-grid-empty-state=""
                  className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"
                  style={{ insetBlockStart: effectiveHeaderHeight }}
                >
                  {(typeof emptyState === "function"
                    ? emptyState({ reason: emptyReason })
                    : emptyState) ?? emptyStateLabel}
                </div>
              )}
              {hasError && (
                <ErrorBar
                  focusGrid={() => storeApi.getState().focusImpl?.()}
                  className={cn(
                    "absolute flex items-center justify-center gap-2 text-sm",
                    rowCount === 0 ? "inset-x-0 bottom-0 text-muted-foreground" : "inset-x-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-destructive",
                  )}
                  style={{ insetBlockStart: effectiveHeaderHeight, zIndex: GRID_LAYER.overlay }}
                >
                  {errorState === undefined ? (
                    <>
                      <span>{gridLabels.errorState}</span>
                      {onRetry && (
                        <Button type="button" variant="secondary" size="xs" className="border border-border" onClick={onRetry}>
                          {gridLabels.errorRetry}
                        </Button>
                      )}
                    </>
                  ) : typeof errorState === "function" ? (
                    errorState({ error, retry: onRetry })
                  ) : (
                    errorState
                  )}
                </ErrorBar>
              )}
              {showLoadingSkeleton &&
                (loadingState !== undefined ? (
                  <div
                    data-grid-loading-state=""
                    className="absolute"
                    style={{ insetInlineStart: 0, insetBlockStart: effectiveHeaderHeight, width: "100%" }}
                  >
                    {typeof loadingState === "function" ? loadingState({ reason: "no-data" }) : loadingState}
                  </div>
                ) : (
                  <DataGridLoadingSkeleton
                    rowCount={skeletonRowCount}
                    columnCount={visibleColumns.length}
                    rowHeight={rowHeight}
                    headerHeight={effectiveHeaderHeight}
                  />
                ))}
              {showLoadingBar &&
                (loadingState !== undefined ? (
                  <div
                    data-grid-loading-state=""
                    className="absolute"
                    style={{ insetInlineStart: 0, insetBlockStart: effectiveHeaderHeight, width: "100%" }}
                  >
                    {typeof loadingState === "function" ? loadingState({ reason: "rows-present" }) : loadingState}
                  </div>
                ) : (
                  <DataGridLoadingBar headerHeight={effectiveHeaderHeight} />
                ))}
              <div
                data-grid-pin-shadow="start"
                data-pinned={hasPinnedLeft ? "" : undefined}
                aria-hidden="true"
                className="pointer-events-none absolute opacity-0 transition-opacity in-data-scrolled-start:opacity-100 from-(--grid-shadow-color) to-transparent bg-linear-to-r/srgb rtl:bg-linear-to-l/srgb"
                style={{
                  insetInlineStart: `var(--grid-pin-shadow-start-x, ${interactionLayout.pinnedLeftWidth}px)`,
                  insetBlockStart: effectiveHeaderHeight,
                  insetBlockEnd: pinnedBottomHeight,
                  width: SHADOW_SIZE,
                  // background gradient, not box-shadow: a box-shadow's offset+blur paints its darkest
                  // pixels well outside this element's own box, floating the visible shadow off the
                  // pinned cell's edge — a gradient anchored at inset-inline-start:0 (the edge itself)
                  // guarantees the darkest pixel sits exactly on the boundary this element is measured to.
                  // The gradient is a utility class (not inline) so a plain rule can restyle it.
                  ...shadowVar(shadowColor(hasPinnedLeft)),
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
              <div
                data-grid-pin-shadow="end"
                data-pinned={hasPinnedRight ? "" : undefined}
                aria-hidden="true"
                className="pointer-events-none absolute opacity-0 transition-opacity in-data-scrolled-end:opacity-100 from-(--grid-shadow-color) to-transparent bg-linear-to-l/srgb rtl:bg-linear-to-r/srgb"
                style={{
                  insetInlineEnd: `var(--grid-pin-shadow-end-x, ${interactionLayout.pinnedRightWidth}px)`,
                  insetBlockStart: effectiveHeaderHeight,
                  insetBlockEnd: pinnedBottomHeight,
                  width: SHADOW_SIZE,
                  ...shadowVar(shadowColor(hasPinnedRight)),
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
              <div
                data-grid-pin-shadow="top"
                data-pinned={topBandRowCount > 0 ? "" : undefined}
                aria-hidden="true"
                className="pointer-events-none absolute opacity-0 transition-opacity in-data-scrolled-top:opacity-100 from-(--grid-shadow-color) to-transparent bg-linear-to-b/srgb"
                style={{
                  insetBlockStart: effectiveHeaderHeight,
                  insetInlineStart: `var(--grid-pin-shadow-start-x, ${interactionLayout.pinnedLeftWidth}px)`,
                  insetInlineEnd: `var(--grid-pin-shadow-end-x, ${interactionLayout.pinnedRightWidth}px)`,
                  height: SHADOW_SIZE,
                  ...shadowVar(shadowColor(topBandRowCount > 0)),
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
              <div
                data-grid-pin-shadow="bottom"
                data-pinned={bottomBandRowCount > 0 ? "" : undefined}
                aria-hidden="true"
                className="pointer-events-none absolute opacity-0 transition-opacity in-data-scrolled-bottom:opacity-100 from-(--grid-shadow-color) to-transparent bg-linear-to-t/srgb"
                style={{
                  insetBlockEnd: pinnedBottomHeight,
                  insetInlineStart: `var(--grid-pin-shadow-start-x, ${interactionLayout.pinnedLeftWidth}px)`,
                  insetInlineEnd: `var(--grid-pin-shadow-end-x, ${interactionLayout.pinnedRightWidth}px)`,
                  height: SHADOW_SIZE,
                  ...shadowVar(shadowColor(bottomBandRowCount > 0)),
                  zIndex: GRID_LAYER.pinShadow,
                }}
              />
            </div>
          </div>
        </div>
      </div>
      {loading && loadingState === undefined && <DataGridLoadingProgress ariaLabel={gridLabels.loading} />}
    </DataGridRootContext>
    </DirectionProvider>
  );
}

/** The error bar unmounts with a focused control inside it; focus moves to the grid unless the user moved it elsewhere. */
function ErrorBar({ focusGrid, className, style, children }: { focusGrid: () => void; className: string; style: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(focusGrid);
  useLayoutEffect(() => {
    latest.current = focusGrid;
  });
  useLayoutEffect(
    () => () => {
      if (ref.current !== null && ref.current.contains(document.activeElement)) latest.current();
    },
    [],
  );
  return (
    <div ref={ref} data-grid-error-state="" role="alert" className={className} style={style}>
      {children}
    </div>
  );
}
