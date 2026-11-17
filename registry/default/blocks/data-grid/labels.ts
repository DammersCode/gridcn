/**
 * i18n via a typed labels object: nearly every user-facing string across core + add-ons lives here with
 * English defaults. Consumers pass a `labels` prop (deep-merged over {@link DEFAULT_LABELS}) to
 * `DataGridProvider`; no i18n library dependency — wiring translated strings into
 * `DEFAULT_LABELS`'s shape is the consumer's job.
 */

import type { GridAction } from "./types";
import { buildDefaultLabels } from "./label-defaults";

/** Toolbar add-on strings: quick-search, filter menu, columns menu. */
export type DataGridToolbarLabels = {
  searchPlaceholder: string;
  searchAriaLabel: string;
  searchPreviousMatch: string;
  searchNextMatch: string;
  /** e.g. "3/17". */
  searchMatches: (current: number, total: number) => string;
  /** e.g. "3/1000+" when more than 1,000 cells match. */
  searchMatchesCapped: (current: number) => string;
  /** No search performed yet / zero matches ("0/0"). */
  searchNoMatches: string;
  filter: string;
  filterAriaLabel: string;
  filterColumnAriaLabel: string;
  filterOperatorAriaLabel: string;
  filterValuePlaceholder: string;
  filterValueAriaLabel: string;
  /** Trigger text for the `isAnyOf` multi-choice input; `count` is how many choices are selected. */
  filterValueAnyOfSummary: (count: number) => string;
  /** Option text for a `checkbox`-column filter's value select. */
  filterValueTrue: string;
  filterValueFalse: string;
  /** aria-label for the `isBetween` range's minimum-value input. */
  filterValueFromAriaLabel: string;
  /** aria-label for the `isBetween` range's maximum-value input. */
  filterValueToAriaLabel: string;
  removeFilterAriaLabel: string;
  /** aria-label for a filter row's drag handle (also moved via ArrowUp/ArrowDown while focused). */
  reorderFilterAriaLabel: string;
  /** Polite live-region announcement after a filter row moves; `column` is the filter's column label, `position`/`total` are 1-based. */
  filterReorderAnnouncement: (column: string, position: number, total: number) => string;
  addFilter: string;
  clearFilters: string;
  noFiltersApplied: string;
  /** Static "Where" label shown in the first filter row's join cell. */
  filterWhere: string;
  addFilterGroup: string;
  removeFilterGroupAriaLabel: string;
  /** Name of a filter group in the reorder announcement. */
  filterGroupName: string;
  /** aria-label of the connector select of a node after the first in a group; it sets the join of the whole group. `position` is the 1-based node position, `group` the dotted 1-based group path such as "1.2". */
  filterGroupJoinAriaLabel: (position: number, group: string) => string;
  /** "and" option of the connector select; static text at the top level. */
  filterConnectorAnd: string;
  /** "or" option of the connector select. */
  filterConnectorOr: string;
  columns: string;
  columnsAriaLabel: string;
  /** aria-label of the header filter button; `filtered` is true while the column has any filter, including a condition filter. */
  headerFilterAriaLabel: (column: string, filtered: boolean) => string;
  headerFilterSearchPlaceholder: string;
  /** Status line under the search; `selected` of the `total` listed values are checked. */
  headerFilterSelectedCount: (selected: number, total: number) => string;
  /** Label of the value for empty cells. */
  headerFilterBlanks: string;
  /** Status line when the value list stopped collecting at its limit. */
  headerFilterCapped: string;
  headerFilterLoadedRowsOnly: string;
  headerFilterLoading: string;
  headerFilterError: string;
  /** Shown when the column also has filter rows inside a group; Clear removes those too. */
  headerFilterGroupRows: string;
  /** Shown when the selection would store more than `max` entries. */
  headerFilterTooManySelected: (max: number) => string;
  headerFilterSelectAll: string;
  headerFilterApply: string;
  headerFilterClear: string;
};

/** Sort-list add-on strings (`data-grid-sort-list`): toolbar sort button + popover of applied sorts. */
export type DataGridSortLabels = {
  sort: string;
  sortAriaLabel: string;
  columnAriaLabel: string;
  directionAriaLabel: string;
  ascending: string;
  descending: string;
  removeSortAriaLabel: string;
  /** aria-label for a sort row's drag handle (also moved via ArrowUp/ArrowDown while focused). */
  reorderSortAriaLabel: string;
  /** Polite live-region announcement after a sort row moves; `column` is the sort's column label, `position`/`total` are 1-based. */
  sortReorderAnnouncement: (column: string, position: number, total: number) => string;
  addSort: string;
  clearSorts: string;
  noSortsApplied: string;
};

