import type { ReactNode } from "react";
import type {
  CellCoord,
  CellType,
  ColumnDef,
  ColumnLayout,
  DataChange,
  FilterJoinOperator,
  FilterSpec,
  GridSelection,
  HeaderClickBehavior,
  Keymap,
  RowMarkersMode,
  SortSpec,
} from "../types";
import type { OverlayPlugin } from "../overlays";
import type { RowBandsSpec } from "../layout-context";
import type { DataGridLabels, DeepPartialLabels } from "../labels";
import type { SearchMatch } from "../sort-filter";
import type { ExtendDirection, SelectLineOptions } from "../selection";
import type { ColRange } from "../selection/selected-col-ranges-for-row";

/** Live props synced from the consumer's render into the store on every change, typed over the consumer's row shape. */
export type DataGridSyncProps<TData = unknown> = {
  /**
   * Controlled row array (React `value` semantics): the app owns it, and every mutation
   * (edit/paste/fill/delete/row-ops) only ever reaches it through `onDataChange` — the grid's own
   * display doesn't change until the next render supplies a new `data`. Mutually exclusive with
   * `defaultData`; when both are given, `data` wins (dev-mode warns once). Omit `data` and pass
   * `defaultData` instead for the uncontrolled mode.
   */
  data?: readonly TData[];
  /**
   * Uncontrolled row array (React `defaultValue` semantics): seeds the store ONCE at creation and
   * the store then OWNS it — every mutation applies internally with no app-side state required;
   * `onDataChange` still fires as an optional notification. Changing this prop on a later render is
   * ignored (uncontrolled, matching `<input defaultValue>`). Mutually exclusive with `data` — see
   * that prop's doc for precedence.
   */
  defaultData?: readonly TData[];
  // ColumnDef's 3rd param (TValidate) erases to `any`, not `unknown` — see AnyColumnDef's doc in
  // this file: `validate`'s function-or-schema union can't stay bivariant as a plain property, so
  // a defineColumns literal's narrow-TValue `validate` needs this documented widening to fit here.
  columns: readonly ColumnDefOf<TData>[];
  getRowId: (row: TData, index: number) => string;
  /** Fired once per user gesture with the next data array and an id-keyed delta batch. */
  onDataChange?: (next: readonly TData[], change: DataChange<TData>) => void;
  /**
   * Row-level cross-field validation, run once per touched row after a write gesture commits
   * (edit, paste, fill, delete-contents, updateCells/updateRows) — the row already has ALL of the
   * gesture's cells applied, so the verdict is independent of column order inside a paste. Return
   * `columnId -> message` to surface errors (they land in `cellErrors`, same display as server
   * errors), `null` when the row is fine. Values still commit either way. Not run on row
   * insert/duplicate/delete or on consumer `data` replacement. Sync only.
   */
  validateRow?: (row: TData, rowId: string) => Record<string, string> | null;
  /** Undo keymap action (mod+Z); the `data-grid-history` add-on plugs its `undo()` in here. */
  onUndo?: () => void;
  /** Redo keymap action (mod+Y / mod+shift+Z); the `data-grid-history` add-on plugs its `redo()` in here. */
  onRedo?: () => void;
  /**
   * Cell-type registry keyed by `ColumnDef.type`; defaults to the built-in registry. Providing a
   * registry REPLACES the built-ins, it is not merged over them: to extend the built-ins, spread
   * the exported `cellTypes` in (`cellTypes={{ ...cellTypes, myType }}`).
   */
  cellTypes?: Record<string, AnyCellType>;
  /** Overrides a cell's clipboard-copy text; falls back to the cell type's `toText`. */
  processCellForClipboard?: (value: unknown, ctx: ClipboardProcessCtx<TData>) => string;
  /** Overrides parsing pasted text into a cell value; falls back to the cell type's `fromText`. */
  processCellFromClipboard?: (text: string, ctx: ClipboardProcessCtx<TData>) => unknown;
  /** Runs on the parsed paste grid before it's applied; returning `false` vetoes the paste entirely. */
  processPaste?: (cells: string[][], target: CellCoord) => string[][] | false;
  /** Marker column mode; default 'none'. See {@link RowMarkersMode}. */
  rowMarkers?: RowMarkersMode;
  /** Whole-row selection channel gestures (marker click, Shift+Space); default true. */
  enableRowSelection?: boolean;
  /** Whole-column selection channel gestures (header click); default true. */
  enableColumnSelection?: boolean;
  /** Multi-cell rectangular range gestures (shift-click/drag, shift+arrow); false collapses to single-cell active only. Default true. */
  enableRangeSelection?: boolean;
  /** Ctrl/Cmd-click multi-range (rangeStack); false makes it behave as a plain click. Default true. */
  enableMultiRange?: boolean;
  /** Enables the header resize handle grid-wide; default true. Per-column `resizable: false` still wins. */
  enableColumnResize?: boolean;
  /** Enables drag-to-reorder columns grid-wide; default true. Per-column `reorderable: false` still wins. */
  enableColumnReorder?: boolean;
  /**
   * Enables drag-to-reorder rows grid-wide; default true. The gesture lives on the row marker
   * (every mode except `'none'`), with the same disambiguation as column reorder: a plain drag
   * that leaves the origin row reorders, Shift+drag always stays the row-select gesture.
   */
  enableRowReorder?: boolean;
  /** Enables pin/unpin actions grid-wide; default true. Per-column `pinnable: false` still wins. */
  enableColumnPinning?: boolean;
  /** How a plain header click behaves; default 'select'. See {@link HeaderClickBehavior}. */
  headerClickBehavior?: HeaderClickBehavior;
  /** Partial i18n override, deep-merged over {@link DEFAULT_LABELS}; see {@link useDataGridLabels}. */
  labels?: DeepPartialLabels;
  /** Builds a new row for `insertRow`; absent makes `insertRow` a dev-warning no-op (duplicateRows/deleteRows don't need it). */
  createRow?: (index: number) => TData;
  /**
   * Builds a duplicated row's identity for `duplicateRows`: given the
   * source row and its new data index, returns the row to insert (with a distinct id, e.g. a fresh
   * UUID, so the copy's `getRowId()` never collides with its source's React key). Absent makes
   * `duplicateRows` a dev-warning no-op — mirrors `createRow`/`insertRow`.
   */
  duplicateRow?: (row: TData, index: number) => TData;
  /**
   * Controlled multi-sort spec. Standard controlled-input
   * semantics: omitted (undefined) keeps today's uncontrolled behavior — the store owns
   * `sortState`. Provided (even `[]`) makes this prop the source of truth every `_syncProps` sync
   * writes into the store; `onSortChange` still fires on every user-driven change (header click,
   * `setSorts`) either way, but in controlled mode the displayed order only moves once the prop
   * itself changes — a controlled grid whose consumer ignores the callback stays visually fixed.
   */
  sortState?: SortSpec[];
  /** Fires whenever the user (or `actions.toggleSort`/`setSorts`) would change the sort, controlled or not; see `sortState`. */
  onSortChange?: (next: SortSpec[]) => void;
  /** Controlled filter spec; same controlled/uncontrolled semantics as `sortState`. */
  filterState?: FilterSpec[];
  /** Fires whenever the user (or `actions.setFilters`) would change the filters, controlled or not; see `filterState`. */
  onFilterChange?: (next: FilterSpec[]) => void;
  /** Controlled join operator combining `filterState`'s rows; same controlled/uncontrolled semantics as `sortState`. Default `"and"`. */
  joinOperator?: FilterJoinOperator;
  /** Fires whenever the user (or `actions.setJoinOperator`) would change the join operator, controlled or not; see `joinOperator`. */
  onJoinOperatorChange?: (next: FilterJoinOperator) => void;
  /** Controlled quick-search text; same controlled/uncontrolled semantics as `sortState`. */
  searchText?: string;
  /** Fires whenever the user (or `actions.setSearch`) would change the search text, controlled or not; see `searchText`. */
  onSearchTextChange?: (next: string) => void;
  /**
   * Overlay-plugin registration: each plugin renders into the overlay layer
   * after the fill preview but before the local active-cell ring, receiving `OverlayPluginCtx`
   * (window-clamp + pin-zone helpers, layout vars). The `data-grid-presence` add-on is the
   * motivating consumer. Pass a stable array reference (e.g. module scope or `useMemo`) — same
   * dev-mode guardrail as `columns`/`getRowClassName`: an unstable identity here re-renders
   * `DataGridOverlays` every tick for nothing.
   */
  overlayPlugins?: readonly OverlayPlugin[];
  /**
   * Row-bands registration: a spec object so root.tsx can compute band heights/`aria-rowcount`
   * SYNCHRONOUSLY at first render (no SSR/first-paint layout shift) while the actual pinned-row
   * semantics live in the `data-grid-pinned-rows` add-on's `useDataGridPinnedRows()`. Same
   * dev-mode identity guardrail as `overlayPlugins` — pass a stable reference (the hook already
   * returns one).
   */
  rowBands?: RowBandsSpec;
  /**
   * Seeds `columnWidths`/`columnOrder`/`hiddenColumns`/per-column `pin` ONCE at store creation,
   * over the `columns` prop's own def defaults (`resolveColumnWidth` precedence: layout beats def).
   * Deliberately NOT a controlled prop — later changes to this value are ignored (uncontrolled-
   * with-events, PLAN events-state gap fix 1); pair it with `onColumnLayoutChange` to save/restore
   * a user's layout (e.g. to localStorage) without a fully-controlled overlay fighting the defs.
   */
  defaultColumnLayout?: ColumnLayout;
  /**
   * Fires once per committed column-layout change (resize drag release/autosize, reorder drop,
   * pin/unpin, show/hide) with the full current `ColumnLayout` snapshot — never per drag frame.
   * Fired from the store actions layer, no React-render dependency. See `defaultColumnLayout` for
   * the matching restore path.
   */
  onColumnLayoutChange?: (next: ColumnLayout) => void;
  /**
   * Fires on every committed selection change (click, extend step, range push, row/column/all
   * selection, clear) with the current `GridSelection` plus a lazy `details.getValues()` accessor.
   * A drag-extend gesture fires once per step (intended — the presence/broadcast use case wants
   * live updates, not just the final drop) — `getValues()` is a function, not a materialized array,
   * specifically so that hot path never pays for building a value matrix on steps nobody reads.
   */
  onSelectionChange?: (next: GridSelection, details: SelectionChangeDetails) => void;
  /**
   * Fired exactly once when the selection transitions from non-empty to empty, from ANY path
   * (outside-click, clearSelection, a cleared range, etc.). `onSelectionChange` also fires on that
   * transition (with an empty selection) — this is the dedicated signal for UI resets. Does not
   * fire when the selection is already empty.
   */
  onSelectionCleared?: () => void;
  /**
   * Fires on every live width write during a resize drag (`actions.setColumnWidth`, per drag
   * frame) — the in-progress counterpart to `onColumnLayoutChange`'s once-per-commit snapshot.
   * Fired from the store actions layer, no React-render dependency. Not called for the commit
   * itself (drag release/autosize) — pair with `onColumnLayoutChange` if you need that too.
   */
  onColumnResizing?: (columnId: string, width: number) => void;
};

