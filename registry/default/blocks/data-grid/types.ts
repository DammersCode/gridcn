import type { ComponentType, FC, ReactNode } from "react";
import type { CellValidateContext } from "./validation/validate-context";
import type { GateContext } from "./store/gate-signal";
import type { KeyBinding } from "./keyboard/key-syntax";
import type { AnyColumnDef, DataGridActions, DataGridStoreState } from "./store/types";
import type { DataGridSelectedRows } from "./store/selected-rows";
import type { RowBandRenderCtx } from "./layout-context";
import type { OverlayPluginCtx } from "./overlays";
import type { PluginCellMenuItems } from "./plugin-menu-types";
import type { StandardSchemaV1 } from "./standard-schema";
import type { BuiltInFilterOperator, FilterOperator, CustomFilterOperator, FilterSpec } from "./filter-spec";
import type { AggregateReducer } from "./group-types";

export type { KeyBinding };

export type { StandardSchemaV1, StandardSchemaV1Issue, StandardSchemaV1Result } from "./standard-schema";

// `keyof TData & string` alone resolves to `never` (not `string`) when TData=unknown — unlike
// `never`, where `keyof never` is the universal key type `string | number | symbol` — so the
// erasure boundary's `ColumnDef<unknown, ...>` (see store.tsx's AnyColumnDef) needs this special
// case, else `accessorKey` collapses to an uninhabited `undefined` field.
export type AccessorKeyOf<TData> = unknown extends TData ? string : keyof TData & string;

declare const viewIndexBrand: unique symbol;

/** A row position in the current view. Build one with {@link viewIndex}. The `At` row actions take a plain number or a `ViewIndex`. */
export type ViewIndex = number & { readonly [viewIndexBrand]: true };

/** Marks `index` as a view row position for an `At` action. */
export const viewIndex = (index: number): ViewIndex => index as ViewIndex;

/** Marks each of `indexes` as a view row position for an `At` action. */
export const viewIndexes = (indexes: readonly number[]): readonly ViewIndex[] => indexes as readonly ViewIndex[];

/** Cell coordinate in view-index: 0-based view row (sorted/filtered, not a data index) and 0-based visible-column index (marker columns excluded). It reshuffles under sort and filter — never persist it or compare it across a reorder; address cells by {@link CellRef} instead. */
export type ViewCoord = { col: number; row: number };

/** Stable cell identity: the row's `getRowId()` value plus the column's id. Survives sort, filter, and reorder — the coordinate for actions and the identity the cell ctx hands out. A ref whose row is not in the current data (filtered out, paged away, deleted) or whose column is hidden does not resolve: the action is a no-op, and dev mode warns once per grid. */
export type CellRef = { rowId: string; columnId: string };

/** A {@link CellRef} plus the view-index position the cell occupied when the event fired. */
export type ViewCellRef = CellRef & {
  /** The view (display) row index at fire time. */
  viewRowIndex: number;
  /** The view (display) column index at fire time. */
  viewColumnIndex: number;
};

/** How the quick search compares text: `matchCase` (default `false`) respects letter case, `wholeCell` (default `false`) matches only cells equal to the search text. */
export type SearchOptions = { matchCase?: boolean; wholeCell?: boolean };

/** The two opposite corners of a rectangular selection; either diagonal order is accepted on resolve. */
export type CellRange = { start: CellRef; end: CellRef };

/**
 * The grid's selection in stable {@link CellRef} terms: the primary range with its anchor, the
 * ctrl-click range stack, and the whole-row/whole-column channels. The active cell is
 * deliberately not part of it — it moves on every arrow key, and controlling it would push every
 * keystroke through the consumer's render; it stays uncontrolled with `onActiveCellChange`.
 * `anchor` may lie inside the range (Ctrl+A puts the active cell as the anchor inside the
 * region); a resolved anchor outside its range resets to `range.start`.
 */
export type SelectionState = {
  /** The primary range's anchor (Excel's white cell), or `null` when there is no primary range. */
  anchor: CellRef | null;
  /** The primary range; `null` when only the row/column channels (or nothing) are selected. */
  range: CellRange | null;
  /** Earlier ctrl-click ranges, oldest first. */
  rangeStack: readonly CellRange[];
  /** Row ids of the row channel, in view order: the checked rows in the view, without the remembered hidden ones that `getSelectedRows()` includes. */
  rowIds: readonly string[];
  /** Column ids of the column channel, in view order. */
  columnIds: readonly string[];
};

/** What a marker mode renders: the 1-based view row index, the row-select checkbox, or both (number swapped for the checkbox on hover/selected). */
export type RowMarkersContent = "number" | "checkbox" | "both";

/**
 * Marker column mode: a pinned-left column rendered BEFORE all data columns, outside the data
 * column index space (ViewCoord.col / aria-colindex / aria-colcount are all untouched by it).
 * The plain modes (`number`/`checkbox`/`both`) render the selection chrome only and keep the
 * marker a pure row-select surface — a drag there is always the row-range select. The
 * `reorder`-prefixed family renders the drag handle on top of the suffix's content and is the
 * ONLY family that arms the drag-to-reorder gesture
 * and the press ZONE decides the gesture: the drag handle zone reorders on drag and never changes the selection, while the checkbox glyph and the number/rest of the cell stay pure row-select.
 */
export type RowMarkersMode = "none" | RowMarkersContent | "reorder" | `reorder-${RowMarkersContent}`;

/** How long the checked rows last; see `checkedRowsLifetime` on `DataGridSyncProps`. */
export type CheckedRowsLifetime = "until-click" | "until-cleared" | "across-filters";

/** Rectangular cell region, half-open on the far edge (a cell c is inside if x <= c < x + width). */
export type GridRect = { x: number; y: number; width: number; height: number };

/**
 * Selection model.
 * `cell` is the anchor (Excel's white cell) and is always inside `range`.
 * `rangeStack` holds additional rectangles from ctrl-click multi-range; never contains `range`.
 * `rows`/`columns` are whole-row/column selection channels, distinct from `current`.
 */
export type GridSelection = {
  current: {
    cell: ViewCoord;
    range: GridRect;
    rangeStack: GridRect[];
  } | null;
  rows: CompactSelectionLike;
  columns: CompactSelectionLike;
};