/** Per-column filter operator display names (toolbar filter menu's operator `<Select>`). */
export type DataGridFilterOperatorLabels = {
  contains: string;
  notContains: string;
  equals: string;
  notEquals: string;
  startsWith: string;
  endsWith: string;
  empty: string;
  notEmpty: string;
  gt: string;
  gte: string;
  lt: string;
  lte: string;
  isBetween: string;
  isAnyOf: string;
  isNoneOf: string;
};

/** Cell/header right-click context menu + header dropdown menu strings (shared verbatim between the two surfaces). */
export type DataGridContextMenuLabels = {
  cut: string;
  copy: string;
  paste: string;
  /** Tooltip shown on a blocked paste item (no clipboard-read permission granted). A function receives the platform modifier name ("Ctrl" or "⌘"). */
  pasteBlocked: string | ((modifier: string) => string);
  /** Tooltip of a disabled row item while the grid is read-only. */
  rowActionReadOnly: string;
  /** Tooltip of a disabled row item while only hidden rows are checked. */
  rowActionHiddenChecked: string;
  /** Tooltip of a disabled row item while "all matching" rows are checked. */
  rowActionAllMatching: string;
  /** Tooltip shown on Cut and Copy after the clipboard write failed (no clipboard-write permission, or no secure context). */
  clipboardFailed: string | ((modifier: string) => string);
  clearContents: string;
  fillDown: string;
  fillRight: string;
  insertRowAbove: string;
  insertRowBelow: string;
  duplicateRow: string;
  duplicateRows: (count: number) => string;
  deleteRow: string;
  deleteRows: (count: number) => string;
  sortAsc: string;
  sortDesc: string;
  clearSort: string;
  /** Menu item that pins a column to the start side (`pin: "start"`). */
  pinStart: string;
  /** Menu item that pins a column to the end side (`pin: "end"`). */
  pinEnd: string;
  unpin: string;
  hideColumn: string;
  autosize: string;
  /** "Autosize all columns" — sizes every visible resizable column to its content. */
  autosizeAll: string;
  /** Menu item that moves the column one place toward the start side, within its pin zone. */
  moveTowardStart: string;
  /** Menu item that moves the column one place toward the end side, within its pin zone. */
  moveTowardEnd: string;
  /** Menu item that makes the column one step wider. */
  widenColumn: string;
  /** Menu item that makes the column one step narrower. */
  narrowColumn: string;
  /** aria-label for the per-column header dropdown's ghost chevron trigger; `column` is the header text. */
  columnMenuAriaLabel: (column: string) => string;
};

/** Keybindings-dialog add-on strings: title/description + the section headings and native-clipboard rows. */
export type DataGridKeybindingsLabels = {
  title: string;
  description: string;
  categories: {
    navigation: string;
    selection: string;
    editing: string;
    clipboardFill: string;
    history: string;
    other: string;
  };
  /** Native browser clipboard shortcuts listed alongside the keymap (not GridActions). */
  nativeCopy: string;
  nativeCut: string;
  nativePaste: string;
  /** Per-`GridAction` row label shown in the dialog; consumer-added actions absent here fall back to a humanized action name. */
  actions: Partial<Record<GridAction | (string & {}), string>>;
};

/** Row-marker column strings (select-all header checkbox, per-row checkbox, reorder handle). */
export type DataGridMarkerLabels = {
  /** Accessible name of the marker column header. */
  columnHeader: string;
  selectAll: string;
  /** `rowNumber` is 1-based (matches the visible row-number marker). */
  selectRow: (rowNumber: number) => string;
  /** aria-label for the reorder-mode marker handle; `rowNumber` is 1-based. */
  reorderRow: (rowNumber: number) => string;
  /**
   * Polite live-region announcement after a row move; `rowNumber` is the moved row's 1-based number BEFORE the move,
   * `position` its 1-based number after it, and `total` the row count. On a paged grid all three count the rows of the shown page, like the row-number marker.
   */
  reorderAnnouncement: (rowNumber: number, position: number, total: number) => string;
  /** Polite live-region announcement after several rows move as a block; `position` is the 1-based number of the block's first row after the move. Numbers count page rows on a paged grid. */
  reorderRowsAnnouncement: (count: number, position: number, total: number) => string;
};

