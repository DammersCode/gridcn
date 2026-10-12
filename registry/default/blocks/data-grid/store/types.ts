import type { ReactNode, Ref } from "react";
import type { StoreApi } from "zustand/vanilla";
import type {
  CellRef,
  ViewCellRef,
  ViewCoord,
  AutosizeOptions,
  CellType,
  ColumnDef,
  ColumnLayout,
  DataChange,
  DataGridApi,
  FilterJoinOperator,
  FilterSpec,
  GridCommand,
  GridEditEndEvent,
  GridSelection,
  GridValidationErrorEvent,
  HeaderClickBehavior,
  Keymap,
  OnCellClick,
  OnCellContextMenu,
  OnCellDoubleClick,
  OnRowClick,
  RowMarkersMode,
  SortSpec,
} from "../types";
import type { OverlayPlugin } from "../overlays";
import type { RowBandsSpec } from "../layout-context";
import type { DataGridLabels, DeepPartialLabels } from "../labels";
import type { SearchMatch } from "../sort-filter";
import type { ExtendDirection, SelectLineOptions } from "../selection";
import type { ColRange } from "../selection/selected-col-ranges-for-row";
import type { DataWriteContext } from "./data-write";

/** The lazily-read context `DataGridRoot` registers for {@link DataGridActions.autosizeColumns}. */
export type AutosizeMeasureContext = {
  /** The computed `font` of one mounted body cell (canvas `measureText` font). */
  cellFont: string;
  /** The computed `font` of one mounted header cell (headers render `font-medium`). */
  headerFont: string;
  /** The currently mounted view-row window `[start, end)`, or `null` when no rows are mounted. */
  window: { start: number; end: number } | null;
  /** The consumer renders a per-column header-menu trigger (adds its fixed width allowance). */
  hasHeaderMenu: boolean;
};

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
  /**
   * Disables editing and delete grid-wide, independent of any per-column `readOnly`. The store is
   * the home of this flag: it is seeded from these init props (so SSR and the first client paint
   * already see it) and kept in sync by the provider's config phase — `DataGridRoot`,
   * interaction, and clipboard read `state.readOnly` at event/render time, so a flip to `true`
   * blocks the next keydown before any passive effect runs and cancels an open edit session.
   * Default `false`.
   */
  readOnly?: boolean;
  /**
   * Merged over `DEFAULT_KEYMAP` at the store (per-action bindings here take precedence; an
   * action mapped to `[]` unbinds it). `state.keymap` holds the merged result and keeps its
   * reference while this prop's entries are content-equal, so an inline `keymap={{ … }}` literal
   * does not churn the interaction memos. Surfaces outside `DataGridRoot` (the keybindings dialog)
   * read `state.keymap` via {@link useDataGridKeymap}.
   */
  keymap?: Keymap;
  /** Fired once per user gesture with the next data array and an id-keyed delta batch, after the grid stores that array. */
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
  /** Undo keymap action (mod+Z), skipped in a read-only grid; the `data-grid-history` add-on plugs its `undo()` in here. */
  onUndo?: () => void;
  /** Redo keymap action (mod+Y / mod+shift+Z), skipped in a read-only grid; the `data-grid-history` add-on plugs its `redo()` in here. */
  onRedo?: () => void;
  /**
   * Custom cell types keyed by `ColumnDef.type`, merged OVER the built-in registry — built-ins
   * you do not name keep working. A `null` entry removes a built-in (or a previously provided
   * type); the grid then renders its columns with the `text` fallback and dev-warns about the
   * unresolvable type. An inline object literal is fine: the grid rebuilds the registry only
   * when an entry changes identity, so define each type once, outside render.
   */
  cellTypes?: Record<string, AnyCellType | null>;
  /** Overrides a cell's clipboard-copy text; falls back to the cell type's `toText`. */
  processCellForClipboard?: (value: unknown, ctx: ClipboardProcessCtx<TData>) => string;
  /** Overrides parsing pasted text into a cell value; falls back to the cell type's `fromText`. */
  processCellFromClipboard?: (text: string, ctx: ClipboardProcessCtx<TData>) => unknown;
  /** Runs on the parsed paste grid before it's applied; returning `false` vetoes the paste entirely. */
  processPaste?: (cells: string[][], target: ViewCoord) => string[][] | false;
  /**
   * Prefixes formula-like copied cells (leading `=`, `+`, `-`, `@`, TAB, or CR; plain numbers
   * exempt) with `'` in the clipboard text and HTML, for Ctrl+C/Ctrl+X and the context menu's
   * Copy/Cut. A paste back into gridcn still restores the raw value. Default `false`.
   */
  sanitizeClipboardFormulas?: boolean;
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
   * Enables drag-to-reorder rows grid-wide; default true. The gesture is zone-based: it lives on
   * the marker's `reorder`-family modes only (`reorder`, `reorder-number`, `reorder-checkbox`,
   * `reorder-both`) and only from the grip zone (the grip handle + cell background, or the whole
   * cell in `reorder` mode) — plain `number`/`checkbox`/`both` markers stay pure row-select
   * surfaces, and within the reorder family the number/checkbox glyphs and Shift+drag always
   * stay the row-select gesture, so a selection drag never reorders.
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
   * Consumer-defined keyboard commands keyed by name — the dispatch target of keymap bindings
   * that name no built-in action (see {@link GridCommand}). A name that shadows a built-in action
   * wins over it (dev-warned once). Pass a stable reference.
   */
  commands?: Record<string, GridCommand<TData>>;
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
   * Deliberately NOT a controlled prop — later changes to this value are ignored (uncontrolled
   * with events); pair it with `onColumnLayoutChange` to save/restore
   * a user's layout (e.g. to localStorage) without a fully-controlled overlay fighting the defs.
   */
  defaultColumnLayout?: ColumnLayout;
  /**
   * Runs one {@link DataGridActions.autosizeColumns} pass after mount, when the view first has
   * rows (a lazy grid waits for its first page); it runs once per mount. Columns with a saved
   * width (`columnWidths`) keep it — a saved layout wins. `true` uses the action's defaults;
   * an options object narrows the pass.
   */
  autosizeOnMount?: boolean | AutosizeOptions;
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
    * Fires when the active cell changes to a different cell, when it follows its record or column to
    * another view position (a sort, filter, data change, column hide, reorder, or pin), when another
    * record comes under it (a lazy row load, or a clamp after its row or column left the view), or
    * when it is cleared (`null`). Re-selecting the same cell on the same record and column does not fire.
    */
   onActiveCellChange?: (next: ViewCellRef | null) => void;
   /**
    * Fired when an edit session is about to start (Enter/F2, type-to-replace, double-click) with
    * the target cell's ids and view position. Return `false` to VETO the edit — `startEditing`
    * then makes no state change at all (no session, no cursor move). Checkbox cells never start an
    * edit session, so the veto never applies to them.
    */
   onEditStart?: (cell: ViewCellRef) => boolean | void;
   /**
    * Fired when an edit session ends or a commit attempt is refused — `commit` after the session
    * closes, `cancel` when the draft is discarded (including a remap that drops the edited cell),
    * `rejected` when validation refused a commit and the session stays open (fires per attempt).
    * See {@link GridEditEndEvent}.
    */
   onEditEnd?: (event: GridEditEndEvent) => void;
   /**
    * Fires after a bulk paste, a fill, or an `updateCells` call settles, only when at least one cell
    * was rejected by validation — the accepted cells are applied first. See {@link GridValidationErrorEvent}.
    */
   onValidationError?: (event: GridValidationErrorEvent) => void;
   /** Fired on a double-click on any non-pinned, non-skeleton cell — pure notification, no veto. See {@link OnCellDoubleClick}. */
   onCellDoubleClick?: OnCellDoubleClick<TData>;
   /** Fired when the user right-clicks any non-pinned, non-skeleton cell — pure notification. See {@link OnCellContextMenu}. */
   onCellContextMenu?: OnCellContextMenu<TData>;
    /**
     * Fired on a plain click on any cell — see {@link OnCellClick}. Fired from the cell's own
     * existing click handler (no new subscription); the cell reads it from the store at click
     * time, so an identity change re-renders no cell. Pass a stable identity (e.g. `useCallback`)
     * to keep the store's config sync from running once per render with a new callback.
     */
    onCellClick?: OnCellClick<TData>;
    /** Fired alongside `onCellClick` once per click regardless of column — see {@link OnRowClick}. */
    onRowClick?: OnRowClick<TData>;
    /**
     * Fired after a row-window commit with the rendered data-row range `[start, end)` (inclusive
     * start, exclusive end — same convention as `useRowWindow`'s `RowWindow`). Only fires when the
     * range actually changed since the last call, including once for the initial mount commit; a
     * scroll tick that stays within the current window's overscan buffer does not re-fire it.
     * Useful for lazy-loading/prefetch/analytics add-ons; core has no fetching logic of its own.
     */
    onRowWindowChange?: (range: { start: number; end: number }) => void;
    /**
     * Fires on every live width write during a resize drag (`actions.setColumnWidth`, per drag
    * frame) — the in-progress counterpart to `onColumnLayoutChange`'s once-per-commit snapshot.
   * Fired from the store actions layer, no React-render dependency. Not called for the commit
   * itself (drag release/autosize) — pair with `onColumnLayoutChange` if you need that too.
   */
  onColumnResizing?: (columnId: string, width: number) => void;
};