/** Structural interface of CompactSelection so types.ts stays dependency-free. */
export type CompactSelectionLike = {
  readonly length: number;
  hasIndex(index: number): boolean;
  /** Content equality over both members' runs, independent of internal slice layout. */
  equals(other: CompactSelectionLike): boolean;
  hasAll(range: [number, number]): boolean;
  toArray(): number[];
  /** The member indices as sorted, merged, half-open `[start, end)` runs. */
  runs(): readonly (readonly [start: number, end: number])[];
};

/**
 * Selection-gesture configuration. All default `true`.
 * Disabling a channel removes both its gestures (header/marker click, drag) AND its selection
 * channel: e.g. `enableColumnSelection: false` makes header clicks a no-op, not just un-rendered.
 */
export type SelectionConfig = {
  enableRowSelection: boolean;
  enableColumnSelection: boolean;
  enableRangeSelection: boolean;
  enableMultiRange: boolean;
};

/** One data mutation. Operations are row-id-based so history survives sort/filter (never index-keyed). */
export type DataOp<TData> =
  | {
      type: "update";
      rowId: string;
      row: TData;
      prev: TData;
      /** Per-cell detail when known (cell edits, paste, fill); absent for whole-row updates. */
      cells?: { columnId: string; value: unknown; prev: unknown }[];
    }
  | { type: "insert"; rowId: string; row: TData; index: number }
  | { type: "delete"; rowId: string; row: TData; index: number }
  | {
      type: "move";
      rowId: string;
      row: TData;
      /** The row's position before the move. */
      from: number;
      /** The row's position after the move (final index; `applyChange` deletes by id and places the row at output slot `to`, `invertChange` swaps `from`/`to`). `from` and `to` index the loaded `data`, so on a paged grid they count from the first loaded row, not from the page. */
      to: number;
      /** The id of the row that follows the moved row in `data` after the whole batch; absent when the row ends last. A server places the row with this id, which does not depend on what the server has loaded. A move that `commitChange` applies with neither neighbor id, such as an undo or a redo, gets both from the data after the batch. */
      beforeRowId?: string;
      /** The id of the row that precedes the moved row in `data` after the whole batch; absent when the row ends first. */
      afterRowId?: string;
    };

/** One user gesture = one batch (a paste, a fill, a delete-range is a single entry). */
export type DataChange<TData> = {
  ops: DataOp<TData>[];
  /**
   * Origin of the change, for history labeling and consumer filtering. `"stream"` tags a
   * `updateCells`/`updateRows` batch; `useDataGridHistory` drops it by default, because a
   * 100-updates/s feed would evict the user's whole undo stack in seconds. `"app"` tags an
   * imperative `record()` entry (a programmatic change the consumer applied itself).
   * `"replace"` tags a find-and-replace batch (an `updateCells` call the `data-grid-find-replace` add-on makes); `useDataGridHistory` records it.
   * `"history"` tags an undo or redo; `"rollback"` tags `useDataGridHistory().rollback`, which reverts a
   * change whose save failed, and a refusal returned from `onSave` reverts through it as well. Neither is recorded.
   * `"merge"` tags the change `resolveSaveConflict` commits on top of the server's row; `onSave` receives it, history does not record it.
   * `"id-swap"` tags `replaceRowId`, which swaps a row's id for the server's.
   * `onSave` never receives a `"rollback"`, a `"stream"` or an `"id-swap"` change.
   */
  source: "edit" | "paste" | "fill" | "delete" | "cut" | "row-operation" | "import" | "history" | "rollback" | "merge" | "id-swap" | "stream" | "replace" | "app";
  /** Optional human-readable label for this entry (e.g. "Batch save rollback"); carried through the undo/redo stack as-is. */
  label?: string;
  /** On a `source: "rollback"` or `"merge"` change: the change this one reverts. */
  reverts?: DataChange<TData>;
  /** Ids of rows whose content this change took from the server's `SaveRejection.current` or a conflict resolution; older undo entries for them are stale. */
  serverRowIds?: readonly string[];
};

export type CellRenderProps<TData, TValue, TOptions = unknown> = {
  /** The resolved cell value (through the column's `accessorKey`/`accessorFn`). */
  value: TValue;
  /** The full data row this cell belongs to. */
  row: TData;
  /** The row's `getRowId()` value — stable row identity (see {@link CellRef}). */
  rowId: string;
  /** The column's id. With `rowId`, addresses this cell stably. */
  columnId: string;
  /** Display (view-index) row index: the sorted/filtered position, matching what the user sees. NOT a stable index into `data` — it reshuffles under sort and filter. */
  viewRowIndex: number;
  /** The column's `options`, typed through `TOptions` (your declared options type) when the cell type is parameterized with it. A cell type's `Cell` and `renderCell` receive it. */
  options?: TOptions;
  // `column`'s own validate erases independently (3rd param `any`) — same reasoning as
  // CellClassNameCtx.column below; without it, renderCell's own bivariance gets re-poisoned by
  // validate's union whenever TValue is erased to `unknown` at the array-common-type boundary.
  column: ColumnDef<TData, TValue, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** True while this cell is the active cell. */
  isActive: boolean;
};

/** Context passed to the grid-level {@link ColumnDef}-agnostic `getCellClassName` prop. */
export type CellClassNameCtx<TData, TValue> = {
  value: TValue;
  row: TData;
  /** The row's `getRowId()` value — stable row identity (see {@link CellRef}). */
  rowId: string;
  /** The column's id. With `rowId`, addresses this cell stably. */
  columnId: string;
  // `column`'s own validate erases independently (3rd param `any`) so THIS type's bivariance
  // (recovered via CellClassNameFnHolder below) doesn't get re-poisoned by validate's union when
  // TValue itself is erased to `unknown` at the array-common-type boundary — see types.ts's
  // ColumnDef.validate doc and store.tsx's AnyColumnDef doc for the full reasoning.
  column: ColumnDef<TData, TValue, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Display (view-index) row index — the sorted/filtered position, matching what the user sees. */
  viewRowIndex: number;
};

/**
 * Grid-level row class callback; merged via `cn()` after the
 * built-in row classes. `viewRowIndex` is the display (sorted/filtered) position. An inline function
 * is fine: rows re-render only when the function returns different classes for the rendered rows.
 */
export type GetRowClassName<TData> = (row: TData, viewRowIndex: number) => string | undefined;

/** Grid-level cell class callback; same re-render rule as {@link GetRowClassName}. */
export type GetCellClassName<TData> = (ctx: CellClassNameCtx<TData, unknown>) => string | undefined;