/** Core grid strings not owned by a specific add-on. */
export type DataGridGridLabels = {
  /** Shown when the source has no rows and nothing filters; the `emptyState` prop on `DataGridRoot`, when provided, wins over this default. */
  emptyState: string;
  /** Shown instead of `emptyState` when a filter or a server search leaves zero rows. */
  noResults: string;
  /** The built-in error state of `DataGridRoot` (`error`). */
  errorState: string;
  /** The Retry button of the built-in error state. */
  errorRetry: string;
  /** Label of the screen reader progress element that the grid renders while `loading` is true. The skeleton and the bar are `aria-hidden`. */
  loading: string;
  /** Placeholder for the date editor's typed input (default hints the ISO `yyyy-mm-dd` format). */
  datePlaceholder: string;
  /** aria-label for the date editor's calendar toggle button (`calendarTrigger`). */
  dateCalendarAriaLabel: string;
  /** Polite live-region announcement after the checked rows change; `count` is the new number of checked rows. */
  rowsChecked: (count: number) => string;
  /** Live-region text after "select all matching" when the size of the result is unknown. */
  allMatchingChecked: string;
  /** Polite live-region announcement after a filter or sort commit or the end of a load (`announceResults`); `count` is the view's row count, and a count of 0 reads `noResults`. */
  resultsCount: (count: number) => string;
  /** Result announcement when the source is lazy: `count` is the loaded rows in the view, so the text says so. */
  resultsCountLoaded: (count: number) => string;
  /** Polite live-region announcement when the view turns stale: a push changed a value that the sort or filter reads (at most once per 30 seconds). */
  viewStale: string;
  /** Live-region text after a save refused rows; `count` is the number of refused rows. */
  saveRejected: (count: number) => string;
  /** Live-region text when an undo or redo step needs rows that a lazy source has not loaded yet. */
  historyRowsNotLoaded: string;
  /** Live-region text when an undo or redo step is skipped because its rows no longer exist. */
  historyRowsGone: string;
};

/** Import/export add-on strings (`data-grid-io`): export dropdown + import dialog. */
export type DataGridIOLabels = {
  exportButtonAriaLabel: string;
  exportXlsx: string;
  exportCsv: string;
  exportAllXlsx: string;
  exportAllCsv: string;
  exportCancel: string;
  exportCancelled: string;
  exportFailed: string;
  exportDone: (rowCount: number, truncated: boolean) => string;
  importButton: string;
  importDialogTitle: string;
  importDialogDescription: string;
  chooseFile: string;
  /** @deprecated The empty drop zone reads `emptyDropzoneCaption`. */
  noFileChosen: string;
  /** Size limit in the empty drop zone caption; `bytes` is the import's `maxFileBytes`. */
  maxFileSize: (bytes: number) => string;
  /** Caption of the empty import drop zone; `maxSize` is the `maxFileSize` text. */
  emptyDropzoneCaption: (maxSize: string) => string;
  /** Screen-reader description of the drop zone; `types` lists the accepted extensions and `maxSize` is the `maxFileSize` text. */
  dropzoneDescription: (types: readonly string[], maxSize: string) => string;
  /** Caption on the compact drop zone shown once a file is already chosen, in the column-mapping step. */
  replaceFile: string;
  /** Fallback column header in the mapping table when "First row is a header" is unchecked; `index` is 1-based. */
  columnFallback: (index: number) => string;
  delimiter: string;
  delimiterComma: string;
  delimiterSemicolon: string;
  delimiterTab: string;
  delimiterPipe: string;
  hasHeaderRow: string;
  mapColumns: string;
  /** One-line hint under the mapping grid explaining why mapped columns disappear from other selects. */
  mapColumnsHint: string;
  mapColumnAriaLabel: (importColumn: string) => string;
  skipColumn: string;
  /** aria-label for the per-row quick-skip (X) button next to the mapping Select. */
  skipColumnQuick: string;
  preview: string;
  previewTruncated: (shown: number, total: number) => string;
  /** Label of the sheet picker shown when an imported workbook has more than one sheet. */
  sheet: string;
  import: string;
  cancel: string;
  errorParseFailed: string;
  errorNoRows: string;
  errorUnsupportedFile: string;
  /** Shown for an Excel file that is neither xlsx nor Excel 97-2003 (BIFF8) xls, e.g. an HTML table or Excel 2003 XML saved as .xls. */
  errorUnsupportedExcelFormat: string;
  /** Shown when a chosen file exceeds the import size limit. */
  errorFileTooLarge: string;
  /** Shown when one part of an xlsx file (a worksheet, the shared strings) is too large to read safely; the app owner raises `importLimits.maxCells` or `maxDecompressedBytes`. */
  errorPartTooLarge: string;
  /** Shown when a file exceeds the import row, column, or cell limit. */
  errorTooManyCells: string;
  /** Shown under the mapping grid when the import build rejected cells; `count` is the rejected-cell count. */
  importRejectedCells: (count: number) => string;
  /** Tooltip of the disabled import button and message in the dialog when the grid holds a window of a server result and has no `onImport`. */
  importNeedsOnImport: string;
  /** Tooltip of the disabled import button and message in the dialog when the grid is read-only and has no `onImport`. */
  importReadOnly: string;
  /** Shown when the `onImport` callback rejected; the dialog stays open and the import can be retried. */
  importMergeFailed: string;
  /** Shown when `onImport` rejects with an error that has a message. */
  importFailedWithMessage: (message: string) => string;
  /** Shown when a row hook, `createRow`, or a cell hook failed before `onImport` ran. */
  importBuildFailed: string;
  /** aria-label for the print toolbar button. */
  printButtonAriaLabel: string;
  /** Note shown under the printed table when the row cap cut the output; `printed` is the table's rows, `total` the scope rows. */
  printTruncated: (printed: number, total: number) => string;
};