/**
 * Second argument to `onSelectionChange`. `getValues()` reads the
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

/**
 * Options passed to selectRow/selectColumn actions; mirrors lib/selection's SelectLineOptions
 * (including `from` — the row-marker drag passes its press-row anchor so `replaceFromLast` can
 * replace the channel with exactly the anchor..current span).
 */
export type SelectLineActionOptions = SelectLineOptions;

/**
 * One targeted cell write for {@link DataGridActions.updateCells}, addressed by STABLE ROW ID —
 * never a view or data index. A streaming producer cannot know view coordinates under an active
 * sort, and row ids are already what {@link DataOp} uses, so history survives sort/filter.
 *
 * `TColumnId` defaults to `string` — the store's own untyped shape, which the actions keep (one
 * runtime engine serves every row type). Instantiate it with the union of your columns' `id`s
 * (e.g. `(typeof columns)[number]["id"]` from `defineColumns`'s const output) when building a
 * typed patch list: a typo'd column id then fails to compile instead of skipping at runtime.
 */
export type CellPatch<TColumnId extends string = string> = {
  /** The row's `getRowId()` value. An id not present in `data` is skipped. */
  rowId: string;
  /** Any column id, including a hidden one. An unknown id is skipped. */
  columnId: TColumnId;
  value: unknown;
};