/**
 * Second argument to `onSelectionChange` (PLAN events-state gap fix 2). `getValues()` reads the
 * CURRENT `selection.current.range` only — a multi-range selection (ctrl-click stack) is not
 * flattened or concatenated, matching clipboard copy's own "primary range only" scope
 * (`resolveCopyScope`) — call it once per range in `selection.current.rangeStack` yourself if you
 * need the others. Returns `[]` when there's no active range (row/column-channel-only selection,
 * or a clear). Deliberately lazy: built fresh from the store snapshot only when called, so a
 * consumer that ignores it (the common case) never pays for reading/allocating a value matrix on
 * every drag step.
 */
export type SelectionChangeDetails = {
  /** Raw cell VALUES (not clipboard text) over the primary range, view-row-major: `values[0][0]` is the range's top-left cell. */
  getValues: () => unknown[][];
  /** Row ids of every selected row, view order, across both the row channel (checkboxes) and any cell range. */
  getRowIds: () => string[];
};

// The store is generic-erased to TData = unknown past this boundary (InternalSyncProps below): one
// runtime engine serves every consumer's row type, and unknown (not never) keeps every ColumnDef
// function field (accessorFn/setValue/readOnly/validate) callable with the store's own `row: unknown`
// values with no cast needed — safe because a column and the row it's called with always came from
// the same consumer-typed `data` array passed in through DataGridSyncProps<TData>. This is also what
// useDataGridVisibleColumns/useDataGridAllColumns return, so a consumer building custom column UI can
// call those same fields without a cast either.
/** `DataGridSyncProps` cast to the store's internal row-agnostic shape; the one unsafe cast, applied once at the boundary. */
export type InternalSyncProps = DataGridSyncProps<unknown>;

