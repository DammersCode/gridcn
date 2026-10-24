"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LABELS,
  useDataGridCellTypes,
  useDataGridHiddenCheckedCount,
  useDataGridLabels,
  useDataGridVisibleColumns,
  type DataGridStatusBarLabels,
} from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_STATUS_CELLS } from "./compute-selection-stats";
import { useDataGridSelectionStats } from "./use-data-grid-selection-stats";

/** One of the aggregates the bar can show. */
export type StatusBarAggregate = "count" | "sum" | "avg" | "min" | "max";

/** Props for {@link DataGridStatusBar}. */
export type DataGridStatusBarProps = {
  /** Which aggregates to show, and in which order. Default: all five, `count`, `sum`, `avg`, `min`, `max`. */
  aggregates?: readonly StatusBarAggregate[];
  /**
   * Formats the shown aggregate values. When omitted, the single-column rule applies: if every
   * numeric cell comes from one column, its `toDisplayText` formats sum/avg/min/max (a `number`
   * column's `options.format` shows currency); otherwise `Intl.NumberFormat(locale, { maximumFractionDigits: 4 })`.
   */
  formatValue?: (value: number, aggregate: StatusBarAggregate) => string;
  /** Locale for the default number format. Default `"en-US"` (the date type's SSR-safe default). */
  locale?: string;
  /** i18n overrides for this bar's strings, merged over `labels.statusBar`. */
  labels?: Partial<DataGridStatusBarLabels>;
  className?: string;
  /** Extra items, rendered after the aggregates. */
  children?: ReactNode;
};

const DEFAULT_AGGREGATES: readonly StatusBarAggregate[] = ["count", "sum", "avg", "min", "max"];

/**
 * Aggregate bar for the selected cells: count of non-empty cells plus sum/avg/min/max of numeric
 * cells, computed by {@link useDataGridSelectionStats}. Place it inside `DataGridProvider`, next
 * to `DataGridRoot`, like the pagination bar. Shows the number of hidden checked rows when `keepHiddenCheckedRows` remembers any. Renders nothing while fewer than 2 cells are
 * selected and no hidden checked row exists.
 */
export function DataGridStatusBar({
  aggregates = DEFAULT_AGGREGATES,
  formatValue,
  locale = "en-US",
  labels,
  className,
  children,
}: DataGridStatusBarProps) {
  const stats = useDataGridSelectionStats();
  const hiddenChecked = useDataGridHiddenCheckedCount();
  const storeLabels = useDataGridLabels();
  const mergedLabels = { ...DEFAULT_LABELS.statusBar, ...storeLabels.statusBar, ...labels };
  const visibleColumns = useDataGridVisibleColumns();
  const cellTypes = useDataGridCellTypes();
  const fallbackFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }), [locale]);

  const displayText = useMemo(() => {
    if (stats.numericColumnId === null) return null;
    const column = visibleColumns.find((c) => c.id === stats.numericColumnId);
    const cellType = column ? (cellTypes[column.type ?? "text"] ?? cellTypes["text"]) : undefined;
    const toDisplayText = cellType?.toDisplayText;
    if (!column || !toDisplayText) return null;
    return (value: number) => toDisplayText(value, column.options);
  }, [stats.numericColumnId, visibleColumns, cellTypes]);

  const showStats = stats.cells >= 2;
  if (!showStats && hiddenChecked === 0) return null;

  const format = (value: number, aggregate: StatusBarAggregate) =>
    formatValue ? formatValue(value, aggregate) : aggregate !== "count" && displayText ? displayText(value) : fallbackFormat.format(value);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={stats.approximate ? mergedLabels.approximate(MAX_STATUS_CELLS) : undefined}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-background px-2 py-1.5 text-xs text-muted-foreground", className)}
    >
      {(showStats ? aggregates : []).map((aggregate) => {
        const value = aggregate === "count" ? stats.count : stats[aggregate];
        if (value === null) return null;
        return (
          <span key={aggregate}>
            <span className="text-muted-foreground">{mergedLabels[aggregate]}</span>{" "}
            <span className="tabular-nums text-foreground">
              {stats.approximate ? "≈" : ""}
              {format(value, aggregate)}
            </span>
          </span>
        );
      })}
      {hiddenChecked > 0 && <span>{showStats ? mergedLabels.hiddenChecked(hiddenChecked) : mergedLabels.hiddenCheckedOnly(hiddenChecked)}</span>}
      {children}
    </div>
  );
}