/** One whole-row update for {@link DataGridActions.updateRows}: a partial row shallow-merged per column id. `TColumnId` follows {@link CellPatch}. */
export type RowPatch<TColumnId extends string = string> = {
  rowId: string;
  /** Column id -> new value. Each entry is applied exactly as the matching {@link CellPatch} would be. */
  changes: Readonly<Partial<Record<TColumnId, unknown>>>;
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

/** One entry of {@link UpdateCellsVerdict.skipped}: a patch that was not applied, with the reason. */
export type UpdateCellsSkip = {
  /** Index of the patch in the `patches` array the action received. */
  patchIndex: number;
  /**
   * `"unknown-row"` — the row id is not in `data`; `"unknown-column"` — the column id is not a
   * known column; `"hole"` — the row is an unloaded lazy hole; `"readonly"` — the column (or the
   * row, via `readOnly(row)`) is read-only; `"invalid"` — the column's `validate` rejected the
   * value; `"no-op"` — the value is `Object.is`-equal to the current one.
   */
  reason: "unknown-row" | "unknown-column" | "hole" | "readonly" | "invalid" | "no-op";
};

/**
 * Verdict of {@link DataGridActions.updateCells} / {@link DataGridActions.updateRows}: what the
 * batch actually did. `applied` counts the cell writes that landed; `skipped` names every patch
 * that did not land and why, so a streaming producer can observe its feed being silently dropped.
 *
 * `pending` is `true` when the batch is HELD for async validation — the verdict then reports
 * nothing about its outcome, and a held batch that is later superseded (a newer `updateCells`, or
 * a row-moving op) is dropped silently by design; track supersession on your own feed.
 */
export type UpdateCellsVerdict = {
  /** Cell writes applied (0 when nothing applied or the batch is `pending`). */
  applied: number;
  /** Patches that did not apply, with the reason. Empty when `pending`. */
  skipped: UpdateCellsSkip[];
  /** True when the batch is held for async validation. */
  pending: boolean;
};

/** Full per-grid interaction + derived state; internally typed over `unknown` rows. */
export type DataGridStoreState = Omit<
  InternalSyncProps,
  | "data"
  | "defaultData"
  | "cellTypes"
  | "commands"
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
  | "readOnly"
  | "keymap"
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
  activeCell: ViewCoord | null;
  selection: GridSelection;
  /**
   * Two-stage Ctrl+A progression (select-all-progression.ts): which stage the last `selectAll`
   * produced, plus the exact `selection`/`activeCell` object identities it produced them against.
   * Any other action that replaces `selection` or `activeCell` (selectCell/extendTo/pushRange/
   * selectRow/selectColumn/_moveActiveCell/edits/row ops) changes that identity, so `selectAll`
   * detects the mismatch and restarts from stage 1 — no need to instrument every reset site.
   */
  selectAllStage: { stage: "region" | "all"; selection: GridSelection; activeCell: ViewCoord | null } | null;
  /**
   * `coord` is the view anchor, remapped by every viewIndex/visibleColumns rebuild so the editor
   * follows its row; `rowId`/`columnId` are the identity anchor the commit resolves against, so a
   * missed remap can never write the draft into a different row. When the row (or column) leaves
   * the view the session is cancelled and the draft dropped. `session` is unique per started
   * session, so a restart on the same cell still gets a fresh editor.
   */
  editing: { coord: ViewCoord; rowId: string; columnId: string; initialText?: string; session: number } | null;
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
   /**
    * Transient "highlight-what-changed" keys (row id plus column id) currently flashing,
    * auto-cleared per key after `flashCells`'s duration (default 1400 ms — the 1.2 s fade pulse
    * finishes before the key lifts, so the cell never visibly snaps back). NOT a data change: no
    * `DataChange`, no history entry. Always {@link EMPTY_FLASHING_CELLS} identity when empty.
    */
   flashingCells: ReadonlySet<string>;
   /** Always defined: defaults to {@link EMPTY_OVERLAY_PLUGINS} so `useDataGridOverlayPlugins` never returns undefined. See `overlayPlugins`'s doc comment (DataGridSyncProps). */
  overlayPlugins: readonly OverlayPlugin[];
  /** Always defined: defaults to {@link EMPTY_ROW_BANDS} (zero-length top/bottom, `render` never called) so `useDataGridRowBands` never returns undefined. See `rowBands`'s doc comment (DataGridSyncProps). */
  rowBands: RowBandsSpec;
  lastHighlightedRow: number | null;
  lastHighlightedCol: number | null;
  columnWidths: Record<string, number>;
  /** `autosizeOnMount` as passed to the provider; the mounted root consumes it once. */
  autosizeOnMount?: boolean | AutosizeOptions;
  /** null = follow the `columns` prop order. */
  columnOrder: string[] | null;
  /** Single source of truth for visibility; seeded with the def-level `hidden` ids at creation and re-seeded when a new `columns` array is passed. */
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
   * Bumped at every row-moving or row-replacing write (insert/delete/duplicate/reorder, a
   * consumer `data` replacement) — the rowId↔dataIndex mapping changed; value-only writes never
   * bump. `useDataGridRowIdToViewRow` keys on this instead of `data` so a streaming tick skips the
   * O(n) map rebuild. Relies on `getRowId` returning stable ids across value-only writes (ids are
   * identity, not content) — the same invariant the rowId index cache holds.
   */
  rowIdentityVersion: number;
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
  scrollToCellImpl: ((coord: ViewCoord) => void) | null;
  /** DOM focus for the active cell's element, or the grid when that element is not rendered; registered by the mounted `DataGridRoot`, like `scrollToCellImpl`. */
  focusImpl: (() => void) | null;
  /**
   * The autosize measure context the mounted `DataGridRoot` registers (fonts, mounted row
   * window, header-menu flag) — `null` before mount/after unmount, when
   * {@link DataGridActions.autosizeColumns} measures nothing.
   */
  measureFonts: (() => AutosizeMeasureContext | null) | null;
  /** @internal The data-write cluster's mutable context box (see `data-write.ts`); exposed here so the `useDataGridScrollToCell` ref resolution shares its row-index cache and stale-ref warn flag. */
  dataWrite: DataWriteContext;
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
   * The `data-grid-presence` add-on's view-space activeness predicate, registered on mount and
   * cleared on unmount (same registration pattern as `fillHandlers`): answers "is any VIEW-space
   * (range-form) presence entry active right now". View-space entries pin to a display position,
   * so any op that moves rows or columns in the view (row ops, immediate `updateCells`, sort,
   * filter, join, column reorder/hide/pin, consumer data/column swaps) dev-warns once per grid
   * when it runs while the predicate reports true; rowId-native entries track their rows and
   * never trip it. `null` before mount/after unmount, or when the add-on is absent.
   */
  presenceViewSpaceActive: (() => boolean) | null;
  /**
   * The `readOnly` sync prop, defaulted to `false`: editing and delete are disabled grid-wide,
   * independent of any per-column `readOnly`. Seeded from the provider's init props (SSR and the
   * first client paint already see it) and kept in sync by the config phase, so a flip to `true`
   * is live before the next event; every reader (root `aria-readonly`, interaction, clipboard,
   * context menu) goes through this field.
   */
  readOnly: boolean;
  /**
   * The effective keymap — `DEFAULT_KEYMAP` merged with the `keymap` sync prop — seeded at store
   * creation and kept in sync by the config phase, the single source of truth for bindings
   * (backing the `data-grid-keybindings` add-on). Keeps its reference while the prop's entries
   * are content-equal (see `keymapContentEqual`). `DEFAULT_KEYMAP` when no prop is passed.
   */
  keymap: Keymap;
  /** The `commands` sync prop (see {@link DataGridSyncProps.commands}); `null` when none — the dispatch target for custom keymap names. */
  commands: Record<string, GridCommand<unknown>> | null;
  /** {@link DEFAULT_LABELS} deep-merged with the `labels` sync prop; see {@link useDataGridLabels}. */
  labels: DataGridLabels;
  actions: DataGridStoreActions;
};

