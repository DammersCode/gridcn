"use client";

import type { CSSProperties, ReactNode } from "react";
import { GRID_LAYER } from "../layers";

/** Props for {@link DataGridLoadingSkeleton}. */
export type DataGridLoadingSkeletonProps = {
  /** Enough skeleton rows to fill the viewport at the current row height. */
  rowCount: number;
  /** How many skeleton bars per row — one per visible column (marker column excluded, it has no value to shape). */
  columnCount: number;
  rowHeight: number;
  headerHeight: number;
  ariaLabel: string;
};

/**
 * Grid-wide loading state, empty-data case (`loading && rowCount === 0`). Reuses the
 * `data-grid-lazy` add-on's skeleton-cell visual language (muted `animate-pulse` bar per cell) but
 * lives in core as one small component — core cannot import from an add-on, and this needs no real
 * column layout (there's no data yet), just enough rows/bars to fill the viewport.
 */
export function DataGridLoadingSkeleton(props: DataGridLoadingSkeletonProps): ReactNode {
  const { rowCount, columnCount, rowHeight, headerHeight, ariaLabel } = props;
  const rows = Array.from({ length: rowCount }, (_, i) => i);
  const cols = Array.from({ length: columnCount }, (_, i) => i);
  const style: CSSProperties = {
    position: "absolute",
    insetInlineStart: 0,
    insetBlockStart: headerHeight,
    width: "100%",
  };
  return (
    <div
      role="presentation"
      aria-label={ariaLabel}
      data-grid-loading-skeleton=""
      className="pointer-events-none absolute"
      style={style}
    >
      {rows.map((r) => (
        <div key={r} className="flex items-center gap-2 border-b border-border px-2" style={{ height: rowHeight }}>
          {cols.map((c) => (
            <div key={c} className="h-4 flex-1 motion-safe:animate-pulse rounded bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Props for {@link DataGridLoadingBar}. */
export type DataGridLoadingBarProps = {
  headerHeight: number;
  ariaLabel: string;
};

/** Scoped keyframes (not a `@theme` global.css addition) so this file stays self-contained as a registry item — no consumer build-config step beyond installing the component. */
const SWEEP_KEYFRAMES = "@keyframes grid-loading-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}";

/**
 * Grid-wide loading state, data-present case (`loading && rowCount > 0` — a background
 * refresh keeps rows visible). A slim indeterminate bar pinned directly under the header; the
 * indeterminate sweep is a `prefers-reduced-motion`-gated CSS animation (`motion-safe:` variant) —
 * `motion-reduce` falls back to a static full-width bar, no JS/rAF involved either way.
 */
export function DataGridLoadingBar(props: DataGridLoadingBarProps): ReactNode {
  const { headerHeight, ariaLabel } = props;
  const style: CSSProperties = {
    position: "absolute",
    insetInlineStart: 0,
    insetBlockStart: headerHeight,
    zIndex: GRID_LAYER.skeleton,
  };
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuetext={ariaLabel}
      data-grid-loading-bar=""
      className="pointer-events-none absolute h-0.5 w-full overflow-hidden bg-primary/20"
      style={style}
    >
      {/* plain <style> tag (not styled-jsx) scopes the sweep keyframes here without a global.css edit */}
      <style>{SWEEP_KEYFRAMES}</style>
      <div className="h-full w-1/3 bg-primary motion-safe:animate-[grid-loading-sweep_var(--grid-loading-sweep-duration,1.2s)_ease-in-out_infinite] motion-reduce:w-full" />
    </div>
  );
}