/**
 * `ColumnDef` widened to the store's internal row-agnostic shape (see the erasure comment above).
 * `validate`'s own value type erases to `any` (the third param, not `unknown`) — a union of a
 * function and a non-callable Standard Schema can't stay bivariant as a plain property the way a
 * pure method-shorthand function could, so narrow-`TValue` columns need this one documented,
 * single-field cast to widen into this shared type (see types.ts's `ColumnDef.validate` doc).
 */
export type AnyColumnDef = ColumnDef<unknown, unknown, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * `ColumnDef<TData, unknown, any>` — the same TValidate-erased-to-`any` widening as `AnyColumnDef`
 * (see its doc comment), but keeping `TData` open for call sites that are still generic over the
 * consumer's row type (sync-prop declarations, the public `useDataGridVisibleColumns`/`useDataGridAllColumns`
 * hooks) rather than already erased to `unknown`. Named once here (was 10 verbatim repeats across
 * store.tsx/data-grid.tsx, each with its own eslint-disable) so the widening reason lives in one place.
 */
export type ColumnDefOf<TData> = ColumnDef<TData, unknown, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** `processCellForClipboard`/`processCellFromClipboard`'s callback context — named since it repeats identically across both callbacks in both `DataGridSyncProps` and `DataGridProps`. */
export type ClipboardProcessCtx<TData> = { row: TData; column: ColumnDefOf<TData> };

/**
 * `CellType<any, any, any>` — the `cellTypes` registry-prop widening (same single-point `any`
 * erasure as {@link AnyColumnDef}): `Cell`/`Editor` are `FC<...>` (strictly contravariant in their
 * props), so without erasing TData/TValue/TOptions neither the built-ins (concrete TValue) nor a
 * consumer's per-column `CellType<TData, TValue, TOptions>` is cast-free assignable to an
 * erased-to-`unknown` entry type — the registry prop is the one place a spread of the exported
 * `cellTypes` plus a custom type must compile with no cast.
 */
export type AnyCellType = CellType<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function toInternalSyncProps<TData>(props: DataGridSyncProps<TData>): InternalSyncProps {
  return props as unknown as InternalSyncProps;
}

/** Options passed to selectRow/selectColumn actions; mirrors lib/selection's SelectLineOptions. */
export type SelectLineActionOptions = Omit<SelectLineOptions, "from">;

/**
 * One targeted cell write for {@link DataGridActions.updateCells}, addressed by STABLE ROW ID —
 * never a view or data index. A streaming producer cannot know view coordinates under an active
 * sort, and row ids are already what {@link DataOp} uses, so history survives sort/filter.
 */
export type CellPatch = {
  /** The row's `getRowId()` value. An id not present in `data` is skipped. */
  rowId: string;
  /** Any column id, including a hidden one. An unknown id is skipped. */
  columnId: string;
  value: unknown;
};

/** One whole-row update for {@link DataGridActions.updateRows}: a partial row shallow-merged per column id. */
export type RowPatch = {
  rowId: string;
  /** Column id -> new value. Each entry is applied exactly as the matching {@link CellPatch} would be. */
  changes: Readonly<Record<string, unknown>>;
};

/** How a `updateCells`/`updateRows` batch reconciles with an active sort or filter. */
export type UpdateCellsReorder = "defer" | "immediate" | "never";

