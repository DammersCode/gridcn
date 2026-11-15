"use client";

import { Children, useMemo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LABELS,
  useDataGridActions,
  useDataGridCellTypes,
  useDataGridHiddenCheckedCount,
  useDataGridLabels,
  useDataGridSelectedRows,
  useDataGridVisibleColumns,
  numberCellType,
  type DataGridStatusBarLabels,
} from "@/registry/default/blocks/data-grid/data-grid";
import { mergeLabelLayers, useDataGridSelector } from "@/registry/default/blocks/data-grid/data-grid-sdk";
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
   * column needs `options.format`, such as currency or percent, or `options.decimals`, which rounds with `Intl.NumberFormat(locale, { maximumFractionDigits: decimals })`); otherwise `Intl.NumberFormat(locale, { maximumFractionDigits: 4 })`.
   */
  formatValue?: (value: number, aggregate: StatusBarAggregate) => string;
  /** i18n overrides for this bar's strings, merged over `labels.statusBar`. */
  labels?: Partial<DataGridStatusBarLabels>;
  className?: string;
  /** Extra items, rendered after the aggregates. The bar renders while it has children, even with nothing selected. */
  children?: ReactNode;
};

const DEFAULT_AGGREGATES: readonly StatusBarAggregate[] = ["count", "sum", "avg", "min", "max"];

/**
 * Aggregate bar for the selected cells: count of non-empty cells plus sum/avg/min/max of numeric
 * cells, computed by {@link useDataGridSelectionStats}. Place it inside `DataGridProvider`, next
 * to `DataGridRoot`, like the pagination bar. Shows the number of hidden checked rows when `checkedRowsLifetime="across-filters"` remembers any, and the
 * select-all banner: with `totalRowCount` and `checkedRowsLifetime="across-filters"`, "Select all matching" while every
 * row of a partial view is checked, "Clear selection" after `selectAllMatching`. Renders nothing while fewer than 2 selected cells have a value other than `undefined`, no
 * hidden checked row exists, and no banner shows.
 */
export function DataGridStatusBar({
  aggregates = DEFAULT_AGGREGATES,
  formatValue,
  labels,
  className,
  children,
}: DataGridStatusBarProps) {
  const locale = useDataGridSelector((s) => s.locale);
  const stats = useDataGridSelectionStats();
  const hiddenChecked = useDataGridHiddenCheckedCount();
  const storeLabels = useDataGridLabels();
  const mergedLabels = mergeLabelLayers<DataGridStatusBarLabels>(DEFAULT_LABELS.statusBar, storeLabels.statusBar, labels);
  const visibleColumns = useDataGridVisibleColumns();
  const cellTypes = useDataGridCellTypes();
  const fallbackFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }), [locale]);

  const displayText = useMemo(() => {
    if (stats.numericColumnId === null) return null;
    const column = visibleColumns.find((c) => c.id === stats.numericColumnId);
    const cellType = column ? (cellTypes[column.type ?? "text"] ?? cellTypes["text"]) : undefined;
    const toDisplayText = cellType?.toDisplayText;
    if (!column || !toDisplayText) return null;
    const options = column.options as { format?: unknown; decimals?: unknown } | undefined;
    if (toDisplayText === numberCellType.toDisplayText && !options?.format) {
      const decimals = options?.decimals;
      if (decimals === undefined) return null;
      if (typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 20) {
        const rounded = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals });
        return (value: number) => rounded.format(value);
      }
    }
    return (value: number) => toDisplayText(value, column.options);
  }, [stats.numericColumnId, visibleColumns, cellTypes, locale]);

  const showStats = stats.cells >= 2;
  const total = useDataGridSelector((s) => s.totalRowCount);
  const canSelectAllMatching = useDataGridSelector((s) => s.checkedRowsLifetime === "across-filters");
  const allMatching = useDataGridSelector((s) => s.allMatching);
  const pageRows = useDataGridSelector((s) => s.viewIndex.length);
  const pageChecked = useDataGridSelector((s) => s.viewIndex.length > 0 && s.selection.rows.hasAll([0, s.viewIndex.length]));
  const actions = useDataGridActions();
  const escalate = canSelectAllMatching && !allMatching && pageChecked && total !== undefined && (total === null || total > pageRows);
  if (!showStats && hiddenChecked === 0 && !allMatching && !escalate && Children.toArray(children).length === 0) return null;

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
      {escalate && (
        <span data-grid-select-all-banner="" className="flex items-center gap-1">
          <span>{mergedLabels.pageSelected(pageRows)}</span>
          <Button type="button" variant="link" size="xs" onClick={() => actions.selectAllMatching()}>
            {mergedLabels.selectAllMatching(total ?? null)}
          </Button>
        </span>
      )}
      {allMatching && (
        <span data-grid-select-all-banner="" className="flex items-center gap-1">
          <AllSelectedText allSelected={mergedLabels.allSelected} />
          <Button type="button" variant="link" size="xs" onClick={() => actions.clearSelection()}>
            {mergedLabels.clearSelection}
          </Button>
        </span>
      )}
      {children}
    </div>
  );
}

/** The count after "select all matching"; it reads the selection value, so it mounts only while that mode is on. */
function AllSelectedText({ allSelected }: { allSelected: (count: number | null) => string }): ReactNode {
  const selected = useDataGridSelectedRows();
  return <span>{allSelected(selected.count)}</span>;
}
