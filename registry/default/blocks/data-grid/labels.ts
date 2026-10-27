/**
 * i18n via a typed labels object: every user-facing string across core + add-ons lives here with
 * English defaults. Consumers pass a `labels` prop (deep-merged over {@link DEFAULT_LABELS}) to
 * `DataGridProvider`; no i18n library dependency — wiring translated strings into
 * `DEFAULT_LABELS`'s shape is the consumer's job.
 */

import type { GridAction } from "./types";

/** Toolbar add-on strings: quick-search, filter menu, columns menu. */
export type DataGridToolbarLabels = {
  searchPlaceholder: string;
  searchAriaLabel: string;
  searchPreviousMatch: string;
  searchNextMatch: string;
  /** e.g. "3/17". */
  searchMatches: (current: number, total: number) => string;
  /** e.g. "3/1000+" when the match count hit the cap. */
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
  /** aria-label for a filter row's drag-handle drag handle (also moved via ArrowUp/ArrowDown while focused). */
  reorderFilterAriaLabel: string;
  /** Polite live-region announcement after a filter row moves; `column` is the filter's column label, `position`/`total` are 1-based. */
  filterReorderAnnouncement: (column: string, position: number, total: number) => string;
  addFilter: string;
  clearFilters: string;
  noFiltersApplied: string;
  /** Static "Where" label shown in the first filter row's join cell. */
  filterWhere: string;
  /** aria-label for the AND/OR join-operator select, shown once 2+ filters are active. */
  joinOperatorAriaLabel: string;
  joinOperatorAnd: string;
  joinOperatorOr: string;
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
  /** aria-label for a sort row's drag-handle drag handle (also moved via ArrowUp/ArrowDown while focused). */
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
  /** Tooltip shown on a blocked paste item (no clipboard-read permission granted). */
  pasteBlocked: string;
  /** Tooltip shown on Cut and Copy after the clipboard write failed (no clipboard-write permission, or no secure context). */
  clipboardFailed: string;
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
  /** Menu item that pins a column to the start side (`pin: "left"`). */
  pinStart: string;
  /** Menu item that pins a column to the end side (`pin: "right"`). */
  pinEnd: string;
  unpin: string;
  hideColumn: string;
  autosize: string;
  /** "Autosize all columns" — sizes every visible resizable column to its content. */
  autosizeAll: string;
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
  /** Per-`GridAction` row label shown in the dialog; consumer-added actions absent here fall back to a humanized action name (see `labelForAction`). */
  actions: Partial<Record<GridAction, string>>;
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
  /** Polite live-region announcement after a row move; `rowNumber` is the dragged row's 1-based number BEFORE the move, `position`/`total` are 1-based. */
  reorderAnnouncement: (rowNumber: number, position: number, total: number) => string;
  /** Polite live-region announcement after several rows move as a block; `position` is the 1-based number of the block's first row after the move. */
  reorderRowsAnnouncement: (count: number, position: number, total: number) => string;
};

/** Core grid strings not owned by a specific add-on. */
export type DataGridGridLabels = {
  /** Shown when the view has zero rows (post filter/search); the `emptyState` prop on `DataGridRoot`, when provided, wins over this default. */
  emptyState: string;
  /** aria-label for the loading skeleton region (`loading && rowCount === 0`); also used as the indeterminate progress bar's aria-label when rows are present. */
  loading: string;
  /** Placeholder for the date editor's typed input (default hints the ISO `yyyy-mm-dd` format). */
  datePlaceholder: string;
  /** aria-label for the date editor's calendar toggle button (`calendarTrigger`). */
  calendar: string;
};

/** Import/export add-on strings (`data-grid-io`): export dropdown + import dialog. */
export type DataGridIOLabels = {
  exportButtonAriaLabel: string;
  exportXlsx: string;
  exportCsv: string;
  importButton: string;
  importDialogTitle: string;
  importDialogDescription: string;
  chooseFile: string;
  noFileChosen: string;
  /** Size limit shown next to `noFileChosen` in the empty drop zone; `bytes` is the import's `maxFileBytes`. */
  maxFileSize: (bytes: number) => string;
  /** Caption on the compact drop zone shown once a file is already chosen, in the column-mapping step. */
  replaceFile: string;
  /** Fallback column header in the mapping table when "First row is a header" is unchecked; `index` is 1-based. */
  columnFallback: (index: number) => string;
  delimiter: string;
  delimiterComma: string;
  delimiterSemicolon: string;
  delimiterTab: string;
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
  /** Shown when the `onImport` callback rejected; the dialog stays open and the import can be retried. */
  importMergeFailed: string;
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
  /** Footer range label, e.g. "1–25 of 240". `total === 0` renders {@link DataGridPaginationLabels.rangeEmpty} instead. */
  range: (from: number, to: number, total: number) => string;
  rangeEmpty: string;
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
  /** Item beside the selection stats; `count` is the number of hidden checked rows (`keepHiddenCheckedRows`). */
  hiddenChecked: (count: number) => string;
  /** Stand-alone text when fewer than two cells are selected, so the bar has no stats to attach `hiddenChecked` to. */
  hiddenCheckedOnly: (count: number) => string;
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
  findReplace: DataGridFindReplaceLabels;
}