/** Context passed to `onCellClick`. Same shape as {@link CellClassNameCtx} plus the column's real index (not just its view row). */
export type CellClickCtx<TData, TValue> = {
  value: TValue;
  row: TData;
  column: ColumnDef<TData, TValue>;
  /** The row's `getRowId()` value — stable row identity (see {@link CellRef}). */
  rowId: string;
  /** The column's id. With `rowId`, addresses this cell stably. */
  columnId: string;
  /** Display (view-index) row index — matches {@link CellClassNameCtx.viewRowIndex}. */
  viewRowIndex: number;
  /** Data-column index (not the marker column) — matches `ViewCoord.col`. */
  viewColumnIndex: number;
};

/**
 * Fired on a plain click on any non-skeleton, non-pinned-row cell — attached to the cell's own
 * existing DOM click handler (no new subscription). Fires alongside
 * whatever the click already does (select the cell, toggle a checkbox) — it's a pure
 * notification, never a veto point (contrast the `data-grid-fill` add-on's `processFill` gate).
 */
export type OnCellClick<TData> = (ctx: CellClickCtx<TData, unknown>, event: MouseEvent) => void;

/**
 * Fired by `onEditEnd` when an edit session ends or a commit attempt is refused: `commit` after the
 * session closes (data written or no-op), `cancel` when the draft is discarded (Escape, the cell
 * leaving the view, or a new `startEditing` replacing the session), `rejected` when a commit
 * attempt failed validation and the session STAYS OPEN (fired per attempt, alongside the
 * `editingRejectionCount` bump). Each session ends with exactly one `commit` or `cancel`. The
 * committed value is not included — `onDataChange` carries it.
 */
export type GridEditEndEvent = ViewCellRef & { result: "commit" | "cancel" | "rejected" };

/** One cell a bulk write (paste, fill, `updateCells`) refused after validation: the target (stable id plus view position, `-1` outside the view) plus the value that failed and the validator's message. */
export type GridBulkValidationError = { rowId: string; columnId: string; viewRowIndex: number; value: unknown; message: string };

/**
 * Fired by `onValidationError` after a bulk paste, a fill, a Delete clear (`"delete"`), a Cut (`"cut"`), an `updateCells` call (`"stream"`, or `"replace"` for a find-and-replace batch), or an `editRows` save or a checkbox toggle (`"edit"`)
 * settles, ONLY when at least one cell was rejected — the accepted cells are already applied
 * (their `onDataChange`/`onSelectionChange` fire first). `rejected` lists every refused cell with
 * its validator's message.
 */
export type GridValidationErrorEvent = { source: "paste" | "fill" | "stream" | "replace" | "delete" | "cut" | "edit"; rejected: GridBulkValidationError[] };

/** Fired on a double-click on any non-pinned, non-skeleton cell — a pure notification in the {@link OnCellClick} sense (no veto), fired regardless of readOnly. */
export type OnCellDoubleClick<TData> = (ctx: CellClickCtx<TData, unknown>, event: MouseEvent) => void;

/** Fired when the user right-clicks any non-pinned, non-skeleton cell — a pure notification; the `data-grid-context-menu` add-on listens at the root and is unaffected. */
export type OnCellContextMenu<TData> = (ctx: CellClickCtx<TData, unknown>, event: MouseEvent) => void;

/**
 * Method-shorthand holder purely so {@link ColumnDef.cellClassName}'s function branch can pull its
 * signature via indexed access (`CellClassNameFnHolder<...>["fn"]`) instead of writing the function
 * type directly in the union — a function type embedded straight in a union property is checked
 * contravariantly, but one recovered from a method-shorthand declaration via indexed access keeps
 * that declaration's bivariant check, so a `defineColumns` literal's narrow `TValue`-specific
 * callback stays assignable to `ColumnDef<TData, unknown>` (see column-helpers.type-test.ts).
 */
type CellClassNameFnHolder<TData, TValue> = { fn(ctx: CellClassNameCtx<TData, TValue>): string | undefined };

/**
 * Editor contract: the editor holds its own draft. `commitValue(value, movement?)` validates and applies a value, closes the
 * editor, and moves the active cell. `onChange(value)` stashes a draft that a later `commit(movement?)` applies; a `commit()`
 * with no `onChange` since the editor opened applies the opening value. `cancel()` discards everything.
 */
export type CellEditorProps<TData, TValue, TOptions = unknown> = {
  /** The last-COMMITTED value, as it was when the editor opened (seed for your initial draft). NOT your in-progress draft — that lives in your editor's local state. */
  value: TValue;
  /** Initial text seed when editing started by typing (type-to-replace); undefined for Enter/F2. */
  initialText?: string;
  /** The full data row this cell belongs to. */
  row: TData;
  /** The row's `getRowId()` value — stable row identity. */
  rowId: string;
  /** The id of the column being edited. */
  columnId: string;
  /** The column's `options`, typed through `TOptions` (your declared options type) when the cell type is parameterized with it. */
  options?: TOptions;
  // `column`'s own validate erases independently (3rd param `any`) — same reasoning as
  // CellRenderProps.column above.
  column: ColumnDef<TData, TValue, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Stash the current draft. Takes effect on the next `commit` — it never writes the store by itself. */
  onChange: (value: TValue) => void;
  /** Validate and apply the last stashed value, close the editor, and move the active cell by the given delta (Enter = {0,1}, blur/click-away = {0,0}). */
  commit: (movement?: { dx: number; dy: number }) => void;
  /** `onChange(value)` and `commit(movement)` in one call. */
  commitValue: (value: TValue, movement?: { dx: number; dy: number }) => void;
  /** Discard the edit without emitting a change. */
  cancel: () => void;
  /**
   * True while an async Standard Schema `validate` is awaiting its result for THIS commit attempt
   * (see interaction/use-async-validate.ts) — editing is still open. Built-in editors set their
   * input `readOnly` (not `disabled` — a disabled input can't receive Escape/blur) while pending;
   * a custom editor may ignore this or style it differently. Always `false`/`undefined` for the
   * function form and sync schemas.
   */
  pending?: boolean;
  /**
   * Increments on every rejected commit attempt (sync or async) for this cell, and resets to 0
   * when a new edit session starts. A built-in editor's own one-shot commit guard (see
   * interaction/use-commit-guard.ts) must re-arm on a REJECTION specifically — not on every
   * `pending` transition to false, which also happens on Escape/cancel right before the editor
   * unmounts; re-arming there would let the unmount's own blur event fire a second, stale commit
   * through the now-unguarded path.
   */
  rejectionCount?: number;
};