/** Pagination add-on strings (`data-grid-pagination`): footer prev/next, page numbers, page-size select, range label. */
export type DataGridPaginationLabels = {
  firstPage: string;
  previousPage: string;
  nextPage: string;
  lastPage: string;
  /** aria-label for a numbered page button; `page` is 1-based. */
  pageAriaLabel: (page: number) => string;
  pageSizeAriaLabel: string;
  /** Option text in the page-size select, e.g. "25 / page". */
  pageSizeOption: (size: number) => string;
  /** Footer range label, e.g. "1–25 of 240". `totalRowCount === 0` renders {@link DataGridPaginationLabels.rangeEmpty} instead. */
  range: (from: number, to: number, totalRowCount: number) => string;
  rangeEmpty: string;
  /** Footer range label when the server sends no row count, e.g. "Page 3". */
  rangeUnknown: (page: number) => string;
};

/** Status-bar add-on strings (`data-grid-status-bar`): aggregate labels and the capped-walk `title`. */
export type DataGridStatusBarLabels = {
  count: string;
  sum: string;
  avg: string;
  min: string;
  max: string;
  /** `title` while the walk stopped at the cell cap; `count` is the cap. */
  approximate: (count: number) => string;
  /** Item beside the selection stats; `count` is the number of hidden checked rows (`checkedRowsLifetime="across-filters"`). */
  hiddenChecked: (count: number) => string;
  /** Stand-alone text when fewer than two cells are selected, so the bar has no stats to attach `hiddenChecked` to. */
  hiddenCheckedOnly: (count: number) => string;
  /** Select-all banner: every row of the page is checked and the result is larger. `count` is the rows on the page. */
  pageSelected: (count: number) => string;
  /** Select-all banner button. `total` is `null` when the size of the result is unknown. */
  selectAllMatching: (total: number | null) => string;
  /** Select-all banner after "select all matching". `count` is `null` when the size of the result is unknown. */
  allSelected: (count: number | null) => string;
  clearSelection: string;
};

/** Saved-views add-on strings (`data-grid-views`): the menu, its buttons, and its live-region messages. */
export type DataGridViewsLabels = {
  views: string;
  modified: string;
  loading: string;
  empty: string;
  loadFailed: string;
  saveFailed: string;
  limit: string;
  /** The line shown while the view state is over a limit; `part` names what is over. */
  overLimit: (part: "sorts" | "filters" | "search" | "layout") => string;
  importedName: string;
  retry: string;
  setDefault: (name: string) => string;
  unsetDefault: (name: string) => string;
  rename: (name: string) => string;
  delete: (name: string) => string;
  confirmDelete: (name: string) => string;
  newViewName: string;
  saveNew: string;
  updateActive: (name: string) => string;
  confirmRename: string;
  cancel: string;
  fileLabel: string;
  exportView: string;
  importView: string;
  saved: (name: string) => string;
  updated: (name: string) => string;
  renamed: (name: string) => string;
  deleted: (name: string) => string;
  applied: (name: string) => string;
  imported: (name: string, dropped: number) => string;
  exported: string;
  exportTooLarge: string;
  importFailed: (reason: "too-large" | "invalid" | "limit" | "loading") => string;
};

