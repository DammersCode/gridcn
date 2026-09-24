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
  /** aria-label for a filter row's drag-handle grip (also moved via ArrowUp/ArrowDown while focused). */
  reorderFilterAriaLabel: string;
  /** Polite live-region announcement after a filter row moves; `column` is the filter's column label, `position`/`total` are 1-based. */
  filterReorderAnnouncement: (column: string, position: number, total: number) => string;
  addFilter: string;
  clearFilters: string;
  noFiltersApplied: string;
  /** Static "Where" label shown in the first filter row's join cell (tablecn parity). */
  filterWhere: string;
  /** aria-label for the AND/OR join-operator select, shown once 2+ filters are active. */
  joinOperatorAriaLabel: string;
  joinOperatorAnd: string;
  joinOperatorOr: string;
  columns: string;
  columnsAriaLabel: string;
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
  /** aria-label for a sort row's drag-handle grip (also moved via ArrowUp/ArrowDown while focused). */
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
};

/** Cell/header right-click context menu + header dropdown menu strings (shared verbatim between the two surfaces). */
export type DataGridContextMenuLabels = {
  cut: string;
  copy: string;
  paste: string;
  /** Tooltip shown on a blocked paste item (no clipboard-read permission granted). */
  pasteBlocked: string;
  clearContents: string;
  insertRowAbove: string;
  insertRowBelow: string;
  duplicateRow: string;
  duplicateRows: (count: number) => string;
  deleteRow: string;
  deleteRows: (count: number) => string;
  sortAsc: string;
  sortDesc: string;
  clearSort: string;
  pinLeft: string;
  pinRight: string;
  unpin: string;
  hideColumn: string;
  autosize: string;
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
  selectAll: string;
  /** `rowNumber` is 1-based (matches the visible row-number marker). */
  selectRow: (rowNumber: number) => string;
  /** aria-label for the reorder-mode marker handle; `rowNumber` is 1-based. */
  reorderRow: (rowNumber: number) => string;
  /** Polite live-region announcement after a row move; `rowNumber` is the dragged row's 1-based number BEFORE the move, `position`/`total` are 1-based. */
  reorderAnnouncement: (rowNumber: number, position: number, total: number) => string;
};

/** Core grid strings not owned by a specific add-on. */
export type DataGridGridLabels = {
  /** Shown when the view has zero rows (post filter/search); the `emptyState` prop on `DataGridRoot`, when provided, wins over this default. */
  emptyState: string;
  /** aria-label for the loading skeleton region (`loading && rowCount === 0`); also used as the indeterminate progress bar's aria-label when rows are present. */
  loading: string;
  /** Placeholder for the date editor's typed input (default hints the ISO `yyyy-mm-dd` format). */
  datePlaceholder: string;
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
  /** Shown under the mapping grid when the import build rejected cells; `count` is the rejected-cell count. */
  importRejectedCells: (count: number) => string;
  /** Shown when the `onImport` callback rejected; the dialog stays open and the import can be retried. */
  importMergeFailed: string;
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
  },
  contextMenu: {
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    pasteBlocked: "requires clipboard permission — use Ctrl+V",
    clearContents: "Clear contents",
    insertRowAbove: "Insert row above",
    insertRowBelow: "Insert row below",
    duplicateRow: "Duplicate row",
    duplicateRows: (count) => (count > 1 ? "Duplicate rows" : "Duplicate row"),
    deleteRow: "Delete row",
    deleteRows: (count) => (count > 1 ? "Delete rows" : "Delete row"),
    sortAsc: "Sort ascending",
    sortDesc: "Sort descending",
    clearSort: "Clear sort",
    pinLeft: "Pin left",
    pinRight: "Pin right",
    unpin: "Unpin",
    hideColumn: "Hide column",
    autosize: "Autosize column",
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
      retainMoveUp: "Move up (keep selection)",
      retainMoveDown: "Move down (keep selection)",
      retainMoveLeft: "Move left (keep selection)",
      retainMoveRight: "Move right (keep selection)",
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
      selectRow: "Select row",
      selectColumn: "Select column",
      selectAll: "Select all",

      edit: "Edit cell",
      editReplace: "Type to replace",
      // "(editor)": these fire only while a cell editor is open (the keymap is ignored during an edit)
      commitDown: "Commit and move down (editor)",
      commitUp: "Commit and move up (editor)",
      commitRight: "Commit and move right (editor)",
      commitLeft: "Commit and move left (editor)",
      cancel: "Cancel edit",
      deleteContents: "Delete contents",
      insertRowBelow: "Insert row below",
      duplicateRow: "Duplicate row",

      fillDown: "Fill down",
      fillRight: "Fill right",

      undo: "Undo",
      redo: "Redo",
    },
  },
  markers: {
    selectAll: "Select all rows",
    selectRow: (rowNumber) => `Select row ${rowNumber}`,
    reorderRow: (rowNumber) => `Reorder row ${rowNumber}`,
    reorderAnnouncement: (rowNumber, position, total) => `Row ${rowNumber} moved to position ${position} of ${total}`,
  },
  grid: {
    emptyState: "No rows",
    loading: "Loading…",
    datePlaceholder: "yyyy-mm-dd",
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
    importRejectedCells: (count) => `${count} cell${count === 1 ? "" : "s"} failed validation and ${count === 1 ? "was" : "were"} left empty.`,
    importMergeFailed: "The import could not be completed. Try again.",
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