/**
 * A cell type implements rendering plus the value pipeline that powers copy, paste, fill,
 * delete, and import/export. The pipelines read
 * the value through DIFFERENT surfaces, so one override does not reach all of them:
 *
 * - display (the cell's rendered text) = `toDisplayText` when present, else `toText`.
 * - clipboard copy and export = `toText` (export with `text: "display"` reads `toDisplayText ?? toText`).
 * - sort = `compare` when the column declares this type, else a numeric-aware locale collation of
 *   the RAW `String(value)` — not of `toText` output.
 * - quick search = `toSearchText` when the type declares it, else `toText`; a column without a
 *   declared type searches `String(rawValue)` (a `select` column searches the choice LABEL; a
 *   `number` with `decimals` searches the rounded value; a `date` with a `displayFormat` searches
 *   the ISO string).
 * - filter = the raw-value predicate (`filter.match` of the column or of its cell type), else the
 *   built-in text matcher over `String(rawValue)`.
 * - fill = `toText` of the source cells, then the target column's `fromText`.
 */
export type CellType<TData = unknown, TValue = unknown, TOptions = unknown> = {
  Cell: FC<CellRenderProps<TData, TValue, TOptions>>;
  Editor: FC<CellEditorProps<TData, TValue, TOptions>>;
  /** Serialize for clipboard/export; quick search uses it when the type declares no `toSearchText`. Filter never uses it — it matches the raw value. */
  toText(value: TValue, options?: TOptions): string;
  /** Optional display-only rendering (e.g. locale-formatted dates); the cell renders `toDisplayText ?? toText`. Clipboard copy and export use `toText`; export with `text: "display"`, print, autosize, header filter set values, and the status bar read `toDisplayText ?? toText`. */
  toDisplayText?(value: TValue, options?: TOptions): string;
  /** Parse from paste/import/typing. Call `rejectText()` for text it cannot parse: the cell keeps its value on paste, fill, import, and replace, and the grid reports the text. Return `clearValue()`'s result only to empty the cell on purpose. */
  fromText(text: string, options?: TOptions): TValue;
  /** Runs once per column before a paste calls `fromText`, with the column's distinct texts. A promise holds the paste as the `resolveTexts` gate. */
  resolveTexts?(texts: readonly string[], options: TOptions | undefined, ctx: GateContext): Promise<void> | void;
  clearValue(options?: TOptions): TValue;
  isEmpty(value: TValue): boolean;
  /** Sort comparator for this type, given the column's `options`; when absent, sorting falls back to a numeric-aware locale collation of the raw `String(value)` — not of `toText` output. */
  compare?(a: TValue, b: TValue, options?: TOptions): number;
  /** Text alignment of the default `Cell` rendering, in reading direction: `"end"` is the right in a left-to-right grid. Default `"start"`. */
  align?: "start" | "center" | "end";
  /** Tabular-nums cell rendering for the end-aligned digits; number and date declare it. */
  numeric?: boolean;
  /** The quick-search text for a stored value; the default is `toText`. select declares the choice label. */
  toSearchText?(value: TValue, options?: TOptions): string;
  /**
   * Validation for every column of this type; same shape as {@link ColumnDef.validate}. Every
   * validation path (commit, paste, fill, updateCells, import) runs the function form first, then
   * the column's own `validate` (beside a column Standard Schema, it receives no row). A Standard
   * Schema type `validate` applies only to a column without its own.
   */
  validate?: ((value: TValue, row: TData, options?: TOptions) => string | null) | StandardSchemaV1<TValue>;
  /**
   * The edit gestures ACTIVATE this cell in place instead of opening an editor: Enter/F2, a
   * stationary click, and double-click commit `activate(value, options)` through `commitCellValue`
   * (no edit session: `onBeforeEditStart` asks first, and `onEditEnd` reports `commit` or `rejected`). checkbox declares
   * `(value) => !value`. Absent, the gestures open the editor.
   */
  activate?: (value: TValue, options?: TOptions) => TValue;
  /**
   * Link target for a stored value. The grid routes every result through `safeHref` (http/https/
   * mailto only) before it renders or opens; a type cannot widen the allow-list. `url` declares
   * it; the `openLink` action (alt+Enter), Ctrl+click (Cmd+click on macOS), and middle-click open the safe href.
   */
  href?(value: TValue, options?: TOptions): string | null;
  /** Filter capabilities for this type; each member falls back to the name-derived default when absent. */
  filter?: CellTypeFilter;
};

/** Which built-in value-input widget the filter row renders for a cell type. */
export type CellTypeValueInput = "text" | "number" | "date" | "boolean" | "choices";

/**
 * Props of a custom filter value input (a component in `CellTypeFilter.valueInput`). `value` is a
 * string, an `isBetween` pair, or an `isAnyOf` / `isNoneOf` list, depending on `operator`.
 */
export type FilterValueInputProps = {
  column: AnyColumnDef;
  operator: FilterOperator;
  value: string | [string, string] | string[] | undefined;
  onValueChange: (value: string | [string, string] | string[]) => void;
};

/**
 * Filter capabilities a cell type declares instead of the toolbar's name-derived defaults:
 * `operators` beats the type-name operator table, `match` replaces the built-in text matcher
 * (it receives the cell's RAW value and the spec and returns whether the row passes; a throw fails
 * the row; a custom operator uses its own `match`; `isAnyOf` and `isNoneOf` reach it only when the
 * same `filter` lists them in `operators`), `compare` orders cell text against a filter bound for
 * `gt`, `gte`, `lt`, `lte`, and `isBetween` (a NaN result or a throw falls back to the default order
 * for that pair), and `valueInput` picks the filter row's widget: a built-in one by name, or a
 * component that renders for every operator with a value. `ColumnDef.filter` takes the same shape
 * and wins per member.
 */
export type CellTypeFilter = {
  operators?: readonly (BuiltInFilterOperator | CustomFilterOperator)[];
  match?: (value: unknown, filter: FilterSpec) => boolean;
  compare?: (text: string, bound: string) => number;
  valueInput?: CellTypeValueInput | ComponentType<FilterValueInputProps>;
  /** The built-in text and set operators, and the header filter's value list, respect letter case. Default `false`. */
  matchCase?: boolean;
};

/** The filter capabilities of one column: the shape of {@link CellTypeFilter}. */
export type ColumnFilter = CellTypeFilter;

