/**
 * Every grid-owned `data-*` DOM attribute, in one place. Each is stamped by exactly one component
 * (noted per entry) and read back by selectors/tests elsewhere — collecting them here means a typo
 * in either place is a compile error instead of a silently-broken selector. Does NOT cover
 * shadcn/Base-UI-owned attributes (`data-slot`, `data-state`, etc.) or plain per-row/column
 * identifiers (`data-column-id`) that carry a consumer value rather than a fixed grid enum.
 */
export const GRID_ATTR = {
  /** cell.tsx: `"left" | "right"` when the column is pinned, absent otherwise. Also stamped boolean-style (`""`/absent) by the selection/fill/presence overlays when their rect falls in a pinned zone. */
  pinned: "data-pinned",
  /** cell.tsx: present (`""`) on a `data-grid-pinned-rows` band cell (rendered via `DataGridCell`'s `pinned` mode). */
  pinnedRow: "data-grid-pinned-row",
  /** cell.tsx: present (`""`) on the focused cell. */
  active: "data-active",
  /** cell.tsx: present (`""`) while the cell is in edit mode. */
  editing: "data-editing",
  /** cell.tsx: present (`""`) when the cell matches the current quick-search text. */
  searchMatch: "data-search-match",
  /** row.tsx: the row's view-space index (number), immune to pinned-top band shifting `aria-rowindex`; read back by `resolve-context-menu-target.ts`. */
  rowIndex: "data-grid-row-index",
  /** header-cell.tsx: present (`""`) while that column's resize handle is being dragged. */
  resizing: "data-resizing",
  /** rows/marker-cell.tsx: present (`""`) on a rows-channel selected row's marker cell. */
  selected: "data-row-selected",
  /** windowing/use-scrolled-edges.ts: present (`""`) on the viewport while scrolled away from its inline-start edge. */
  scrolledLeft: "data-scrolled-left",
  /** windowing/use-scrolled-edges.ts: present (`""`) on the viewport while there's more to scroll toward its inline-end edge. */
  scrolledRight: "data-scrolled-right",
  /** windowing/use-scrolled-edges.ts: present (`""`) on the viewport while scrolled away from its top edge. */
  scrolledTop: "data-scrolled-top",
  /** windowing/use-scrolled-edges.ts: present (`""`) on the viewport while there's more to scroll toward its bottom edge. */
  scrolledBottom: "data-scrolled-bottom",

  /** body.tsx: the scrolling row-canvas container. */
  rowsCanvas: "data-grid-rows-canvas",
  /** header.tsx: the sticky header row layer. */
  headerLayer: "data-grid-header-layer",
  /** header.tsx (columns) / body.tsx (rows): the reorder drop-position indicator. */
  dropIndicator: "data-grid-drop-indicator",
  /** rows/marker-cell.tsx: the checkbox glyph inside a marker cell (`'checkbox'`/`'both'` modes) — its press keeps the row-select gesture and never arms a reorder. */
  markerCheckbox: "data-grid-marker-checkbox",
  /** rows/marker-cell.tsx: the grip handle inside a marker cell (`'reorder'` mode). */
  reorderHandle: "data-grid-reorder-handle",
  /** header-cell.tsx: the column-menu trigger button. */
  headerMenuTrigger: "data-grid-header-menu-trigger",
  /** header-cell.tsx: the column resize handle. */
  resizeHandle: "data-grid-resize-handle",
  /** columns/sort-indicator.tsx: `"asc" | "desc"`, the header's own sort-direction arrow. */
  sortIndicator: "data-grid-sort-indicator",
  /** rows/marker-cell.tsx: the row-marker column's per-row cell. */
  markerCell: "data-grid-marker-cell",
  /** rows/marker-cell.tsx: the row-number span inside a marker cell (`'number'`/`'both'` modes). */
  markerNumber: "data-grid-marker-number",
  /** rows/marker-header.tsx: the row-marker column's header cell (select-all checkbox). */
  markerHeader: "data-grid-marker-header",
  /** rows/loading-skeleton.tsx: the empty-data loading skeleton (`loading && rowCount === 0`). */
  loadingSkeleton: "data-grid-loading-skeleton",
  /** rows/loading-skeleton.tsx: the data-present loading indicator bar (`loading && rowCount > 0`). */
  loadingBar: "data-grid-loading-bar",
  /** root.tsx: the empty-state container (rendered when there are zero rows in view and not loading). */
  emptyState: "data-grid-empty-state",
  /** root.tsx: `"left" | "right" | "top" | "bottom"`, a frozen-edge shadow shown while scrolled past that edge. */
  pinShadow: "data-grid-pin-shadow",
  /** cell-types/date.tsx, cell-types/select.tsx: a cell-type's own editor popup/portal content — `use-grid-interaction.ts` ignores pointer/click events that land inside one. */
  cellEditor: "data-grid-cell-editor",
  /** overlays.tsx: the selection-range overlay(s). */
  selectionOverlay: "data-grid-selection-overlay",
  /** overlays.tsx: the active-cell focus-ring overlay. */
  activeCellOverlay: "data-grid-active-cell-overlay",

  /** data-grid-fill/fill-overlay.tsx: the dashed fill-drag preview rect. */
  fillPreview: "data-grid-fill-preview",
  /** data-grid-fill/fill-overlay.tsx: the draggable fill-handle square at a range's corner. */
  fillHandle: "data-grid-fill-handle",
  /** data-grid-presence/presence-overlay.tsx: one remote user's highlight-range overlay. */
  presenceOverlay: "data-grid-presence-overlay",
  /** data-grid-presence/presence-overlay.tsx: a remote user's name-chip label. */
  presenceLabel: "data-grid-presence-label",
  /** data-grid-pinned-rows/pinned-row-band.tsx: `"top" | "bottom"`, a pinned-row sticky band. */
  pinnedRowBand: "data-grid-pinned-row-band",
  /** data-grid-pinned-rows/pinned-row.tsx: a pinned row's position within its own band (number, 0-based). */
  pinnedRowIndex: "data-grid-pinned-row-index",
  /** data-grid-context-menu/context-menu.tsx: the cell/header context-menu popup content. */
  contextMenu: "data-grid-context-menu",
  /** data-grid-context-menu/header-dropdown.tsx: the column header's dropdown menu content. */
  headerDropdown: "data-grid-header-dropdown",
  /** data-grid-context-menu/header-dropdown.tsx: marks a portal as the header menu popup, so header-cell.tsx's own pointer handlers can ignore events that originate inside it. */
  headerMenuPopup: "data-grid-header-menu-popup",
  /** data-grid-sort-list/sort-list.tsx: the active-sort-count badge on the sort trigger button. */
  sortCount: "data-grid-sort-count",
  /** data-grid-sort-list/sort-list.tsx: the sort-list popup container. */
  sortList: "data-grid-sort-list",
  /** data-grid-sort-list/sort-list.tsx: one reorderable row within the sort list. */
  sortRow: "data-grid-sort-row",
  /** data-grid-toolbar/toolbar.tsx: the toolbar container; also used by `data-grid-toolbar/search.tsx` to test whether an event target sits inside the grid's own scope. */
  toolbar: "data-grid-toolbar",
  /** data-grid-toolbar/columns-menu.tsx: the show/hide-columns dropdown menu content. */
  columnsMenu: "data-grid-columns-menu",
  /** data-grid-toolbar/filter-menu.tsx: the active-filter-count badge on the filter trigger button. */
  filterCount: "data-grid-filter-count",
  /** data-grid-toolbar/filter-menu.tsx: the filter-list popup container. */
  filterMenu: "data-grid-filter-menu",
  /** data-grid-toolbar/filter-menu.tsx: one reorderable row within the filter list. */
  filterRow: "data-grid-filter-row",
  /** data-grid-toolbar/search.tsx: the quick-search input's container. */
  search: "data-grid-search",
  /** data-grid-toolbar/search.tsx: the search match-count badge ("3/17"). */
  searchCount: "data-grid-search-count",
  /** data-grid-pagination/pagination-footer.tsx: the pagination footer bar container. */
  pagination: "data-grid-pagination",
} as const;

