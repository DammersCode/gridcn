import type { CsvDelimiter } from "./parse-import-file";

/** Minimal column shape the header-matching/preview logic needs — matches `ColumnDef` structurally. */
export type ImportTargetColumn = { id: string; headerText?: string; header: unknown };

/**
 * Consumer-configurable defaults applied at PRESELECTION time only — the user can always
 * override any of these in the dialog once it's open. See import-export.mdx for the worked
 * example.
 */
export type ImportDefaults = {
  /** Skip auto-detect and preselect this delimiter. Detect still runs if undefined. */
  defaultDelimiter?: CsvDelimiter;
  /** false disables delimiter auto-detection; defaultDelimiter (or ",") is used. Default true. */
  autoDetectDelimiter?: boolean;
  /** Default for the header-row toggle. Default true (current behavior). */
  defaultHeaderRow?: boolean;
  /** Source columns to preselect as skipped: header names (case-insensitive) or indices. */
  defaultSkipColumns?: readonly (string | number)[];
  /**
   * Override the initial mapping per source column; return undefined to fall back to the
   * built-in matcher, null to skip. Wins over `defaultSkipColumns`.
   */
  mapColumn?: (header: string, index: number) => string | null | undefined;
};

/** Column display header for matching: `headerText`, else the string `header`, else the id. */
function columnMatchText(column: ImportTargetColumn): string {
  return column.headerText ?? (typeof column.header === "string" ? column.header : column.id);
}

/**
 * Prefills the import-column -> grid-column mapping by matching each imported header against
 * `column.headerText ?? header ?? column.id`, case-insensitively. Unmatched headers map to `null`
 * (the dialog's '—' skip option). Each grid column can only be claimed once — a later duplicate
 * match falls back to `null` (skip) since one-source-per-grid-column is enforced everywhere.
 */
export function matchImportColumns(importHeaders: readonly string[], gridColumns: readonly ImportTargetColumn[]): (string | null)[] {
  const byLowerText = new Map(gridColumns.map((column) => [columnMatchText(column).toLowerCase(), column.id] as const));
  const byLowerId = new Map(gridColumns.map((column) => [column.id.toLowerCase(), column.id] as const));

  const claimed = new Set<string>();
  return importHeaders.map((header) => {
    const key = header.trim().toLowerCase();
    const gridColumnId = byLowerText.get(key) ?? byLowerId.get(key) ?? null;
    if (gridColumnId === null || claimed.has(gridColumnId)) return null;
    claimed.add(gridColumnId);
    return gridColumnId;
  });
}

/** True when `defaultSkipColumns` names `header` (case-insensitive) or `index` (0-based). */
function isDefaultSkipped(header: string, index: number, defaultSkipColumns: readonly (string | number)[]): boolean {
  const key = header.trim().toLowerCase();
  return defaultSkipColumns.some((entry) => (typeof entry === "number" ? entry === index : entry.trim().toLowerCase() === key));
}

/**
 * Preselects the import-column -> grid-column mapping: starts from {@link matchImportColumns},
 * then applies `options.defaultSkipColumns` (by header name or index), then `options.mapColumn`
 * per column (wins over `defaultSkipColumns`; `undefined` keeps whatever came before it). All of
 * this only decides the dialog's *initial* mapping — the user can still change every cell by hand
 * once the dialog is open. Duplicate-claim dedup from {@link matchImportColumns} still applies
 * first; `mapColumn` overrides are trusted as-is and not deduped against each other, matching a
 * consumer's explicit intent.
 */
export function applyImportOptions(
  importHeaders: readonly string[],
  gridColumns: readonly ImportTargetColumn[],
  options: Pick<ImportDefaults, "defaultSkipColumns" | "mapColumn"> = {},
): (string | null)[] {
  const { defaultSkipColumns, mapColumn } = options;
  const matched = matchImportColumns(importHeaders, gridColumns);
  return matched.map((gridColumnId, index) => {
    const header = importHeaders[index] ?? "";
    const overridden = defaultSkipColumns && isDefaultSkipped(header, index, defaultSkipColumns) ? null : gridColumnId;
    const resolved = mapColumn?.(header, index);
    return resolved === undefined ? overridden : resolved;
  });
}