/**
 * `TValidate` defaults to `TValue` for normal authoring (nothing changes for consumers) but is a
 * SEPARATE type parameter so the store's erasure boundary (`AnyColumnDef`, `DataGridSyncProps.columns`)
 * can instantiate it independently as `any` (not `unknown` — proven necessary, see `validate`'s doc
 * below) while `TValue` (accessorFn/setValue/renderCell/etc.) keeps its real `unknown` erasure and
 * full type safety.
 */
export type ColumnDef<TData, TValue = unknown, TValidate = TValue> = {
  /** Stable identity — never derived from the header label. */
  id: string;
  /** String headers render truncated. Every header gets the sort arrow while the column is sorted; see `sortIndicator`. */
  header: string | ReactNode;
  /** Plain-text header when `header` is a ReactNode: names the column in export, import matching, autosize, menus, and assistive technology. */
  headerText?: string;
  accessorKey?: AccessorKeyOf<TData>;
  /**
   * Read accessor for computed or derived values. A column with ONLY `accessorFn` (no
   * `accessorKey`/`setValue`) is read-only by construction: edits, pastes, and fills are dropped
   * for it. Pair it with `setValue` to make the computed value writable.
   */
  accessorFn?: (row: TData) => TValue;
  /** Immutable write-back; defaults to spreading `accessorKey`. Required for writability when `accessorKey` is absent. */
  setValue?(row: TData, value: TValue): TData;
  /**
   * Cell type registry key; default "text". A column without a `type` sorts with the numeric-aware
   * text compare that ignores case and accents, instead of the `text` type's `compare`.
   */
  type?: string;
  options?: unknown;
  readOnly?: boolean | ((row: TData) => boolean);
  /**
   * Rejects a value: the function form returns an error message (`null` accepts) and gets `ctx` (the rows before the write, the cells this write sets, `valueOf`; `unique()` uses it), or any
   * `StandardSchemaV1` for `TValue` (Zod/Valibot/ArkType/...) — detected at the call site via
   * `"~standard" in validate`. A schema's `validate` may resolve async: the single-cell editor
   * commit waits for it with the editor open, and a bulk write (paste, fill, `updateCells`) holds
   * the batch until every cell settles (at most 32 validations run at once).
   * On success the COMMITTED value is `result.value`: a schema may transform, but its output type is its input type, so a transform to another type does not type-check.
   * `TValidate` keeps `defineColumns` columns with a narrow `TValue` assignable to the shared `ColumnDef<TData, unknown>` array; it erases only at the store boundary (see `AnyColumnDef`).
   */
  validate?: ((value: TValidate, row: TData, ctx: CellValidateContext<TData, TValidate>) => string | null) | StandardSchemaV1<TValidate>;
  /** Validates every cell of this column that one write sets in one call (`null` accepts), after `validate`; one answer per cell, in order. Ignored beside a Standard Schema. */
  validateMany?: (cells: readonly { value: TValidate; row: TData }[]) => readonly (string | null)[];
  /**
   * What a `validate` rejection does. `"block"` (default): a single-cell commit is refused (the editor
   * stays open with the message); paste, fill, `updateCells`, import, Delete, and Cut drop or clear the value (Delete and Cut keep the cell as it is). `"warn"`:
   * every one of those writes commits the value and flags the cell in `cellErrors` (same ring/tint/tooltip as
   * server errors, auto-cleared by the next valid write of that cell, and by undo of the write). A rejection
   * carries no transformed value, so `"warn"` commits the RAW value. A validator that throws blocks on both
   * modes. Warned cells are not reported through `onValidationError`. Per-row softness is expressed inside
   * the function form via its `row` argument (return `null` to skip the rule for that row).
   */
  validationMode?: "block" | "warn";
  /** Rendered width in px; default 150. A resize clamps to `minWidth` and the 32px absolute floor. */
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /**
   * Proportional share of leftover viewport width. Columns with flex grow from their base
   * `width` to fill positive leftover space; clamped by `maxWidth`. A manual resize fixes the
   * column and removes it from flex distribution.
   */
  flex?: number;
  /** Initial pin side, applied when the column id first appears; `"start"` and `"end"` follow the inline axis, so both flip in a right-to-left page; change it at runtime through `setColumnPin` or the context menu. Pinned columns only reorder within their own pin zone. */
  pin?: ColumnPin;
  /** Removes the column from click-to-sort (header clicks no longer sort it); programmatic `setSorts`/`toggleSort` still apply, and the header shows their arrow and `aria-sort`. Default true. */
  sortable?: boolean;
  /** Draws the built-in sort arrow in the header, for string and node headers alike. Set `false` when a node header draws its own arrow, such as `DataGridSortIndicator`. Default true. */
  sortIndicator?: boolean;
  /** Lets the grid group by this column. Default true. */
  groupable?: boolean;
  /** Reduces this column over each row group; the group row shows the result. */
  aggregate?: AggregateReducer<TData>;
  /** Excludes the column from the filter menu's column picker. Existing filter specs on it keep applying. Default true. */
  filterable?: boolean;
  /** Filter capabilities of this column; each member overrides the same member of the cell type's `filter`. */
  filter?: ColumnFilter;
  /**
   * Sort comparator over the whole data row (not the cell value); it replaces the column's
   * cell-type `compare`. A non-zero result orders the pair; a zero,
   * NaN, or thrown result defers that pair to the default text compare. `SortSpec` direction and
   * the empty-cell-last rule still apply.
   */
  sortCompare?: (a: TData, b: TData) => number;
  /** Initial visibility, applied when the column id first appears; toggle at runtime through `setColumnHidden` or the columns menu. */
  hidden?: boolean;
  /** `false` disables the resize handle for this column; default true. */
  resizable?: boolean;
  /** `false` disables drag-to-reorder for this column; default true. */
  reorderable?: boolean;
  /** `false` disables pin/unpin for this column; default true. */
  pinnable?: boolean;
  /** `false` keeps the column visible in the columns menu and the header menu; default true. `setColumnHidden`, URL state, saved views, and `hidden` still apply. */
  hideable?: boolean;
  /**
   * Display-only override that keeps the column's type pipeline; method-shorthand for the same bivariance reason as `validate`.
   * `props` is a {@link CellRenderProps}: `value`, `row`, `rowId`, `columnId`, `viewRowIndex`, `column`, `options`, and `isActive`.
   */
  renderCell?(props: CellRenderProps<TData, TValue>): ReactNode;
  /**
   * Per-column cell class, merged via `cn()` after the built-in cell classes so it wins on
   * conflicting utilities. A plain string applies to every cell in the
   * column; the function form gets the same per-cell context as the grid-level `getCellClassName`
   * prop (see `CellClassNameFnHolder` for why it's spelled via indexed access, not inline).
   */
  cellClassName?: string | CellClassNameFnHolder<TData, TValue>["fn"];
  /** Per-column header cell class, merged via `cn()` after the built-in header classes. */
  headerClassName?: string;
};