/** One rowId+columnId target, addressed the same STABLE-ROW-ID way as {@link CellPatch} (no `value` — used only to name a cell for {@link DataGridActions.setCellErrors}/{@link DataGridActions.clearCellErrors}). */
export type CellErrorTarget = {
  /** The row's `getRowId()` value. An id not present in `data` is stored/cleared anyway (see `cellErrors`' doc) and simply never renders. */
  rowId: string;
  columnId: string;
};

/** One entry for {@link DataGridActions.setCellErrors}: the target cell plus its rejection message. */
export type CellErrorEntry = CellErrorTarget & { message: string };

/** Options for {@link DataGridActions.updateCells} and {@link DataGridActions.updateRows}. */
export type UpdateCellsOptions = {
  /**
   * Default `"defer"`.
   * - `"defer"` — values update in place and rows keep their view position; `viewStale` flips.
   *   The view reconciles on the next sort/filter/search change, or on `reconcileView()`. A
   *   `"defer"` batch that touches no active sort or filter column downgrades to `"never"`
   *   automatically, so `viewStale` never flips for a ticker on a non-sort column.
   * - `"immediate"` — moves the patched rows to their new positions now, by removing each one,
   *   re-testing filter membership, and binary-searching it back in under the same comparator chain
   *   a full sort uses. Cost scales with the batch size, not the row count: measured 0.3 / 0.9 /
   *   7.6 ms for 1 / 20 / 256 patched rows at 100k. Batches over
   *   {@link INCREMENTAL_PATCH_LIMIT} rows, a same-tick sort/filter change, or a column with its own
   *   comparator fall back to the full O(n log n) rebuild.
   * - `"never"` — updates in place and never marks the view stale. The caller asserts that no
   *   touched column feeds the sort or filter.
   */
  reorder?: UpdateCellsReorder;
  /** `DataChange` source tag; default `"stream"`. Pass `"edit"` to make the batch undoable. */
  source?: DataChange<unknown>["source"];
  /** Skips each column's `validate`. Default `false`. */
  skipValidation?: boolean;
};

/** Full per-grid interaction + derived state; internally typed over `unknown` rows. */
export type DataGridStoreState = Omit<
  InternalSyncProps,
  | "data"
  | "defaultData"
  | "cellTypes"
  | "rowMarkers"
  | "enableRowSelection"
  | "enableColumnSelection"
  | "enableRangeSelection"
  | "enableMultiRange"
  | "enableColumnResize"
  | "enableColumnReorder"
  | "enableRowReorder"
  | "enableColumnPinning"
  | "headerClickBehavior"
  | "labels"
  | "overlayPlugins"
  | "rowBands"
  | "defaultColumnLayout"
