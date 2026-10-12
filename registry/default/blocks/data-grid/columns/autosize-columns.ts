import type { AnyColumnDef } from "../store";
import type { AutosizeOptions, CellType, SortSpec } from "../types";
import { isDev } from "../is-dev";
import { displayText } from "../cell-types/display-text";
import { getCellValue } from "./column-helpers";
import { CELL_PADDING, measureTextWidths } from "./measure-column-text";
import { clampColumnWidth } from "./resolve-column-width";

/** Default view rows sampled by one autosize pass. */
export const DEFAULT_AUTOSIZE_SAMPLE_ROWS = 1_000;
/** Hard cap on `AutosizeOptions.sampleRows` (hostile-dataset bound, with the 1,000-char cut). */
export const MAX_AUTOSIZE_SAMPLE_ROWS = 10_000;
/** Texts longer than this are cut before measuring (one 10 MB string cell must not slow a pass). */
const MAX_SAMPLE_TEXT_LENGTH = 1_000;
/** Fixed header allowance for a sorted column: `ms-1` (4px) + the size-3.5 (14px) arrow + room for a 2-digit multi-sort priority number (~10px + 2px gap). */
const SORTED_HEADER_AFFORDANCE = 30;
/** Fixed header allowance for the per-column header-menu trigger: `p-0.5` (2px per side) + a size-3.5 (14px) chevron. */
const HEADER_MENU_AFFORDANCE = 18;

/** The view-shaped subset of store state the engine measures over. */
export type AutosizeState = {
  columns: readonly AnyColumnDef[];
  visibleColumns: readonly AnyColumnDef[];
  hiddenColumns: readonly string[];
  columnWidths: Record<string, number>;
  /** View (display) row order, post sort/filter — the rows the sample walks. */
  viewIndex: number[];
  data: readonly unknown[];
  /** The resolved cell-type registry (display text + value access go through the columns' types). */
  cellTypes: Record<string, CellType>;
  sortState: readonly SortSpec[];
  enableColumnResize: boolean;
  /** A consumer header-menu trigger is rendered (adds the trigger allowance to every measured header). */
  hasHeaderMenu: boolean;
};

/** The mounted view-row window `[start, end)` (the rows the user sees), `null` when nothing is mounted. */
export type AutosizeWindow = { start: number; end: number } | null;

/** Canvas fonts for `measureText`: the body cell font and the header cell font (headers render `font-medium`, so the two differ). */
export type AutosizeFonts = { cellFont: string; headerFont: string };

/**
 * Computes an autosize width for every target column: the widest of (header text + header
 * affordances) and (sampled cell display texts) plus `CELL_PADDING`, clamped through
 * `clampColumnWidth`. Views only: `viewIndex` (sort/filter applied) defines what is measured and
 * lazy holes (`data[viewIndex[i]] === undefined`) are skipped. Sample = `sampleRows` view rows
 * evenly strided across the view plus the mounted window's rows; texts are cut to
 * `MAX_SAMPLE_TEXT_LENGTH` and deduped per column before measuring.
 */
export function computeAutosizeWidths(
  state: AutosizeState,
  fonts: AutosizeFonts,
  window: AutosizeWindow,
  options?: AutosizeOptions,
): Record<string, number> {
  const { columns, visibleColumns, hiddenColumns, viewIndex, data, cellTypes, sortState, enableColumnResize, hasHeaderMenu } = state;
  const sampleRows = Math.min(Math.max(options?.sampleRows ?? DEFAULT_AUTOSIZE_SAMPLE_ROWS, 1), MAX_AUTOSIZE_SAMPLE_ROWS);
  const includeHeader = options?.includeHeader ?? true;

  let targets: AnyColumnDef[];
  if (options?.columnIds) {
    const byId = new Map(columns.map((column) => [column.id, column] as const));
    targets = [];
    for (const id of options.columnIds) {
      const column = byId.get(id);
      if (!column) {
        if (isDev()) console.warn(`[data-grid] autosizeColumns: unknown column id "${id}"`);
        continue;
      }
      if (hiddenColumns.includes(id) || !enableColumnResize || column.resizable === false) continue;
      targets.push(column);
    }
  } else {
    targets = visibleColumns.filter((column) => enableColumnResize && column.resizable !== false);
  }
  if (targets.length === 0) return {};

  // sample view rows: evenly strided across the whole view, plus every mounted window row
  const count = viewIndex.length;
  const sampled = new Set<number>();
  const stride = Math.max(1, Math.floor(count / sampleRows));
  for (let i = 0; i < count; i += stride) {
    sampled.add(i);
    if (sampled.size >= sampleRows) break;
  }
  if (window) {
    for (let i = Math.max(window.start, 0); i < Math.min(window.end, count); i++) sampled.add(i);
  }

  const sortedColumnIds = new Set(sortState.map((spec) => spec.columnId));
  const textFallback = cellTypes["text"]!;
  const result: Record<string, number> = {};
  for (const column of targets) {
    const cellType = cellTypes[column.type ?? "text"] ?? textFallback;
    const cellTexts = new Set<string>();
    for (const row of sampled) {
      const dataRow = viewIndex[row]!;
      const rowValue = data[dataRow];
      if (rowValue === undefined) continue; // lazy hole
      const value = getCellValue<unknown, AnyColumnDef>(rowValue, column);
      const text = displayText(cellType, value, column.options).slice(0, MAX_SAMPLE_TEXT_LENGTH);
      if (text) cellTexts.add(text);
    }
    const headerText = includeHeader
      ? (column.headerText ?? (typeof column.header === "string" ? column.header : "")).slice(0, MAX_SAMPLE_TEXT_LENGTH)
      : "";
    const headerWidth = headerText
      ? measureTextWidths([headerText], fonts.headerFont) + (sortedColumnIds.has(column.id) ? SORTED_HEADER_AFFORDANCE : 0) + (hasHeaderMenu ? HEADER_MENU_AFFORDANCE : 0)
      : 0;
    const cellWidth = measureTextWidths([...cellTexts], fonts.cellFont);
    result[column.id] = clampColumnWidth(column, Math.max(headerWidth, cellWidth) + CELL_PADDING);
  }
  return result;
}