/** English defaults — every string in the shipped UI today, verbatim (so adopting `labels` never changes visible copy without an explicit override). */
export const DEFAULT_LABELS: DataGridLabels = {
  toolbar: {
    searchPlaceholder: "Search…",
    searchAriaLabel: "Search grid",
    searchPreviousMatch: "Previous match",
    searchNextMatch: "Next match",
    searchMatches: (current, total) => `${current}/${total}`,
    searchMatchesCapped: (current) => `${current}/1000+`,
    searchNoMatches: "0/0",
    filter: "Filter",
    filterAriaLabel: "Filters",
    filterColumnAriaLabel: "Filter column",
    filterOperatorAriaLabel: "Filter operator",
    filterValuePlaceholder: "Value",
    filterValueAriaLabel: "Filter value",
    filterValueAnyOfSummary: (count) => (count === 0 ? "Any value" : `${count} selected`),
    filterValueTrue: "true",
    filterValueFalse: "false",
    filterValueFromAriaLabel: "Filter value from",
    filterValueToAriaLabel: "Filter value to",
    removeFilterAriaLabel: "Remove filter",
    reorderFilterAriaLabel: "Reorder filter",
    filterReorderAnnouncement: (column, position, total) => `${column} filter moved to position ${position} of ${total}`,
    addFilter: "Add filter",
    clearFilters: "Clear all",
    noFiltersApplied: "No filters applied.",
    filterWhere: "Where",
    joinOperatorAriaLabel: "Match",
    joinOperatorAnd: "And",
    joinOperatorOr: "Or",
    columns: "Columns",
    columnsAriaLabel: "Columns",
    headerFilterAriaLabel: (column, filtered) => (filtered ? `Filter ${column}, filtered` : `Filter ${column}`),
    headerFilterSearchPlaceholder: "Search values…",
    headerFilterSelectedCount: (selected, total) => `${selected} of ${total} selected`,
    headerFilterBlanks: "(Blanks)",
    headerFilterCapped: "Too many values. Showing the first values only.",
    headerFilterLoadedRowsOnly: "From loaded rows",
    headerFilterTooManySelected: (max) => `Too many values selected. Select at most ${max}.`,
    headerFilterSelectAll: "Select all",
    headerFilterApply: "Apply",
    headerFilterClear: "Clear",
  },
  sort: {
    sort: "Sort",
    sortAriaLabel: "Sorts",
    columnAriaLabel: "Sort column",
    directionAriaLabel: "Sort direction",
    ascending: "Ascending",
    descending: "Descending",
    removeSortAriaLabel: "Remove sort",
    reorderSortAriaLabel: "Reorder sort",
    sortReorderAnnouncement: (column, position, total) => `${column} sort moved to position ${position} of ${total}`,
    addSort: "Add sort",
    clearSorts: "Clear all",
    noSortsApplied: "No sorts applied.",
  },
  filterOperators: {
    contains: "contains",
    notContains: "does not contain",
    equals: "equals",
    notEquals: "does not equal",
    startsWith: "starts with",
    endsWith: "ends with",
    empty: "is empty",
    notEmpty: "is not empty",
    gt: "greater than",
    gte: "greater than or equal",
    lt: "less than",
    lte: "less than or equal",
    isBetween: "is between",
    isAnyOf: "is any of",
    isNoneOf: "is none of",
  },
  contextMenu: {
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    pasteBlocked: "requires clipboard permission — use Ctrl+V",
    clipboardFailed: "clipboard access failed — use Ctrl+C or Ctrl+X",
    clearContents: "Clear contents",
    fillDown: "Fill down",
    fillRight: "Fill right",
    insertRowAbove: "Insert row above",
    insertRowBelow: "Insert row below",
    duplicateRow: "Duplicate row",
    duplicateRows: (count) => (count > 1 ? "Duplicate rows" : "Duplicate row"),
    deleteRow: "Delete row",
    deleteRows: (count) => (count > 1 ? "Delete rows" : "Delete row"),
    sortAsc: "Sort ascending",
    sortDesc: "Sort descending",
    clearSort: "Clear sort",
    pinStart: "Pin to start",
    pinEnd: "Pin to end",
    unpin: "Unpin",
    hideColumn: "Hide column",
    autosize: "Autosize column",
    autosizeAll: "Autosize all columns",
    columnMenuAriaLabel: (column) => `${column} column menu`,
  },
  keybindings: {
    title: "Keyboard shortcuts",
    description: "Every shortcut currently bound in this grid.",
    categories: {
      navigation: "Navigation",
      selection: "Selection",
      editing: "Editing",
      clipboardFill: "Clipboard & Fill",
      history: "History",
      other: "Other",
    },
    nativeCopy: "Copy",
    nativeCut: "Cut",
    nativePaste: "Paste",
    actions: {
      moveUp: "Move up",
      moveDown: "Move down",
      moveLeft: "Move left",
      moveRight: "Move right",
      moveUpKeepSelection: "Move up (keep selection)",
      moveDownKeepSelection: "Move down (keep selection)",
      moveLeftKeepSelection: "Move left (keep selection)",
      moveRightKeepSelection: "Move right (keep selection)",
      scrollActiveIntoView: "Scroll active cell into view",
      moveRowStart: "Move to row start",
      moveRowEnd: "Move to row end",
      jumpUp: "Jump to edge (up)",
      jumpDown: "Jump to edge (down)",
      jumpLeft: "Jump to edge (left)",
      jumpRight: "Jump to edge (right)",
      moveFirstCell: "Move to first cell",
      moveLastCell: "Move to last cell",
      pageUp: "Page up",
      pageDown: "Page down",

      extendUp: "Extend selection up",
      extendDown: "Extend selection down",
      extendLeft: "Extend selection left",
      extendRight: "Extend selection right",
      extendJumpUp: "Extend selection to edge (up)",
      extendJumpDown: "Extend selection to edge (down)",
      extendJumpLeft: "Extend selection to edge (left)",
      extendJumpRight: "Extend selection to edge (right)",
      extendFirstCell: "Extend selection to first cell",
      extendLastCell: "Extend selection to last cell",
      extendRowsToStart: "Check rows up to the first row",
      extendRowsToEnd: "Check rows down to the last row",
      extendRowsPageUp: "Check rows up one page",
      extendRowsPageDown: "Check rows down one page",
      selectRow: "Select row",
      selectColumn: "Select column",
      selectAll: "Select all",
      toggleRow: "Check or uncheck row",
      toggleAllRows: "Check or uncheck all rows",
      openColumnMenu: "Open column menu",
      openColumnFilter: "Open column filter",
      openFind: "Find",
      openFindReplace: "Find and replace",

      edit: "Edit cell",
      typeToReplace: "Type to replace",
      // "(editor)": these fire only while a cell editor is open (the keymap is ignored during an edit)
      commitDown: "Commit and move down (editor)",
      commitUp: "Commit and move up (editor)",
      commitRight: "Leave the grid forward (Tab)",
      commitLeft: "Leave the grid backward (Shift+Tab)",
      cancel: "Cancel edit",
      clearContents: "Delete contents",
      insertRowBelow: "Insert row below",
      insertRowAbove: "Insert row above",
      duplicateRow: "Duplicate row",
      deleteRows: "Delete row(s)",
      moveRowsUp: "Move rows up",
      moveRowsDown: "Move rows down",

      fillDown: "Fill down",
      fillRight: "Fill right",

      undo: "Undo",
      redo: "Redo",

      openLink: "Open link",
    },
  },
  markers: {
    columnHeader: "Row markers",
    selectAll: "Select all rows",
    selectRow: (rowNumber) => `Select row ${rowNumber}`,
    reorderRow: (rowNumber) => `Reorder row ${rowNumber}`,
    reorderAnnouncement: (rowNumber, position, total) => `Row ${rowNumber} moved to position ${position} of ${total}`,
    reorderRowsAnnouncement: (count, position, total) => `${count} rows moved to position ${position} of ${total}`,
  },
  grid: {
    emptyState: "No rows",
    loading: "Loading…",
    datePlaceholder: "yyyy-mm-dd",
    calendar: "Calendar",
  },
  io: {
    exportButtonAriaLabel: "Export",
    exportXlsx: "Export as Excel (.xlsx)",
    exportCsv: "Export as CSV",
    importButton: "Import",
    importDialogTitle: "Import file",
    importDialogDescription: "Choose a CSV or Excel file, then map its columns to the grid.",
    chooseFile: "Choose file",
    noFileChosen: "No file chosen",
    maxFileSize: (bytes) => `up to ${formatFileSize(bytes)}`,
    replaceFile: "Drop or click to replace",
    columnFallback: (index) => `Column ${index}`,
    delimiter: "Delimiter",
    delimiterComma: "Comma (,)",
    delimiterSemicolon: "Semicolon (;)",
    delimiterTab: "Tab",
    hasHeaderRow: "First row is a header",
    mapColumns: "Map columns",
    mapColumnsHint: "Each grid column can only be mapped from one source column.",
    mapColumnAriaLabel: (importColumn) => `Map "${importColumn}" to grid column`,
    skipColumn: "— Skip —",
    skipColumnQuick: "Skip column",
    preview: "Preview",
    previewTruncated: (shown, total) => `Showing ${shown} of ${total} rows`,
    sheet: "Sheet",
    import: "Import",
    cancel: "Cancel",
    errorParseFailed: "Could not read this file.",
    errorNoRows: "No rows found in this file.",
    errorUnsupportedFile: "Unsupported file type — choose a .csv, .xlsx, or .xls file.",
    errorUnsupportedExcelFormat: "This Excel format can't be imported — save the file as .xlsx and try again.",
    errorFileTooLarge: "This file is too large to import.",
    errorPartTooLarge: "A part of this file is too large to read safely. Save a smaller file, or ask the app owner to raise the import limit.",
    errorTooManyCells: "This file has too many rows or columns to import.",
    importRejectedCells: (count) => `${count} cell${count === 1 ? "" : "s"} failed validation and ${count === 1 ? "was" : "were"} left empty.`,
    importMergeFailed: "The import could not be completed. Try again.",
    printButtonAriaLabel: "Print",
    printTruncated: (printed, total) => `Printed ${printed} of ${total} rows`,
  },
  pagination: {
    firstPage: "First page",
    previousPage: "Previous page",
    nextPage: "Next page",
    lastPage: "Last page",
    pageAriaLabel: (page) => `Go to page ${page}`,
    pageSizeAriaLabel: "Rows per page",
    pageSizeOption: (size) => `${size} / page`,
    range: (from, to, total) => `${from}–${to} of ${total}`,
    rangeEmpty: "0 of 0",
  },
  statusBar: {
    count: "Count",
    sum: "Sum",
    avg: "Avg",
    min: "Min",
    max: "Max",
    approximate: (count) => `From the first ${count.toLocaleString("en-US")} cells`,
    hiddenChecked: (count) => `(+${count.toLocaleString("en-US")} hidden)`,
    hiddenCheckedOnly: (count) => `${count.toLocaleString("en-US")} hidden checked ${count === 1 ? "row" : "rows"}`,
  },
  findReplace: {
    dialogLabel: "Find and replace",
    findLabel: "Find",
    replaceLabel: "Replace with",
    matchCase: "Match case",
    wholeCell: "Whole cell",
    previous: "Previous match",
    next: "Next match",
    previousTitle: "Previous match (Shift+Enter)",
    nextTitle: "Next match (Enter)",
    replace: "Replace",
    replaceAll: "Replace all",
    toggleReplace: "Toggle replace",
    close: "Close",
    noMatches: "No results",
    typeToSearch: "Type to search",
    position: (index, total, capped) => `${index} of ${total.toLocaleString("en-US")}${capped ? "+" : ""} ${total === 1 && !capped ? "cell" : "cells"}`,
    replaced: (replaced, skipped) => (skipped > 0 ? `${replaced} replaced, ${skipped} skipped` : `${replaced} replaced`),
    moreRemain: "More matches remain. Run Replace all again.",
    validating: "Validating…",
  },
};

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

/** A byte count as "512 KB" or "1.5 MB": one decimal below 10, whole numbers above. */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pure deep merge for label overrides: plain objects merge recursively, everything else (functions, arrays, primitives) replaces the base value wholesale. */
export function deepMergeLabels<T>(base: T, override: DeepPartialLabels<T> | undefined): T {
  if (!override) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return (override as T) ?? base;

  const overrideRecord = override as Record<string, unknown>;
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overrideRecord)) {
    const overrideValue = overrideRecord[key];
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(overrideValue) ? deepMergeLabels(baseValue, overrideValue) : overrideValue;
  }
  return result as T;
}