/** `DataGridStoreState` with `data` typed as `readonly TData[]` — the state view {@link useDataGridSelector} hands its selector. Every row in `data` originated from the grid's own `TData`-typed `data`/`defaultData` prop, so the widening is safe. */
export type DataGridStoreStateOf<TData> = Omit<DataGridStoreState, "data"> & { data: readonly TData[] };

/** Mutations for a single grid instance, nested under the stable `actions` key. */
export type DataGridActions = {
  /**
   * Moves ONLY the active cell, leaving the selection (range, row and column channels) untouched,
   * and fires NO `onSelectionChange` (contrast `selectCell`, which sets a single-cell selection
   * and fires it). After Escape/`clearSelection`, `selection.current` is `null` while `activeCell`
   * still exists — read the active cell from `activeCell`, not from `selection.current.cell`.
   */
   /** Moves the active cell to the cell named by the stable {@link CellRef}; `null` clears it. */
   setActiveCell(ref: CellRef | null): void;
   /** View-space variant of {@link DataGridActions.setActiveCell} for callers that hold a {@link ViewCoord}. */
   setActiveCellAt(coord: ViewCoord | null): void;
   /** Selects the cell named by the stable {@link CellRef} as a single-cell selection. */
   selectCell(ref: CellRef): void;
   /** View-space variant of {@link DataGridActions.selectCell} for callers that hold a {@link ViewCoord}. */
   selectCellAt(coord: ViewCoord): void;
   /** Extends the selection to the cell named by the stable {@link CellRef}. */
   extendTo(ref: CellRef): void;
   /** View-space variant of {@link DataGridActions.extendTo} for callers that hold a {@link ViewCoord}. */
   extendToAt(coord: ViewCoord): void;
   extendSelection(direction: ExtendDirection, opts?: { toEdge?: boolean }): void;
   /** Pushes a ctrl-click range to the cell named by the stable {@link CellRef}. */
   pushRange(ref: CellRef): void;
   /** View-space variant of {@link DataGridActions.pushRange} for callers that hold a {@link ViewCoord}. */
   pushRangeAt(coord: ViewCoord): void;
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
  /**
   * Live per-frame width write during a resize drag; fires `onColumnResizing` (not
   * `onColumnLayoutChange` — see `commitColumnWidth` for the commit point). The width is clamped
   * to the column's legal range (`[max(32, minWidth), maxWidth]`, the same bounds the resize
   * gesture enforces); a callback-observed width is the clamped one. An unknown column id is a no-op.
   */
  setColumnWidth(id: string, width: number): void;
  /**
   * Sets the column's width AND fires `onColumnLayoutChange` once — the resize-drag-release/autosize
   * commit point. The width is clamped exactly as {@link setColumnWidth} clamps, and the fired
   * snapshot carries the clamped value. Fires only when the width differs from the last committed
   * one; an unknown column id is a no-op.
   */
  commitColumnWidth(id: string, width: number): void;
  /**
   * Sizes columns to their content over the whole view, not the mounted window: samples
   * `options.sampleRows` view rows (default 1000, clamped to [1, 10000]) evenly strided across
   * the view plus the mounted window's rows, measures each column's cell-type display text with
   * canvas `measureText`, and commits every changed width in ONE write with ONE
   * `onColumnLayoutChange`. Default targets: every visible column while column resizing is
   * enabled and `resizable !== false`; a named hidden, non-resizable, or unknown (dev-warned)
   * column is skipped. Unchanged widths commit nothing and fire no event. Returns the measured
   * widths; `{}` when the grid has no mounted root (nothing measured, nothing written).
   */
  autosizeColumns(options?: AutosizeOptions): Record<string, number>;
  /**
   * Drops a column's width override, restoring its def `width` (and re-joining `flex` distribution
   * — a manually resized flex column leaves it while an override is set). No-op without an
   * override. Fires `onColumnLayoutChange` once, with the override gone from `widths`.
   */
  resetColumnWidth(id: string): void;
  /**
   * Reorders visible columns. `id` moves to sit immediately before/after `targetId` (per `position`).
   * Pinned columns only reorder within their own pin zone (left/right/unpinned) — a cross-zone
   * request is a no-op recompute (dropping a left-pinned column onto the unpinned band does nothing).
   * No-op when the column's own `reorderable: false`, the grid-wide `enableColumnReorder` is false,
   * an id is unknown, or the drop keeps the order. Fires `onColumnLayoutChange` once on an actual move.
   */
  setColumnOrder(id: string, targetId: string, position: "before" | "after"): void;
  /** Pins/unpins a column (`null` = unpinned). No-op when the id is unknown, the column's `pinnable: false`, grid-wide `enableColumnPinning` is false, or the pin already matches. Fires `onColumnLayoutChange` once on a real change. */
  setColumnPin(id: string, pin: "left" | "right" | null): void;
  /**
   * Shows/hides a column via the `hiddenColumns` set; works on a def-level `hidden: true` column
   * — `setColumnHidden(id, false)` re-shows it, and the def's flag re-applies only when a NEW
   * `columns` array is passed (a same-reference re-render keeps the user's choice).
   * No-op when the id is unknown or the visibility already matches; otherwise fires
   * `onColumnLayoutChange` once.
   */
  setColumnHidden(id: string, hidden: boolean): void;
  toggleSort(columnId: string, additive: boolean): void;
  setSorts(sorts: SortSpec[]): void;
  setFilters(filters: FilterSpec[]): void;
  /** Sets how `filterState`'s rows combine ("and" every filter must match, "or" any one does). */
  setJoinOperator(joinOperator: FilterJoinOperator): void;
  /** Sets quick-search text and recomputes `searchMatches`/`searchMatchSet`/`searchMatchesCapped` once; never touches `viewIndex`. */
  setSearch(text: string): void;
  /** Enters edit mode at the cell named by the stable {@link CellRef}, cancelling an open session first; no-op when the grid or column is readOnly, or its type is unregistered or declares `activate`. */
  startEditing(ref: CellRef, initialText?: string): void;
  /** View-space variant of {@link DataGridActions.startEditing} for callers that hold a {@link ViewCoord}. */
  startEditingAt(coord: ViewCoord, initialText?: string): void;
  /** Discards the in-progress edit without emitting a change. */
  cancelEditing(): void;
  /**
   * Validates and commits the in-progress edit; rejects (keeps editing, sets editingError) or emits
   * one DataChange and moves activeCell by `movement`. `rejection` is the async validation layer's
   * awaited schema rejection for an `onInvalid: "warn"` column: the commit's sync re-run cannot see
   * a schema Promise's issues, so the layer forwards the message to flag the cell. No-op in a
   * read-only grid.
   */
  commitCellEdit(value: unknown, movement?: { dx: number; dy: number }, rejection?: string): void;
  /** Direct-write path for types with no edit mode (checkbox): validates and commits `value` at the cell named by the stable {@link CellRef} without requiring `startEditing` first, and never moves the active cell. No-op in a read-only grid. */
  commitCellValue(ref: CellRef, value: unknown): void;
  /** View-space variant of {@link DataGridActions.commitCellValue} for callers that hold a {@link ViewCoord}. */
  commitCellValueAt(coord: ViewCoord, value: unknown): void;
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
  /**
   * Puts the given cells into a transient ~1.2 s fade pulse (the
   * "highlight-what-changed" effect a fill/paste/move gesture plays on the cells it just wrote).
   * A cell already flashing gets its timer RESET, so overlapping gestures each get the full pulse.
   * NOT a data change — no `DataChange`, no history, no selection movement.
   */
  flashCells(cells: readonly CellRef[], durationMs?: number): void;
  /** Clears every non-readOnly cell in the current selection to its type's clearValue(), as one batch DataChange. */
  deleteSelection(): void;
  /**
   * The one generic multi-cell write path: applies `updates` (view-space coords via `viewRow`) as
   * a single `source`-tagged DataChange batch. Dedupes multiple updates to the same row/column
   * (last write wins), skips readOnly cells and no-op writes, preserves identity of untouched rows,
   * suppresses an empty batch entirely, and moves the selection to cover the touched view rect.
   */
  applyCellUpdates(updates: { viewRowIndex: number; columnId: string; value: unknown }[], source: DataChange<unknown>["source"]): void;
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
  updateCells(patches: readonly CellPatch[], options?: UpdateCellsOptions): UpdateCellsVerdict;
  /** {@link updateCells} keyed by whole row: each {@link RowPatch}'s `changes` expands to one patch per column id. */
  updateRows(updates: readonly RowPatch[], options?: UpdateCellsOptions): UpdateCellsVerdict;
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
   * that leaves the row where it already is. Returns `true` when the row moved, `false` for any
   * no-op — the drag gesture uses the verdict for its a11y announcement.
   */
  reorderRows(from: number, to: number): boolean;
};