/** Row height presets (px): 'compact' 28, 'default' 36, 'comfortable' 44; the `rowHeight` prop overrides any of these. */
export type DensityMode = "compact" | "default" | "comfortable";

/**
 * How a plain header click behaves. `'select'` (default) selects the whole
 * column, matching the marker/row-selection model. `'sort'` cycles asc->desc->none on the
 * clicked column instead (shift+click adds it to a multi-sort); `'none'` disables both.
 */
export type HeaderClickBehavior = "select" | "sort" | "none";

export type SortSpec = { columnId: string; direction: "asc" | "desc" };

export type {
  BuiltInFilterOperator,
  FilterOperator,
  FilterOperatorInput, CustomFilterOperator, FilterJoinOperator,
  FilterSpec,
  FilterGroup,
  FilterValue,
  FetchFilterValuesContext, FetchFilterValues,
  FilterNode,
} from "./filter-spec";

/**
 * Named keyboard actions, as an interface so consumers can ADD actions by declaration-merging
 * this interface in their own module (the same path as `GridCellTypes` — the module is
 * `@/components/data-grid/types` for the default install layout):
 * ```ts
 * declare module "@/components/data-grid/types" {
 *   interface GridActions {
 *     saveAll: true;
 *   }
 * }
 * ```
 * A merged name binds through the `keymap` prop and resolves to a `commands` entry
 * ({@link GridCommand}). `typeToReplace` (type-to-replace) has no `DEFAULT_KEYMAP` binding: by
 * default any unbound printable key on an active cell dispatches it (Excel behavior, starting an
 * edit seeded with the typed char). Defining `keymap.typeToReplace` takes the action over
 * exclusively — `["F3"]` remaps the trigger (plain edit start, no char seed); `[]` disables it.
 */
export interface GridActions {
  moveUp: true;
  moveDown: true;
  moveLeft: true;
  moveRight: true;
  moveUpKeepSelection: true;
  moveDownKeepSelection: true;
  moveLeftKeepSelection: true;
  moveRightKeepSelection: true;
  scrollActiveIntoView: true;
  moveRowStart: true;
  moveRowEnd: true;
  jumpUp: true;
  jumpDown: true;
  jumpLeft: true;
  jumpRight: true;
  moveFirstCell: true;
  moveLastCell: true;
  pageUp: true;
  pageDown: true;
  extendUp: true;
  extendDown: true;
  extendLeft: true;
  extendRight: true;
  extendJumpUp: true;
  extendJumpDown: true;
  extendJumpLeft: true;
  extendJumpRight: true;
  extendFirstCell: true;
  extendLastCell: true;
  extendRowsToStart: true;
  extendRowsToEnd: true;
  extendRowsPageUp: true;
  extendRowsPageDown: true;
  selectRow: true;
  selectColumn: true;
  selectAll: true;
  toggleRow: true;
  toggleAllRows: true;
  openColumnMenu: true;
  openColumnFilter: true;
  edit: true;
  typeToReplace: true;
  cancel: true;
  clearContents: true;
  insertRowBelow: true;
  insertRowAbove: true;
  duplicateRow: true;
  deleteRows: true;
  moveRowsUp: true;
  moveRowsDown: true;
  moveColumnTowardStart: true;
  moveColumnTowardEnd: true;
  widenColumn: true;
  narrowColumn: true;
  openLink: true;
  openCellMenu: true;
  focusSearch: true;
  toggleGroupRow: true; expandGroupRow: true; collapseGroupRow: true;
}

/** Every named keyboard action — the built-ins of {@link GridActions} plus any the consumer merged in. */
export type GridAction = keyof GridActions;

/** The dialog sections a custom command's `group` places it in (the same sections the keybindings dialog renders; i18n labels live in `labels.keybindings.categories`). */
export type CommandGroup = "navigation" | "selection" | "editing" | "clipboardFill" | "history" | "other";

/**
 * The imperative handle of one grid: the stable actions object, the read-only store, non-reactive
 * state reads, and the two DOM gestures (scroll, focus). Obtain it from `<DataGrid ref>`, from
 * `<DataGridProvider ref>`, or from {@link useDataGridApi} anywhere under the provider.
 */
export type DataGridApi<TData> = {
  /** The same stable object `useDataGridActions` returns (public actions only). */
  actions: DataGridActions;
  /** The read-only store view {@link useDataGridStoreApi} returns: no `setState` — the consumer's writable store is `useDataGridStoreProps` (row-agnostic — `getRow` is the typed read). */
  store: DataGridStoreWrapper;
  /** Scrolls the cell named by the ref into view; a ref that no longer resolves no-ops (dev-warned once per grid). */
  scrollTo(ref: CellRef): void;
  /** Focuses the active cell's element, first scrolling an off-window active cell into view; with no active cell it focuses the grid (whose focus onboarding seeds (0,0)). No-ops while an edit session is open — focusing would blur the editor and commit it. */
  focus(): void;
  /**
   * Runs what the key bound to `action` runs, whether or not a key is bound: a `commands` entry with its
   * `when` and `scope`, else the built-in with its guards (`readOnly`, checked-row targets, `createRow`).
   * Does nothing before the grid mounts.
   */
  runShortcut(action: GridAction): void;
  /** A non-reactive snapshot of the current selection in stable {@link CellRef} terms. */
  getSelection(): SelectionState;
  /** The checked rows for a bulk action, the same value `useDataGridSelectedRows()` returns: the remembered hidden checked rows included, or "all matching except these ids". */
  getSelectedRows(): DataGridSelectedRows;
  /** The data row at a view (display) row index — the same read `useDataGridRow` performs, without a subscription. */
  getRow(viewRowIndex: number): TData | undefined;
  /**
   * The row id of every view row, in view order; with `pageSize`, the rows of the shown page only. An unloaded row (a hole of a lazy source) gets its placeholder id, like
   * `useDataGridRowIds`; `{ loaded: true }` leaves the placeholders out.
   */
  getViewRowIds(options?: { loaded?: boolean }): readonly string[];
};