/** A key of {@link GRID_ATTR}. */
export type GridAttrName = keyof typeof GRID_ATTR;

/** The attribute string for a given {@link GRID_ATTR} key. */
export type GridAttr = (typeof GRID_ATTR)[GridAttrName];

/**
 * Per-attribute value unions, for the attributes that carry one. Includes the boolean-flag
 * attributes (`isX || undefined` at the SET site): React stringifies a `true` JSX value on a
 * custom `data-*` attribute to the literal DOM string `"true"` (never a bare boolean attribute),
 * which is what `toHaveAttribute(attr, "true")` in tests is actually asserting against.
 */
export type GridAttrValue = {
  [GRID_ATTR.pinned]: "left" | "right" | "";
  [GRID_ATTR.pinShadow]: "left" | "right" | "top" | "bottom";
  [GRID_ATTR.pinnedRowBand]: "top" | "bottom";
  [GRID_ATTR.sortIndicator]: "asc" | "desc";
  [GRID_ATTR.active]: "true";
  [GRID_ATTR.editing]: "true";
  [GRID_ATTR.selected]: "true";
  [GRID_ATTR.resizing]: "true";
  [GRID_ATTR.searchMatch]: "true";
  [GRID_ATTR.pinnedRow]: "true";
};

/** Builds a `[data-grid-marker-cell]` / `[data-grid-pin-shadow="left"]` CSS-attribute-selector string for `querySelector`/`closest`. */
export function gridAttrSelector<TName extends GridAttrName>(
  name: TName,
  value?: (typeof GRID_ATTR)[TName] extends keyof GridAttrValue ? GridAttrValue[(typeof GRID_ATTR)[TName]] : never,
): string {
  const attr = GRID_ATTR[name];
  return value === undefined ? `[${attr}]` : `[${attr}="${value}"]`;
}