/** @internal The `_`-prefixed store actions that the core and add-on wiring call; `useDataGridActions` never returns them. */
export type DataGridInternalActions = {
  /**
   * @internal Clears every `rowIds` x `columnIds` cell still in view, as one `delete` batch. Cut
   * captures the ids at copy time, so a view change during the clipboard write never shifts the
   * cleared cells. Not part of the public hook surface.
   */
  _deleteCellsById(rowIds: readonly string[], columnIds: readonly string[]): void;
  /** @internal keyboard nav helper: moves/extends the active cell by a view-space delta, clamped to view bounds. */
  _moveActiveCell(d: { dx: number; dy: number }, opts?: { extend?: boolean; retain?: boolean }): void;
  /** @internal syncs live consumer props and recomputes derived state; not part of the public hook surface. */
  _syncProps(props: InternalSyncProps): void;
  /**
   * @internal Syncs the config slice (every sync prop that feeds no derived state: `readOnly`,
   * `keymap`, the `enable*` flags, `rowMarkers`, `headerClickBehavior`, `labels`, `commands`,
   * `overlayPlugins`, `rowBands`, `autosizeOnMount`, and every `on*`/`process*`/`validateRow`/
   * `createRow`/`duplicateRow` callback) into the store, run from the provider's layout effect so
   * a `readOnly` flip is live before the browser paints or dispatches the next event. A `keymap`
   * content change runs the dev-only binding validation here; `readOnly` turning on cancels an
   * open edit session. Not part of the public hook surface.
   */
  _syncConfig(props: InternalSyncProps): void;
  /**
   * @internal The provider subscribes after its `onActiveCellChange` wiring: fires `onEditEnd`
   * `cancel` when a session ends outside commit/cancel (remap, stale-anchor discard, direct store
   * write). Returns the unsubscribe. Not part of the public hook surface.
   */
  _subscribeEditEnd(): () => void;
  /** @internal `DataGridRoot` registers/clears its scroll-into-view on mount/unmount; not part of the public hook surface. */
  _registerScrollToCell(impl: ((coord: ViewCoord) => void) | null): void;
  /** @internal `DataGridRoot` registers/clears its DOM focus on mount/unmount; not part of the public hook surface. */
  _registerFocus(impl: (() => void) | null): void;
  /** @internal `DataGridRoot` registers/clears its autosize measure context (fonts, mounted row window, header-menu flag) on mount/unmount; `autosizeColumns` reads it lazily. Not part of the public hook surface. */
  _registerMeasureFonts(impl: (() => AutosizeMeasureContext | null) | null): void;
  /** @internal the `data-grid-fill` add-on's tracker component registers/clears its keymap handlers on mount/unmount; not part of the public hook surface. */
  _registerFillHandlers(handlers: { fillDown: () => void; fillRight: () => void; cancelFillDrag: () => void } | null): void;
  /**
   * @internal the `data-grid-presence` add-on registers/clears its view-space-activeness predicate
   * (see `presenceViewSpaceActive`) on mount/unmount; view-moving ops dev-warn once when they run
   * while it reports true. Not part of the public hook surface.
   */
  _registerPresenceViewSpaceActive(impl: (() => boolean) | null): void;
  /**
   * @internal Drops the flash keys whose row left `keptViewRows` (the body's rendered window),
   * so a cell that scrolls out and back in never replays its one-shot pulse. Not part of the
   * public hook surface.
   */
  _pruneFlashingCells(keptViewRows: readonly number[]): void;
};