/**
 * The store state as plugins and the `api.store` handle see it: every state field except most of
 * the consumer's `on*` event callbacks and the core's internal impl slots. Seven callbacks stay:
 * `onSave`, `onSaveRejected`, `onBeforeDeleteRows`, `onRowActionSkipped`, `onGateAborted`,
 * `onPageChange`, and `onPageSizeChange`. State reads return the
 * store's live objects (`data`, `selection`, `columns`) — they must not be mutated (no copy is
 * made; a copy per read would cost O(n) on the hot path).
 */
export type DataGridReadState = Omit<
  DataGridStoreState,
  | "onDataChange"
  | "onValidationError"
  | "onBeforeEditStart"
  | "onEditEnd"
  | "onSortChange"
  | "onFilterChange"
  | "onFilterJoinChange"
  | "onSearchTextChange"
  | "onColumnLayoutChange"
  | "onColumnResizing"
  | "onSelectionChange"
  | "onActiveCellChange"
  | "onCellDoubleClick"
  | "onCellContextMenu"
  | "onCellClick"
  | "onRenderedRowsChange"
  | "scrollToCellImpl"
  | "focusImpl"
  | "runShortcutImpl"
  | "focusSearchImpl"
  | "measureFonts"
  | "dataWrite"
>;

/**
 * The read-only store view behind `DataGridApi.store` and `useDataGridStoreApi`: `getState`, `getInitialState`, and
 * `subscribe` only — `setState` does not exist on it. The consumer's writable store (the
 * store-ownership path) is `useDataGridStoreProps`.
 */
export type DataGridStoreWrapper = {
  getState(): DataGridReadState;
  getInitialState(): DataGridReadState;
  subscribe(listener: (state: DataGridReadState, prevState: DataGridReadState) => void): () => void;
};

/**
 * One entry of the `plugins` prop: an add-on that reaches into the grid. Members are optional;
 * `name` is the React key of the plugin's components and its identity — unique per grid (when two
 * plugins share a name, a dev warning fires and the later plugin is ignored). `Overlay` renders into the overlay layer (after the
 * built-in range layers, before the active-cell ring); `rowBands` contributes to the top/bottom
 * row bands; `onDataChange` observes every data change AFTER the store write and the consumer's
 * `onDataChange`; `commands`/`keymap` join the grid's command and keymap merges; `Mount` renders
 * inside `DataGridRoot` after its children for engine work (pointer handlers, listeners). Array
 * order is the paint order, the observer order, and the precedence: the first plugin keeps a command name
 * and a key that a later plugin also takes. A plugin object attaches to ONE grid.
 */
export type DataGridPlugin<TData = unknown> = {
  /** Unique per grid: the React key of the plugin's components and its identity in the store. A later plugin with a taken name is ignored, with all its members. */
  name: string;
  /** A component rendered by `DataGridOverlays` with the overlay ctx (window clamp + pin-zone helpers). */
  Overlay?: ComponentType<OverlayPluginCtx>;
  /** Row-band contribution: which rows land in which band plus the painter. */
  rowBands?: PluginRowBands;
  /** Observes every data change after the store write and the consumer's `onDataChange`; a throwing observer logs and does not stop the others. */
  onDataChange?(next: readonly TData[], change: DataChange<TData>, ctx: DataGridPluginCtx<TData>): void;
  /** This plugin's commands, merged into the grid's command map (the consumer's `commands` win; a built-in action name is dropped). */
  commands?: Record<string, GridCommand<TData>>;
  /** Binds keys to this plugin's own commands. An entry for any other name is dropped, dev-warned; a key another action already holds is dropped, dev-warned. An entry is the action's full binding list: it replaces the action's default bindings, and an empty list or `undefined` unbinds the action. */
  keymap?: Keymap;
  /** A component rendered inside `DataGridRoot` after its children (no props — read the grid through {@link useDataGridApi}). */
  Mount?: ComponentType;
  /** Items this plugin adds to the cell menu, after the built-in items and in plugin order; the consumer's `getCellMenuItems` resolver then sees the set. A throwing function adds no items. */
  cellMenuItems?: PluginCellMenuItems;
};

/** The row-band contribution of a {@link DataGridPlugin}. */
export type PluginRowBands = {
  /** Rows for the top band (above the first data row); omit for no top band. */
  top?: readonly unknown[];
  /** Rows for the bottom band (below the last data row); omit for no bottom band. */
  bottom?: readonly unknown[];
  /** Paints this plugin's rows of one band; called as a plain function during the root's render — a band that needs state renders a component inside the returned node. */
  render(ctx: RowBandRenderCtx): ReactNode;
};

/** What a {@link DataGridPlugin} `onDataChange` observer receives besides the change. */
export type DataGridPluginCtx<TData = unknown> = {
  /** The grid's imperative handle for the grid the change belongs to. */
  api: DataGridApi<TData>;
};

/** The context a custom command's `run`/`when` receives, built fresh from the live store at dispatch time. */
export type GridCommandCtx<TData = unknown> = {
  /** The grid's imperative handle ({@link DataGridApi}) for the grid being dispatched on. */
  api: DataGridApi<TData>;
  /**
   * The active cell as a stable {@link CellRef}, or `null` when no cell is active. On an unloaded
   * lazy row it is a placeholder ref that `api` cannot resolve.
   */
  cell: CellRef | null;
  /** The view (display) row index of the active cell, or `null` when no cell is active. */
  viewRowIndex: number | null;
  /** The view (display) column index of the active cell, or `null` when no cell is active. */
  viewColumnIndex: number | null;
  /** The data row of the active cell, or `undefined` when none. */
  row: TData | undefined;
  /** The grid's effective `readOnly` flag. */
  readOnly: boolean;
};

/**
 * One consumer-defined keyboard command, bound through the `keymap` prop by name
 * (`commands: { saveAll: {...} }` + `keymap: { saveAll: ["mod+s"] }`). Method-style `run`/`when`
 * keep a consumer's `GridCommand<TData>` assignable to the store's row-agnostic field.
 */