> & {
  /** Always defined: controlled mode mirrors the `data` prop every sync; uncontrolled mode seeds from `defaultData` once and the store owns it thereafter (mutated in place by the commit actions). */
  data: readonly unknown[];
  /** Whether `data` is controlled (the `data` prop was defined on the last `_syncProps`/init) — see `data`'s doc comment and `defaultData`. Mirrors the `sortControlled`-style pattern below. */
  dataControlled: boolean;
  /** Row-agnostic view of the cell-type registry; the `never`-typed sync prop is widened once at the store boundary. */
  cellTypes: Record<string, CellType>;
  /** Defaulted (never undefined) — see `resolveSelectionConfig`. */
  rowMarkers: RowMarkersMode;
  enableRowSelection: boolean;
  enableColumnSelection: boolean;
  enableRangeSelection: boolean;
  enableMultiRange: boolean;
  enableColumnResize: boolean;
  enableColumnReorder: boolean;
  enableRowReorder: boolean;
  enableColumnPinning: boolean;
  headerClickBehavior: HeaderClickBehavior;
  activeCell: CellCoord | null;
  selection: GridSelection;
  /**
   * Two-stage Ctrl+A progression (select-all-progression.ts): which stage the last `selectAll`
   * produced, plus the exact `selection`/`activeCell` object identities it produced them against.
   * Any other action that replaces `selection` or `activeCell` (selectCell/extendTo/pushRange/
   * selectRow/selectColumn/_moveActiveCell/edits/row ops) changes that identity, so `selectAll`
   * detects the mismatch and restarts from stage 1 — no need to instrument every reset site.
   */
  selectAllStage: { stage: "region" | "all"; selection: GridSelection; activeCell: CellCoord | null } | null;
  editing: { coord: CellCoord; initialText?: string } | null;
  /** Transient rejection message from the last failed commitCellEdit; cleared on the next startEditing/commit/cancel. */
  editingError: string | null;
  /**
   * Rejection nonce for the current edit session: increments on every rejected commit attempt
   * (the sync `validate` rejection in `commitCellEdit`, or an async schema resolving with issues
   * via `setEditingError`) and resets to 0 on `startEditing`. Editors re-arm their one-shot commit
   * guard when this changes: a REJECTION is the only signal that the edit is still open and a
   * fresh commit attempt is expected, never "pending cleared", which also happens on
   * Escape/cancel right before the editor unmounts. The store is the single source of truth for
   * both rejection paths.
   */
  editingRejectionCount: number;
  /**
   * Post-commit server-rejection messages, keyed `"rowId:columnId"` — set via
   * `actions.setCellErrors` after an async `onDataChange` round-trip rejects (e.g. a 422), painted
   * with the SAME visual language as a sync `validate` rejection (ring/tint + message,
   * `aria-invalid`). Deliberately NOT part of the edit lifecycle: `setCellErrors`/`clearCellErrors`
   * never touch `data`, never emit a `DataChange`/`onDataChange`, and are excluded from history —
   * this is metadata ABOUT a cell, not a data change. Auto-cleared for a cell the instant ANY write
   * path (`commitCellEdit`, `commitCellValue`, `applyCellUpdates`, `updateCells`, `deleteSelection`)
   * successfully commits a new value there — the user fixed it, so the stale error must not linger;
   * the server can always re-set it if the fix is still wrong. Pruned of any rowId no longer present
   * in `data` on every row-shape change (delete/duplicate/insert/a consumer `data` replacement) —
   * same maintenance discipline as `RowIndexCache`. Always {@link EMPTY_CELL_ERRORS} when empty, so
   * `useDataGridCellErrors`-style reads never allocate on the common no-error path.
   */
  cellErrors: ReadonlyMap<string, string>;
  /** Always defined: defaults to {@link EMPTY_OVERLAY_PLUGINS} so `useDataGridOverlayPlugins` never returns undefined. See `overlayPlugins`'s doc comment (DataGridSyncProps). */
  overlayPlugins: readonly OverlayPlugin[];
  /** Always defined: defaults to {@link EMPTY_ROW_BANDS} (zero-length top/bottom, `render` never called) so `useDataGridRowBands` never returns undefined. See `rowBands`'s doc comment (DataGridSyncProps). */
  rowBands: RowBandsSpec;
  lastHighlightedRow: number | null;
  lastHighlightedCol: number | null;
  columnWidths: Record<string, number>;
  /** null = follow the `columns` prop order. */
  columnOrder: string[] | null;
  hiddenColumns: readonly string[];
  sortState: SortSpec[];
  filterState: FilterSpec[];
  /** How `filterState`'s rows combine; default `"and"`. See `FilterJoinOperator`. */
  joinOperator: FilterJoinOperator;
  /** Quick-search text; never affects `viewIndex` (search highlights + navigates, it doesn't filter). */
  searchText: string;
  /**
   * Whether `sortState`/`filterState`/`joinOperator`/`searchText` are controlled (their sync prop
   * was defined on the last `_syncProps`), set once per sync and read by `toggleSort`/`setSorts`/
   * `setFilters`/`setJoinOperator`/`setSearch` (server escape hatch). Controlled mode:
   * the action still fires its `onXChange` callback but does NOT write the corresponding state
   * field itself — `_syncProps` is the only writer once the consumer's prop (and thus the store)
   * actually changes, standard controlled-input semantics (a callback-ignoring consumer's grid
   * stays visually fixed).
   */
  sortControlled: boolean;
  filterControlled: boolean;
  joinOperatorControlled: boolean;
  searchControlled: boolean;
  /** Every cell matching `searchText`, view-space row-major order; computed once per `setSearch`/`_syncProps`/`setSorts`/`setFilters`, capped at 1000 hits with early exit. */
  searchMatches: SearchMatch[];
  /** `searchMatches` as a `"${viewRow}:${columnId}"` Set for O(1) per-cell highlight lookup ({@link useDataGridIsSearchMatch}). */
  searchMatchSet: ReadonlySet<string>;
  /**
   * `searchMatches` grouped by view row -> matched column indices, for {@link computeRowCellState}'s
   * per-row derivation (perf audit 2026-07-17: the previous per-row `for` loop over every visible
   * column, each doing a `searchMatchSet.has(`${row}:${columnId}`)` string-key lookup, cost ~44ms/2000
   * ticks at 100k rows/8 cols with an active search — measured 29x faster building this map once per
   * search-text change and doing an O(1) `Map.get` per row per tick instead).
   */
  searchMatchRows: ReadonlyMap<number, ReadonlySet<number>>;
  /** True when `searchMatches` hit the 1000-match cap (more matches exist but weren't collected). */
  searchMatchesCapped: boolean;
  /** Recomputed by _syncProps/toggleSort/setSorts/setFilters only — search no longer affects it. */
  viewIndex: number[];
  /**
   * True when at least one deferred `updateCells`/`updateRows` batch changed a value that the active
   * sort or filter reads, so the displayed order no longer matches the data. Drives a "re-sort"
   * affordance; `reconcileView()` (or any sort/filter/search change) clears it. See
   * {@link useDataGridViewStale}.
   */
  viewStale: boolean;
  /** Recomputed by _syncProps/setColumnOrder-ish actions that touch order/visibility. */
  visibleColumns: readonly AnyColumnDef[];
  /**
   * Imperative scroll-into-view, registered by the mounted `DataGridRoot` (null before mount/after
   * unmount). Lets add-ons outside the root's subtree (e.g. `data-grid-toolbar`'s search, which sits
   * as a `DataGridRoot` sibling) move the viewport without reaching into
   * root-internal refs. See {@link useDataGridScrollToCell}.
   */
  scrollToCellImpl: ((coord: CellCoord) => void) | null;
  /**
   * Fill-handle keymap handlers, registered by the `data-grid-fill` add-on's tracker
   * component — which must render somewhere inside `DataGridRoot`'s subtree to reach `scrollRef`/
   * layout via `useDataGridRootContext()`, a level `DataGridRoot`'s OWN `useGridInteraction` call
   * (which needs these three callbacks) sits above. Registering through the store the same way
   * `scrollToCellImpl` does resolves that ordering: `DataGridRoot` reads this slot and forwards it
   * to `useGridInteraction` on every render; `null` (pre-mount, post-unmount, or add-on absent)
   * makes mod+D/mod+R/Escape-mid-drag the documented no-ops.
   */
  fillHandlers: { fillDown: () => void; fillRight: () => void; cancelFillDrag: () => void } | null;
  /**
   * Mirrors `DataGridRoot`'s `readOnly` prop, registered on mount, so
   * mutation surfaces outside the root's subtree (context menu, `useDataGridClipboard`) can see it
   * too — the root prop alone only reached its own local `useGridInteraction`/`useGridClipboard`.
   * `false` before mount/after unmount.
   */
  readOnly: boolean;
  /**
   * Mirrors `DataGridRoot`'s effective keymap — `DEFAULT_KEYMAP` merged with its `keymap` prop —
   * registered on mount (backing the `data-grid-keybindings` add-on) so surfaces outside
   * the root's subtree (e.g. the keybindings dialog) can read the single source of truth for
   * bindings instead of re-deriving it. `DEFAULT_KEYMAP` before mount/after unmount.
   */
  keymap: Keymap;
  /** {@link DEFAULT_LABELS} deep-merged with the `labels` sync prop; see {@link useDataGridLabels}. */
  labels: DataGridLabels;
  actions: DataGridActions;
};