/** @internal The full `actions` object the store holds: {@link DataGridActions} plus {@link DataGridInternalActions}. */
export type DataGridStoreActions = DataGridActions & DataGridInternalActions;

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

/**
 * The `store` branch of {@link DataGridProviderProps}/{@link DataGridProps}: a consumer-created
 * store is passed ALONE — any sync prop next to it would be silently ignored (the owner's
 * `useDataGridStoreProps` call drives the store), so the mapped-`never` makes it a type error.
 * Dev mode warns once when an untyped (cast) caller passes both anyway.
 */
export type ExternalStoreProps = { store: StoreApi<DataGridStoreState> } & {
  [K in keyof DataGridSyncProps<unknown>]?: never;
};
/** The owned-store branch of {@link DataGridProviderProps}/{@link DataGridProps}: this instance self-creates and syncs the store from the sync props. */
export type OwnedStoreProps<TData> = DataGridSyncProps<TData> & { store?: undefined };

/** Props for {@link DataGridProvider}. */
export type DataGridProviderProps<TData = unknown> = (ExternalStoreProps | OwnedStoreProps<TData>) & {
  children: ReactNode;
  /** Receives the grid's imperative handle ({@link DataGridApi}), the same object `useDataGridApi` returns under this provider. */
  ref?: Ref<DataGridApi<TData>>;
  /**
   * A consumer-created store (from `useDataGridStoreProps`) to serve to the subtree instead
   * of self-creating one. When set, the provider becomes a pure context shell: no store
   * creation, no prop sync, no subscription wiring — the owner's `useDataGridStoreProps` call
   * drives the store and must pass the same live props; pass the store ALONE (see
   * {@link ExternalStoreProps} for why sync props next to it are a type error).
   */
  store?: StoreApi<DataGridStoreState>;
};

/** {@link useDataGridCellState}'s return shape — the 5 primitives `DataGridCell` reads every render. */
export type DataGridCellState = {
  isActive: boolean;
  /** True for any selected cell (active cell, inside the primary range/range stack, or its row/column channel) — drives `aria-selected` (WAI-ARIA grid pattern: every selected cell reports it, not just the focused one). */
  isSelected: boolean;
  isEditing: boolean;
  initialText: string | undefined;
  /** The open edit session's id when `isEditing`; a new id means a new session, even on the same cell. */
  editSession: number | undefined;
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
  /** The open edit session's id; only set when `editingCol` is non-null. */
  editingSession: number | undefined;
  /** Every column index in this row matching the current search, or null when search is inactive/no row match — null (not an empty Set) lets a row with no matches skip allocating one. */
  searchMatchCols: ReadonlySet<number> | null;
  /** This row's errored columns (column index -> message), or null when this row has none — same zero-render contract as `searchMatchCols`. */
  errorCols: ReadonlyMap<number, string> | null;
  /** This row's currently-flashing columns (transient write-pulse keys), or null when none — same zero-render contract as `searchMatchCols`. */
  flashingCols: ReadonlySet<number> | null;
  selectedColRanges: readonly ColRange[];
};