/** Find-and-replace panel strings. */
export type DataGridFindReplaceLabels = {
  dialogLabel: string;
  findLabel: string;
  replaceLabel: string;
  matchCase: string;
  wholeCell: string;
  previous: string;
  next: string;
  /** Tooltip of the previous button; name the key. */
  previousTitle: string;
  /** Tooltip of the next button; name the key. */
  nextTitle: string;
  replace: string;
  replaceAll: string;
  toggleReplace: string;
  close: string;
  noMatches: string;
  /** Status line while the Find field is empty. */
  typeToSearch: string;
  /** `capped` is true while the highlight list stopped at its cap, so `total` is a lower bound. */
  position: (index: number, total: number, capped: boolean) => string;
  replaced: (replaced: number, skipped: number) => string;
  moreRemain: string;
  validating: string;
  scopeLoadedRows: string;
  /** Status line text when `processReplace` vetoed the replace or returned an unusable plan. */
  replaceCancelled: string;
};

/** Every user-facing default string across core + every add-on, grouped by owning surface. */
export interface DataGridLabels {
  toolbar: DataGridToolbarLabels;
  sort: DataGridSortLabels;
  filterOperators: DataGridFilterOperatorLabels;
  contextMenu: DataGridContextMenuLabels;
  keybindings: DataGridKeybindingsLabels;
  markers: DataGridMarkerLabels;
  grid: DataGridGridLabels;
  io: DataGridIOLabels;
  pagination: DataGridPaginationLabels;
  statusBar: DataGridStatusBarLabels;
  views: DataGridViewsLabels;
  findReplace: DataGridFindReplaceLabels;
}

/** English defaults — nearly every string in the shipped UI, verbatim (so adopting `labels` never changes visible copy without an explicit override). */
export const DEFAULT_LABELS: DataGridLabels = buildDefaultLabels("en-US");

const MAX_CACHED_LOCALES = 16;
const labelsByLocale = new Map<string, DataGridLabels>();

function canonicalLocale(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? "en-US";
  } catch {
    return "en-US";
  }
}

/** {@link DEFAULT_LABELS} with numbers formatted in `locale`; one object per canonical locale, the 16 most recent cached. */
export function defaultLabelsFor(locale: string): DataGridLabels {
  const key = canonicalLocale(locale);
  if (key === "en-US") return DEFAULT_LABELS;
  let labels = labelsByLocale.get(key);
  if (!labels) {
    labels = buildDefaultLabels(key);
    if (labelsByLocale.size >= MAX_CACHED_LOCALES) labelsByLocale.delete(labelsByLocale.keys().next().value!);
    labelsByLocale.set(key, labels);
  }
  return labels;
}

/** Recursive partial override of {@link DataGridLabels}: arrays and functions are replaced wholesale, plain objects merge key-by-key. */
export type DeepPartialLabels<T = DataGridLabels> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? T[K]
    : T[K] extends readonly unknown[]
      ? T[K]
      : T[K] extends object
        ? DeepPartialLabels<T[K]>
        : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Merges label layers left to right, skipping `undefined` values: a flat label set, or the base of a deep merge. */
export function mergeLabelLayers<T extends object>(...layers: readonly (Partial<T> | undefined)[]): T {
  const result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) result[key] = value;
    }
  }
  return result as T;
}

/** Pure deep merge for label overrides: plain objects merge recursively, everything else (functions, arrays, primitives) replaces the base value wholesale. An `undefined` override value keeps the base. */
export function deepMergeLabels<T>(base: T, override: DeepPartialLabels<T> | undefined): T {
  if (!override) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return (override as T) ?? base;

  const overrideRecord = override as Record<string, unknown>;
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrideRecord)) {
    const overrideValue = overrideRecord[key];
    if (overrideValue === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(overrideValue) ? deepMergeLabels(baseValue, overrideValue) : overrideValue;
  }
  return result as T;
}