/** Mutations for a single grid instance, nested under the stable `actions` key. */
export type DataGridActions = {
  /**
   * Moves ONLY the active cell, leaving the selection (range, row and column channels) untouched,
   * and fires NO `onSelectionChange` (contrast `selectCell`, which sets a single-cell selection
   * and fires it). After Escape/`clearSelection`, `selection.current` is `null` while `activeCell`
   * still exists — read the active cell from `activeCell`, not from `selection.current.cell`.
   */
  setActiveCell(coord: CellCoord | null): void;
  selectCell(coord: CellCoord): void;
  extendTo(coord: CellCoord): void;
  extendSelection(direction: ExtendDirection, opts?: { toEdge?: boolean }): void;
  pushRange(coord: CellCoord): void;
  selectRow(index: number, opts?: SelectLineActionOptions): void;
  selectColumn(index: number, opts?: SelectLineActionOptions): void;
  selectAll(): void;
  /** Checkbox marker: sets one row's membership in the rows channel absolutely (add if `checked`, remove otherwise) — never a toggle — independent of the last-highlighted/range mechanics `selectRow` uses for click gestures. No-op when `enableRowSelection` is false. */
  setRowSelected(index: number, checked: boolean): void;
  /** Sets the row-drag anchor without touching the rows/columns selection channel — lets a checkbox-marker press arm a potential row-range drag while leaving a stationary click's own toggle untouched. No-op when `enableRowSelection` is false. */
  armRowDragAnchor(index: number): void;
  /** Header marker select-all checkbox: sets every view row's membership in the rows channel at once. No-op when `enableRowSelection` is false. */
  setAllRowsSelected(checked: boolean): void;
  clearSelection(): void;
  /** Live per-frame width write during a resize drag; fires `onColumnResizing` (not `onColumnLayoutChange` — see `commitColumnWidth` for the commit point). */
  setColumnWidth(id: string, width: number): void;
  /** Sets the column's width AND fires `onColumnLayoutChange` once — the resize-drag-release/autosize commit point. */
  commitColumnWidth(id: string, width: number): void;
  /**
   * Reorders visible columns. `id` moves to sit immediately before/after `targetId` (per `position`).
   * Pinned columns only reorder within their own pin zone (left/right/unpinned) — a cross-zone
   * request is a no-op recompute (dropping a left-pinned column onto the unpinned band does nothing).
   * No-op when the column's own `reorderable: false` or the grid-wide `enableColumnReorder` is false.
   * Fires `onColumnLayoutChange` once on an actual move.
   */
  setColumnOrder(id: string, targetId: string, position: "before" | "after"): void;
  /** Pins/unpins a column (`null` = unpinned). No-op when the column's `pinnable: false` or grid-wide `enableColumnPinning` is false. Fires `onColumnLayoutChange` once. */
  setColumnPin(id: string, pin: "left" | "right" | null): void;
  /** Shows/hides a column via the `hiddenColumns` set. Fires `onColumnLayoutChange` once. */
  setColumnHidden(id: string, hidden: boolean): void;
  toggleSort(columnId: string, additive: boolean): void;
  setSorts(sorts: SortSpec[]): void;
  setFilters(filters: FilterSpec[]): void;
  /** Sets how `filterState`'s rows combine ("and" every filter must match, "or" any one does). */
  setJoinOperator(joinOperator: FilterJoinOperator): void;
  /** Sets quick-search text and recomputes `searchMatches`/`searchMatchSet`/`searchMatchesCapped` once; never touches `viewIndex`. */
  setSearch(text: string): void;
  /** Enters edit mode at `coord` (view-space); no-op when the column is readOnly or its type is unregistered. */
  startEditing(coord: CellCoord, initialText?: string): void;
  /** Discards the in-progress edit without emitting a change. */
  cancelEditing(): void;
  /**
   * Validates and commits the in-progress edit; rejects (keeps editing, sets editingError) or emits
   * one DataChange and moves activeCell by `movement`. `rejection` is the async validation layer's
   * awaited schema rejection for an `onInvalid: "warn"` column: the commit's sync re-run cannot see
   * a schema Promise's issues, so the layer forwards the message to flag the cell.
   */
  commitCellEdit(value: unknown, movement?: { dx: number; dy: number }, rejection?: string): void;
  /** Direct-write path for types with no edit mode (checkbox): validates and commits `value` at `coord` without requiring `startEditing` first, and never moves the active cell. */
  commitCellValue(coord: CellCoord, value: unknown): void;
  /**
   * Sets `editingError` and bumps `editingRejectionCount` (the editors' commit-guard re-arm
   * nonce) without touching `editing`/`data` — used by the async Standard Schema commit path (see
   * cell.tsx/use-async-validate.ts): an async `validate` resolves AFTER `commitCellEdit` would
   * have run, so the editor-commit layer calls this directly instead of going through the
   * (synchronous) commit action. No-op if editing has since ended (race guard is the caller's
   * job — see the generation counter in use-async-validate.ts).
   */
  setEditingError(message: string): void;
  /**
   * Merges `errors` into `cellErrors` per-key (an existing entry for a cell not named here
   * survives untouched). NOT a data change: no `DataChange`, no history entry, no `onDataChange`
   * echo — see `cellErrors`' doc comment. The typical caller is an `onDataChange` handler's
   * `.catch()` after a server 422, mapping its field errors to `{ rowId, columnId, message }[]`.
   */
  setCellErrors(errors: readonly CellErrorEntry[]): void;
  /** Clears `cellErrors` for `targets`, or every entry when `targets` is omitted. Same non-data-change contract as `setCellErrors`. */
  clearCellErrors(targets?: readonly CellErrorTarget[]): void;
  /** Clears every non-readOnly cell in the current selection to its type's clearValue(), as one batch DataChange. */
  deleteSelection(): void;
  /**
   * The one generic multi-cell write path: applies `updates` (view-space coords via `viewRow`) as
   * a single `source`-tagged DataChange batch. Dedupes multiple updates to the same row/column
   * (last write wins), skips readOnly cells and no-op writes, preserves identity of untouched rows,
   * suppresses an empty batch entirely, and moves the selection to cover the touched view rect.
   */
  applyCellUpdates(updates: { viewRow: number; columnId: string; value: unknown }[], source: DataChange<unknown>["source"]): void;
  /**
   * The streaming write path: applies id-keyed {@link CellPatch}es in ONE `set()` and skips the
   * `computeViewIndex`/`computeSearchMatches` rebuild that a `data` prop replacement forces. This is
   * what makes streaming under an active sort viable — a controlled `data` replacement costs ~56 ms
   * per tick at 100k rows with one sort column, against ~0.15 ms here.
   *
   * Unlike `applyCellUpdates` it never moves the selection, the active cell, or the editing session,
   * so a live feed cannot pull the grid out from under a user mid-edit. Emits one batched
   * `{source: "stream"}` `DataChange` through `onDataChange`, in both controlled and uncontrolled
   * mode. See {@link UpdateCellsOptions} for the sort/filter interaction.
   */
  updateCells(patches: readonly CellPatch[], options?: UpdateCellsOptions): void;
  /** {@link updateCells} keyed by whole row: each {@link RowPatch}'s `changes` expands to one patch per column id. */
  updateRows(updates: readonly RowPatch[], options?: UpdateCellsOptions): void;
  /** Rebuilds the view index that a deferred `updateCells` postponed, and clears `viewStale`. No-op when the view is not stale. */
  reconcileView(): void;
  /**
   * Inserts one row built by the `createRow` sync prop above/below `viewRowIndex` (view-space).
   * External name that maps to the single internal batch path - it runs
   * {@link insertRows} with count 1, so both share one implementation, one `onDataChange`,
   * and one undo step.
   */
  insertRow(viewRowIndex: number, position: "above" | "below"): void;
  /**
   * Inserts `count` rows built by the `createRow` sync prop (called with `dataRowIndex + i`)
   * above/below `viewRowIndex` (view-space) as ONE `{source: 'row-op'}` DataChange with one
   * id-keyed `insert` op per row - a single undo entry. Dev-warning no-op when `createRow` is
   * absent; silent no-op for `count <= 0`.
   */
  insertRows(viewRowIndex: number, count: number, position?: "above" | "below"): void;
  /** Deletes the rows at `viewRowIndexes` (view-space) as one `{source: 'row-op'}` DataChange with id-keyed `delete` ops. */
  deleteRows(viewRowIndexes: number[]): void;
  /**
   * Duplicates the rows at `viewRowIndexes` (view-space), inserting each copy directly after its
   * source row, as one `{source: 'row-op'}` DataChange with id-keyed `insert` ops. Dev-warning
   * no-op when the `duplicateRow` sync prop is absent — required so
   * every duplicated row gets a distinct id, never colliding with its source's React key.
   */
  duplicateRows(viewRowIndexes: number[]): void;
  /**
   * Moves the row at view index `from` so it lands at view index `to` (final position — arrayMove
   * semantics: `from < to` shifts rows `from+1..to` up one, `from > to` shifts rows `to..from-1`
   * down one). One `{source: 'row-op'}` DataChange with a single id-keyed `move` op (one undo
   * entry). No-ops (silent, dev-warned where the cause is a misconfiguration): `enableRowReorder`
   * off, readOnly, an open edit session (the editor pins a view coordinate the move would
   * invalidate), an active sort/filter (the view order is owned by the sort/filter, not the data),
   * unloaded (lazy) rows (a reorder would shift the lazy add-on's index bookkeeping), and a drop
   * that leaves the row where it already is.
   */
  reorderRows(from: number, to: number): void;
  /** @internal keyboard nav helper: moves/extends the active cell by a view-space delta, clamped to view bounds. */
  _moveActiveCell(d: { dx: number; dy: number }, opts?: { extend?: boolean; retain?: boolean }): void;
  /** @internal syncs live consumer props and recomputes derived state; not part of the public hook surface. */
  _syncProps(props: InternalSyncProps): void;
  /** @internal `DataGridRoot` registers/clears its scroll-into-view on mount/unmount; not part of the public hook surface. */
  _registerScrollToCell(impl: ((coord: CellCoord) => void) | null): void;
  /** @internal `DataGridRoot` syncs its `readOnly` prop into the store on every render/unmount; not part of the public hook surface. */
  _registerReadOnly(readOnly: boolean): void;
  /** @internal `DataGridRoot` syncs its effective (merged) keymap into the store on every render/unmount; not part of the public hook surface. */
  _registerKeymap(keymap: Keymap): void;
  /** @internal the `data-grid-fill` add-on's tracker component registers/clears its keymap handlers on mount/unmount; not part of the public hook surface. */
  _registerFillHandlers(handlers: { fillDown: () => void; fillRight: () => void; cancelFillDrag: () => void } | null): void;
};