export type GridCommand<TData = unknown> = {
  /** Runs the command when a bound key fires. */
  run(ctx: GridCommandCtx<TData>): void;
  /** Gate: return `false` to ignore the key entirely (no `preventDefault`, no `run`). */
  when?(ctx: GridCommandCtx<TData>): boolean;
  /**
   * When the command dispatches: `"grid"` (default) while no edit session is open; `"editing"`
   * while an edit session is open; `"always"` in both cases. The grid keeps its built-in bindings.
   */
  scope?: "grid" | "editing" | "always";
  /** Default keys of the command, in `keymap` syntax. An entry in the `keymap` prop for the command name replaces them. */
  keys?: readonly KeyBinding[];
  /** Keybindings-dialog label; default: `labels.keybindings.actions[name]` or the humanized name. */
  label?: string;
  /** Keybindings-dialog section; default: `"other"`. */
  group?: CommandGroup;
};

/**
 * Key binding string: `mod` = Ctrl (win/linux) / Cmd (mac), `ctrl` = the LITERAL physical Ctrl key
 * on every platform (it bypasses `mod` resolution), plus `shift`, `alt`.
 * Format: "mod+shift+ArrowUp", key is `KeyboardEvent.key`. Multiple bindings per action allowed.
 * `KeyBinding` (keyboard/key-syntax.ts) types the syntax for autocomplete; arbitrary strings stay
 * assignable (exotic keys), and invalid bindings warn in development.
 * Keep `ctrl` where `DEFAULT_KEYMAP` uses it (`ctrl+ ` for selectColumn): `mod+ ` on macOS is
 * Cmd+Space, which the OS intercepts (Spotlight), so the binding would be dead there.
 */
export type Keymap = Partial<Record<GridAction | (string & {}), KeyBinding[]>>;

/**
 * Map of built-in cell-type keys to their value/options shapes. Consumers
 * register custom cell types by augmenting this interface via declaration
 * merging in their own module (the path is `@/components/data-grid/types`
 * for the default install layout — adjust if your components alias or
 * install target differs):
 * ```ts
 * declare module "@/components/data-grid/types" {
 *   interface GridCellTypes {
 *     currency: { value: number | null; options: { currency: string } };
 *   }
 * }
 * ```
 * This gives custom types the same `options`/value inference as built-ins
 * through `defineColumns` and `TypedColumnDef`. The installed `cell-types.ts`'s
 * `cellTypes` object checks its seven built-ins against a literal
 * `BuiltinCellTypeKey` union, decoupled from this interface, so augmenting it
 * with a new key never breaks that file's compile.
 */
export interface GridCellTypes {
  text: { value: string; options: Record<string, never> };
  number: {
    value: number | null;
    options: {
      min?: number;
      max?: number;
      /** Step applied by ArrowUp/ArrowDown in the editor; default 1. With `decimals`, the step is at least `10 ** -decimals`. */
      step?: number;
      decimals?: number;
      /** Display-only locale format (currency, percent, compact); `toText`, copy, export, and the editor stay on the raw value. */
      format?: Intl.NumberFormatOptions;
      /** Language of `format`; alone it implies `format: {}` (digits grouped by it). Default `"en-US"` — an explicit default keeps SSR and client HTML identical. */
      locale?: string;
    };
  };
  checkbox: { value: boolean; options: object };
  select: {
    value: string | null;
    options: {
      /**
       * The cell stores `value`; the grid shows `label`. Display, search, sort, filter text, and copy resolve a
       * stored value to its label here (a value with no choice shows as is). Resolve the label in your own code
       * with `choices.find((choice) => choice.value === value)?.label`. A string is a choice whose value and label are equal.
       * Lookups are cached per array: pass a new array to change the choices, never mutate it in place.
       */
      choices: readonly (string | { value: string; label: string })[];
    };
  };
  date: {
    value: string | null;
    /** `locale` sets the language of `displayFormat`; alone it implies `displayFormat: { dateStyle: "medium" }`. Default `"en-US"` — an explicit default keeps SSR and client HTML identical. */
    options: {
      min?: string;
      max?: string;
      displayFormat?: Intl.DateTimeFormatOptions;
      locale?: string;
      /** Shows the editor as a typed input with a calendar button; the calendar opens on the button. Defaults to `false`: the calendar shows at edit start. */
      calendarTrigger?: boolean;
    };
  };
  url: {
    value: string | null;
    options: {
      /** Maps the stored URL to the shown link text; `toText`, copy, and export stay the URL. */
      label?: (value: string) => string;
    };
  };
  longText: {
    value: string;
    options: {
      /** The editor textarea's `maxLength`; default 100,000. Editor, paste, fill, and import all enforce it. */
      maxLength?: number;
      placeholder?: string;
    };
  };
}

/** Which inline side a pinned column sticks to; `"start"` and `"end"` flip in a right-to-left page. */
export type ColumnPin = "start" | "end";

/**
 * Plain JSON-serializable snapshot of a grid's column layout (widths/order/pins/hidden) — the save
 * payload for `onColumnLayoutChange`/`defaultColumnLayout`. `widths`
 * holds only columns the user has actually resized (a def's own `width` isn't duplicated in here);
 * `order` is always the full current column-id order, not just the moved one.
 */
export type ColumnLayout = {
  widths: Record<string, number>;
  order: string[];
  pins: Record<string, ColumnPin>;
  hidden: string[];
};

/**
 * A shared header above a run of columns. `children` lists column ids and nested groups; a group
 * keeps its columns next to each other under reorder, hide, pin, and restored layouts. A group id
 * is unique across all groups and columns.
 */
export type ColumnGroupDef = {
  id: string;
  header: string | ReactNode;
  /** Plain text for assistive technology and menus when `header` is a node. */
  headerText?: string;
  children: readonly (string | ColumnGroupDef)[];
  headerClassName?: string;
};

/** Options for `actions.autosizeColumns` and the `autosizeOnMount` prop. */
export type AutosizeOptions = {
  /** Column ids to size; hidden, unknown, or non-resizable ids are skipped (unknown ids dev-warn). Default: every visible resizable column. */
  columnIds?: readonly string[];
  /** View rows to sample, evenly strided across the view; the mounted window's rows are always included. Default 1000, clamped to [1, 10000]. */
  sampleRows?: number;
  /** Measure the header text (plus its sort-indicator and header-menu affordances) alongside the cells. Default true. */
  includeHeader?: boolean;
};

/** Registered cell-type keys (built-in + consumer-augmented). */
export type CellTypeKey = keyof GridCellTypes;

/** Value type for a given cell-type key. */
export type CellValueOf<K extends CellTypeKey> = GridCellTypes[K]["value"];

/** Options type for a given cell-type key. */
export type CellOptionsOf<K extends CellTypeKey> = GridCellTypes[K]["options"];
