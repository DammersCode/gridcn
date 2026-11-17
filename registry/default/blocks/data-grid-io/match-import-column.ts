import type { GateContext } from "@/registry/default/blocks/data-grid/data-grid";
import { columnLabelText, isThenable } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import type { CsvDelimiter, ImportValueMode } from "./parse-import-file";

/** Minimal column shape the header-matching/preview logic needs — matches `ColumnDef` structurally. */
export type ImportTargetColumn = { id: string; headerText?: string; header: unknown };

/**
 * Consumer-configurable defaults applied at PRESELECTION time only — the user can always
 * override any of these in the dialog once it's open.
 */
export type ImportDefaults = {
  /** Skip auto-detect and preselect this delimiter. Detect still runs if undefined. */
  defaultDelimiter?: CsvDelimiter;
  /** How an Excel file's cells become text: `"formatted"` (default) applies number formats, `"raw"` reads stored values (see `ParseImportFileOptions.valueMode`). */
  valueMode?: ImportValueMode;
  /** Default for the header-row toggle. A number is the 0-based index of the header row: the rows above it are dropped, and that row is the header. `true` is `0`. Default `true`. */
  defaultHeaderRow?: boolean | number;
  /** Source columns to preselect as skipped: header names (case-insensitive) or indices. */
  defaultSkipColumns?: readonly (string | number)[];
  /**
   * Override the initial mapping per source column; return undefined to fall back to the
   * built-in matcher, null to skip. Wins over `defaultSkipColumns`. A promise holds the mapping
   * until it settles; a rejection falls back to the built-in matcher. `signal` aborts when a newer
   * parse of the dialog supersedes this one or the dialog unmounts; an aborted mapping is dropped.
   * Inside a grid, `gateTimeoutMs.mapColumn` aborts a pending mapping and falls back to the built-in matcher.
   */
  mapColumn?: (header: string, index: number, ctx: GateContext) => string | null | undefined | Promise<string | null | undefined>;
};

function firstWins(columns: readonly ImportTargetColumn[], keyOf: (column: ImportTargetColumn) => string): Map<string, string> {
  const map = new Map<string, string>();
  for (const column of columns) {
    const key = keyOf(column);
    if (!map.has(key)) map.set(key, column.id);
  }
  return map;
}

/**
 * Prefills the import-column -> grid-column mapping by matching each imported header against
 * `column.headerText ?? header ?? column.id`, case-insensitively. Unmatched headers map to `null`
 * (the dialog's '—' skip option). Each grid column can only be claimed once — a later duplicate
 * match falls back to `null` (skip) since one-source-per-grid-column is enforced everywhere.
 */
export function matchImportColumns(importHeaders: readonly string[], gridColumns: readonly ImportTargetColumn[]): (string | null)[] {
  const byLowerText = firstWins(gridColumns, (column) => columnLabelText(column).toLowerCase());
  const byLowerId = firstWins(gridColumns, (column) => column.id.toLowerCase());

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
 * once the dialog is open. A grid column that two import columns claim stays with the first
 * one, whether the matcher or `mapColumn` named it; the later import column maps to `null`.
 */
export function applyImportOptions(
  importHeaders: readonly string[],
  gridColumns: readonly ImportTargetColumn[],
  options: { defaultSkipColumns?: readonly (string | number)[]; mapColumn?: (header: string, index: number) => string | null | undefined } = {},
): (string | null)[] {
  return resolveImportMapping(importHeaders, gridColumns, options) as (string | null)[];
}

/** {@link applyImportOptions} for a `mapColumn` that may answer with a promise: a Promise when any column does, else the plain array. */
export function resolveImportMapping(
  importHeaders: readonly string[],
  gridColumns: readonly ImportTargetColumn[],
  options: Pick<ImportDefaults, "defaultSkipColumns" | "mapColumn"> & { signal?: AbortSignal } = {},
): (string | null)[] | Promise<(string | null)[]> {
  const { defaultSkipColumns, mapColumn } = options;
  const gateCtx: GateContext = { signal: options.signal ?? new AbortController().signal };
  const matched = matchImportColumns(importHeaders, gridColumns);
  const overridden = matched.map((gridColumnId, index) => {
    const header = importHeaders[index] ?? "";
    return defaultSkipColumns && isDefaultSkipped(header, index, defaultSkipColumns) ? null : gridColumnId;
  });
  const overrides = matched.map((_, index) => mapColumn?.(importHeaders[index] ?? "", index, gateCtx));
  const combine = (resolved: readonly (string | null | undefined)[]) => {
    const claimed = new Set<string>();
    return overridden.map((kept, index) => {
      const id = resolved[index] === undefined ? kept : resolved[index]!;
      if (id === null || claimed.has(id)) return null;
      claimed.add(id);
      return id;
    });
  };
  return overrides.some((override) => isThenable(override)) ? Promise.all(overrides).then(combine) : combine(overrides as (string | null | undefined)[]);
}