/** Full store shape: interaction state + the stable actions object. */
export type DataGridStore = DataGridStoreState;

/**
 * Everything `computeViewIndex`/`computeSearchMatches`/`computeVisibleColumns` read on a
 * `_syncProps` sync, captured by reference. All fields `===`-equal to the previous sync's means
 * their outputs (`viewIndex`/`searchMatches`/`visibleColumns`) are also unchanged, so `_syncProps`
 * can skip recomputing them and reuse the previous references (a controlled parent re-rendering
 * for unrelated reasons — e.g. its own local state — shouldn't pay full buildViewIndex cost).
 */
export type SyncInputs = {
  data: readonly unknown[];
  columns: readonly AnyColumnDef[];
  /** Sort reads each column's cell-type `compare`, so a swapped registry changes `viewIndex`. */
  cellTypes: Record<string, CellType>;
  sortState: SortSpec[];
  filterState: FilterSpec[];
  joinOperator: FilterJoinOperator;
  searchText: string;
  columnOrder: string[] | null;
  hiddenColumns: readonly string[];
};

export function syncInputsEqual(a: SyncInputs, b: SyncInputs): boolean {
  return (
    a.data === b.data &&
    a.columns === b.columns &&
    a.cellTypes === b.cellTypes &&
    a.sortState === b.sortState &&
    a.filterState === b.filterState &&
    a.joinOperator === b.joinOperator &&
    a.searchText === b.searchText &&
    a.columnOrder === b.columnOrder &&
    a.hiddenColumns === b.hiddenColumns
  );
}

/** Result of a successful direct-write commit; `null` state fields mean "leave editing/editingError untouched". */
/**
 * `warnings` (only on the success/noop arms) carries `onInvalid: "warn"` rejections that committed
 * anyway — the store merges them into `cellErrors` AFTER the gesture's auto-clear and `validateRow`
 * verdict, so the freshest per-cell signal wins.
 */
export type CommitResult =
  | { data: readonly unknown[]; change: DataChange<unknown>; warnings?: readonly CellErrorEntry[] }
  | { error: string }
  | { noop: true; warnings?: readonly CellErrorEntry[] };

/** Per-row accumulator: the row as edited so far, plus its per-column cell deltas (columnId -> entry). */
export type RowEdit = { row: unknown; cells: Map<string, { columnId: string; value: unknown; prev: unknown }> };

/** Props for {@link DataGridProvider}. */
export type DataGridProviderProps<TData = unknown> = DataGridSyncProps<TData> & { children: ReactNode };

/** {@link useDataGridCellState}'s return shape — the 5 primitives `DataGridCell` reads every render. */
export type DataGridCellState = {
  isActive: boolean;
  /** True for any selected cell (active cell, inside the primary range/range stack, or its row/column channel) — drives `aria-selected` (WAI-ARIA grid pattern: every selected cell reports it, not just the focused one). */
  isSelected: boolean;
  isEditing: boolean;
  initialText: string | undefined;
  isSearchMatch: boolean;
  /** This cell's `cellErrors` message, or null when it has none — same visual language as a sync `validate` rejection. */
  cellError: string | null;
};

/**
 * {@link useDataGridRowCellState}'s return shape — one row's worth of interactive cell state,
 * derived ONCE per row instead of once per cell. `selectedColRanges` is a rectangle-based summary
 * (a row's selected columns are a small union of `[start,end)` runs), so it stays cheap to compute
 * and to compare by content.
 */
export type DataGridRowCellState = {
  /** The active cell's column in this row, or null if the active cell isn't in this row. */
  activeCol: number | null;
  /** The editing cell's column in this row, or null if editing isn't happening in this row. */
  editingCol: number | null;
  /** Only set when `editingCol` is non-null (mirrors {@link useDataGridCellInitialText}'s per-cell scoping). */
  editingInitialText: string | undefined;
  /** Every column index in this row matching the current search, or null when search is inactive/no row match — null (not an empty Set) lets a row with no matches skip allocating one. */
  searchMatchCols: ReadonlySet<number> | null;
  /** This row's errored columns (column index -> message), or null when this row has none — same zero-render contract as `searchMatchCols`. */
  errorCols: ReadonlyMap<number, string> | null;
  selectedColRanges: readonly ColRange[];
};
