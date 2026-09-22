import type { FC, ReactNode } from "react";

/**
 * Vendored from `@standard-schema/spec` v1 (https://github.com/standard-schema/standard-schema) so
 * shipped registry code has zero runtime/type dependency on the package — the same choice TanStack
 * Form makes for the identical reason (references/form's standardSchemaValidator.ts). The spec is
 * frozen at version 1, so drift risk is ~nil; a type-level conformance test (data-grid.type-test.ts)
 * asserts this vendored copy stays assignable to/from the real package's type in both directions,
 * so any future drift fails `tsc` instead of silently diverging. `@standard-schema/spec` is still a
 * repo devDependency (types-only, for that conformance test) — never imported by shipped code.
 */
export type StandardSchemaV1<Input = unknown, Output = Input> = {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
};

interface StandardSchemaV1Props<Input = unknown, Output = Input> {
  /** The version number of the standard. */
  readonly version: 1;
  /** The vendor name of the schema library. */
  readonly vendor: string;
  /** Validates unknown input values. */
  readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  /** Inferred types associated with the schema. */
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

/** Result of one `"~standard".validate()` call: `issues` set means failure, never thrown. */
export type StandardSchemaV1Result<Output> = StandardSchemaV1SuccessResult<Output> | StandardSchemaV1FailureResult;

interface StandardSchemaV1SuccessResult<Output> {
  /** The typed output value. */
  readonly value: Output;
  /** A falsy value for `issues` indicates success. */
  readonly issues?: undefined;
}

interface StandardSchemaV1FailureResult {
  /** The issues of failed validation. */
  readonly issues: ReadonlyArray<StandardSchemaV1Issue>;
}

/** One validation failure; cell values are scalars so `path` (when present) is a flat dot-joined prefix. */
export interface StandardSchemaV1Issue {
  /** The error message of the issue. */
  readonly message: string;
  /** The path of the issue, if any. */
  readonly path?: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined;
}

interface StandardSchemaV1PathSegment {
  /** The key representing a path segment. */
  readonly key: PropertyKey;
}

interface StandardSchemaV1Types<Input = unknown, Output = Input> {
  /** The input type of the schema. */
  readonly input: Input;
  /** The output type of the schema. */
  readonly output: Output;
}

// Namespace-merged onto the `StandardSchemaV1` type (matching the official package's own
// declaration, and how consumers write `StandardSchemaV1.InferInput<S>`) — not a general-purpose
// namespace, so the lint rule's usual "prefer ES modules" concern doesn't apply here.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace StandardSchemaV1 {
  /** Infers the input type of a Standard Schema. */
  export type InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
  /** Infers the output type of a Standard Schema. */
  export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
}

// `keyof TData & string` alone resolves to `never` (not `string`) when TData=unknown — unlike
// `never`, where `keyof never` is the universal key type `string | number | symbol` — so the
// erasure boundary's `ColumnDef<unknown, ...>` (see store.tsx's AnyColumnDef) needs this special
// case, else `accessorKey` collapses to an uninhabited `undefined` field.
export type AccessorKeyOf<TData> = unknown extends TData ? string : keyof TData & string;

/** Cell coordinate in data space: col/row are 0-based data indices (marker columns excluded). */
export type CellCoord = { col: number; row: number };

/**
 * Marker column mode: a pinned-left column rendered BEFORE all data columns, outside the data
 * column index space (CellCoord.col / aria-colindex / aria-colcount are all untouched by it).
 * `'number'` shows the 1-based view row index; `'checkbox'` drives the rows selection channel;
 * `'both'` shows the number, replaced by the checkbox on hover/selected (group-hover pattern).
 */
export type RowMarkersMode = "none" | "number" | "checkbox" | "both";

/** Rectangular cell region, half-open on the far edge (a cell c is inside if x <= c < x + width). */
export type GridRect = { x: number; y: number; width: number; height: number };

/**
 * Selection model (see research/glide-behavior-spec.md §1).
 * `cell` is the anchor (Excel's white cell) and is always inside `range`.
 * `rangeStack` holds additional rectangles from ctrl-click multi-range; never contains `range`.
 * `rows`/`columns` are whole-row/column selection channels, distinct from `current`.
 */
export type GridSelection = {
  current: {
    cell: CellCoord;
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
  hasAll(range: [number, number]): boolean;
  toArray(): number[];
};

/**
 * Selection-gesture configuration (PLAN §3 "Selection configurability"). All default `true`.
 * Disabling a channel removes both its gestures (header/marker click, drag) AND its selection
 * channel: e.g. `enableColumnSelection: false` makes header clicks a no-op, not just un-rendered.
 */
export type SelectionConfig = {
  enableRowSelection: boolean;
  enableColumnSelection: boolean;
  enableRangeSelection: boolean;
  enableMultiRange: boolean;
};

/** One data mutation. Ops are id-keyed so history survives sort/filter (never index-keyed). */
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
  | { type: "delete"; rowId: string; row: TData; index: number };

/** One user gesture = one batch (a paste, a fill, a delete-range is a single entry). */
export type DataChange<TData> = {
  ops: DataOp<TData>[];
  /**
   * Origin of the change, for history labeling and consumer filtering. `"stream"` tags a
   * `updateCells`/`updateRows` batch; `useDataGridHistory` drops it by default, because a
   * 100-updates/s feed would evict the user's whole undo stack in seconds. `"app"` tags an
   * imperative `record()` entry (a programmatic change the consumer applied itself).
   */
  source: "edit" | "paste" | "fill" | "delete" | "row-op" | "import" | "history" | "stream" | "app";
  /** Optional human-readable label for this entry (e.g. "Batch save rollback"); carried through the undo/redo stack as-is. */
  label?: string;
};

export type CellRenderProps<TData, TValue> = {
  /** The resolved cell value (through the column's `accessorKey`/`accessorFn`). */
  value: TValue;
  /** The full data row this cell belongs to. */
  row: TData;
  /** Display (view-space) row index: the sorted/filtered position, matching what the user sees. NOT a stable index into `data` — it reshuffles under sort and filter. Use `getRowId` for stable row identity. */
  rowIndex: number;
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
  // `column`'s own validate erases independently (3rd param `any`) so THIS type's bivariance
  // (recovered via CellClassNameFnHolder below) doesn't get re-poisoned by validate's union when
  // TValue itself is erased to `unknown` at the array-common-type boundary — see types.ts's
  // ColumnDef.validate doc and store.tsx's AnyColumnDef doc for the full reasoning.
  column: ColumnDef<TData, TValue, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Display (view-space) row index — the sorted/filtered position, matching what the user sees. */
  viewRowIndex: number;
};

/**
 * Grid-level row class callback (PLAN §6 "Programmatic style API"); merged via `cn()` after the
 * built-in row classes. `viewRowIndex` is the display (sorted/filtered) position. Pass a stable
 * function identity (module scope, or memoized) — like `columns`/`data`, its identity is a dev-mode
 * guardrail (unstable identity defeats row memoization) rather than a fresh per-render prop.
 */
export type GetRowClassName<TData> = (row: TData, viewRowIndex: number) => string | undefined;

/** Grid-level cell class callback; same stable-identity guidance as {@link GetRowClassName}. */
export type GetCellClassName<TData> = (ctx: CellClassNameCtx<TData, unknown>) => string | undefined;

/** Context passed to `onCellClick`. Same shape as {@link CellClassNameCtx} plus the column's real index (not just its view row). */
export type CellClickCtx<TData, TValue> = {
  value: TValue;
  row: TData;
  column: ColumnDef<TData, TValue>;
  /** Display (view-space) row index — matches {@link CellClassNameCtx.viewRowIndex}. */
  rowIndex: number;
  /** Data-column index (not the marker column) — matches `CellCoord.col`. */
  columnIndex: number;
};

/**
 * Fired on a plain click on any non-skeleton, non-pinned-row cell — attached to the cell's own
 * existing DOM click handler (no new subscription; see events-state.mdx). Fires alongside
 * whatever the click already does (select the cell, toggle a checkbox) — it's a pure
 * notification, never a veto point (contrast `onFillPattern`'s `preventDefault()`).
 */
export type OnCellClick<TData> = (ctx: CellClickCtx<TData, unknown>, event: MouseEvent) => void;

/** Context passed to `onRowClick` — the row is display-index only; map to a stable id via `getRowId` yourself if you need one. */
export type RowClickCtx<TData> = {
  row: TData;
  /** Display (view-space) row index — matches {@link CellClassNameCtx.viewRowIndex}. */
  rowIndex: number;
};

/** Same firing site as {@link OnCellClick}, once per click regardless of which column was clicked. */
export type OnRowClick<TData> = (ctx: RowClickCtx<TData>, event: MouseEvent) => void;

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
 * Editor contract, in order: the editor holds its own draft text; `onChange(value)` stashes the
 * CURRENT draft into the grid (this is the only way a value reaches the store); `commit()`
 * validates and applies whatever `onChange` last stashed, then closes the editor and moves the
 * active cell. Calling `commit()` without an `onChange` since the editor opened commits the OLD
 * value (the stash is seeded from it at editor-open, never from your local state); calling
 * `onChange` and never `commit` leaves the edit stranded. `cancel()` discards everything. The
 * built-in editors' `commitText(movement)` helper shows the canonical order: guard, `onChange`,
 * `commit`.
 */
export type CellEditorProps<TData, TValue> = {
  /** The last-COMMITTED value, as it was when the editor opened (seed for your initial draft). NOT your in-progress draft — that lives in your editor's local state. */
  value: TValue;
  /** Initial text seed when editing started by typing (type-to-replace); undefined for Enter/F2. */
  initialText?: string;
  /** The full data row this cell belongs to. */
  row: TData;
  // `column`'s own validate erases independently (3rd param `any`) — same reasoning as
  // CellRenderProps.column above.
  column: ColumnDef<TData, TValue, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Stash the current draft. Takes effect on the next `commit` — it never writes the store by itself. */
  onChange: (value: TValue) => void;
  /** Validate and apply the last stashed value, close the editor, and move the active cell by the given delta (Enter = {0,1}, blur/click-away = {0,0}). */
  commit: (movement?: { dx: number; dy: number }) => void;
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
 * delete, and import/export (see research/react-datasheet-grid-study.md §8). The pipelines read
 * the value through DIFFERENT surfaces, so one override does not reach all of them:
 *
 * - display (the cell's rendered text) = `toDisplayText` when present, else `toText`.
 * - clipboard copy and export = `toText`, always.
 * - sort = `compare` when the column declares this type, else a numeric-aware locale collation of
 *   the RAW `String(value)` — not of `toText` output.
 * - search and filter = `String(rawValue)`: the view pipeline is built WITHOUT cellTypes, so a
 *   custom `toText` never changes what search or filter see (a `select` column searches the
 *   stored VALUE, not the displayed label; a `number` with `decimals` searches the unrounded
 *   value; a `date` with a `displayFormat` matches the ISO string).
 * - fill (series inference) works on the raw value, not on any text form.
 */
export type CellType<TData = unknown, TValue = unknown, TOptions = unknown> = {
  Cell: FC<CellRenderProps<TData, TValue>>;
  Editor: FC<CellEditorProps<TData, TValue>>;
  /** Serialize for clipboard/export. Search and filter do NOT use this — they match on the raw `String(value)`. */
  toText(value: TValue, options?: TOptions): string;
  /** Optional display-only rendering (e.g. locale-formatted dates); the cell renders `toDisplayText ?? toText`. Clipboard/export always use `toText`. */
  toDisplayText?(value: TValue, options?: TOptions): string;
  /** Parse from paste/import/typing. Must never throw; return clearValue()'s result for garbage. */
  fromText(text: string, options?: TOptions): TValue;
  clearValue(options?: TOptions): TValue;
  isEmpty(value: TValue): boolean;
  /** Sort comparator for this type; when absent, sorting falls back to a numeric-aware locale collation of the raw `String(value)` — not of `toText` output. */
  compare?(a: TValue, b: TValue): number;
  align?: "left" | "right" | "center";
};

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
  /**
   * String headers render truncated and get the built-in sort-direction arrow in `sort`
   * header-click mode; a ReactNode header renders as-is and owns its own display (the built-in
   * arrow is NOT appended — embed DataGridSortIndicator inside it when you still want it).
   */
  header: string | ReactNode;
  /** Plain-text header for clipboard/export when `header` is a ReactNode. */
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
  /** Cell type registry key; default "text". */
  type?: string;
  options?: unknown;
  readOnly?: boolean | ((row: TData) => boolean);
  /**
   * Rejects a value: the function form returns an error message (`null` accepts), or any
   * `StandardSchemaV1` for `TValue` (Zod/Valibot/ArkType/...) — detected at the call site via
   * `"~standard" in validate`. A schema's `validate` may resolve async; only the single-cell
   * editor commit path awaits it (see cell.tsx/use-commit-guard.ts), bulk paths (paste/fill/
   * import) treat a Promise result as unsupported and skip validation for that cell (dev warn).
   * On success the COMMITTED value is `result.value` (schemas may transform), documented in
   * editing-cell-types.mdx.
   * `TValidate` (not `TValue` directly): a union of a function type and a non-callable schema
   * object, as a plain property, is checked contravariantly as a WHOLE — unlike a pure
   * method-shorthand function, TS can't special-case just the function branch bivariant anymore.
   * That would break `defineColumns`' narrow-`TValue` columns widening into the shared
   * `ColumnDef<TData, unknown>` array every consumer prop uses (verified: it also cascades to
   * OTHER unrelated method-shorthand fields like `renderCell` in the same array literal — TS's
   * structural check on the whole object type gets stricter once ANY sibling property stops being
   * bivariant). Giving `validate` its own type parameter keeps that widening exact (`TValue` never
   * becomes incompatible) while only `TValidate` erases at the store boundary — a documented,
   * narrow, single-field cast (see `AnyColumnDef`), not a project-wide `any`.
   */
  validate?: ((value: TValidate, row: TData) => string | null) | StandardSchemaV1<TValidate>;
  /**
   * What a `validate` rejection does in a single-cell commit. `"block"` (default): the commit is
   * refused — the editor stays open with the message and the value never enters `data`. `"warn"`:
   * the value commits and the cell is flagged in `cellErrors` (same ring/tint/tooltip as server
   * errors, auto-cleared by the next valid commit of that cell). A rejection carries no
   * transformed value, so `"warn"` commits the RAW value; per-row softness is expressed inside the
   * function form via its `row` argument (return `null` to skip the rule for that row). Bulk paths
   * (paste/fill/updateCells) still drop rejected cells even for `"warn"` columns.
   * ponytail: soft bulk commits would need `onInvalid` threaded through resolveBulkWrites/
   * computeCellPatchBatch/prevalidatePatches — add when a soft paste/fill is actually wanted.
   */
  onInvalid?: "block" | "warn";
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  /**
   * Proportional share of leftover viewport width. Columns with flex grow from their base
   * `width` to fill positive leftover space; clamped by `maxWidth`. A manual resize fixes the
   * column and removes it from flex distribution.
   */
  flex?: number;
  /** Initial pin direction; change it at runtime through `setColumnPin` or the context menu. Pinned columns only reorder within their own pin zone. */
  pin?: "left" | "right";
  /** Removes the column from click-to-sort (header clicks no longer sort it); programmatic `setSorts`/`toggleSort` still apply. Default true. */
  sortable?: boolean;
  /** Excludes the column from the filter menu's column picker. Existing filter specs on it keep applying. Default true. */
  filterable?: boolean;
  /** Initial visibility; toggle at runtime through `setColumnHidden` or the columns menu. */
  hidden?: boolean;
  /** Disables the resize handle for this column; default true. */
  resizable?: boolean;
  /** Disables drag-to-reorder for this column; default true. */
  reorderable?: boolean;
  /** Disables pin/unpin for this column; default true. */
  pinnable?: boolean;
  /** Display-only override that keeps the column's type pipeline; method-shorthand for the same bivariance reason as `validate`. */
  renderCell?(props: CellRenderProps<TData, TValue>): ReactNode;
  /**
   * Per-column cell class, merged via `cn()` after the built-in cell classes (PLAN §6 "Programmatic
   * style API") so it wins on conflicting utilities. A plain string applies to every cell in the
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
 * How a plain header click behaves (PLAN §3 item 4). `'select'` (default) selects the whole
 * column, matching the marker/row-selection model. `'sort'` cycles asc->desc->none on the
 * clicked column instead (shift+click adds it to a multi-sort); `'none'` disables both.
 */
export type HeaderClickBehavior = "select" | "sort" | "none";

export type SortSpec = { columnId: string; direction: "asc" | "desc" };

export type FilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "empty"
  | "notEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "isBetween"
  | "isAnyOf";

/** Combines multiple `FilterSpec`s: `"and"` (default) requires every filter to match, `"or"` requires any one. */
export type FilterJoinOperator = "and" | "or";

/**
 * `value` is a single string for most operators. `isBetween` carries an inclusive `[min, max]`
 * tuple (either bound may be `""` for an open-ended range); `isAnyOf` carries a `string[]` of
 * accepted values and matches when the cell text equals any of them. `filterId` is a stable
 * identity for list rendering/updates independent of array position (multiple filter rows on the
 * same column are allowed and meaningful under `"or"`/mixed joins); optional at the input boundary
 * for backward compatibility — the store auto-assigns one when absent (see `genFilterId`).
 */
export type FilterSpec = { filterId?: string; columnId: string; operator: FilterOperator; value?: string | [string, string] | string[] };

/**
 * Named keyboard actions; bindings map keys to these (see `DEFAULT_KEYMAP` in
 * `keyboard/default-keymap.ts`). `editReplace` (type-to-replace) has no `DEFAULT_KEYMAP` binding:
 * by default any unbound printable key on an active cell dispatches it (Excel behavior, starting
 * an edit seeded with the typed char). Defining `keymap.editReplace` takes the action over
 * exclusively — `["F3"]` remaps the trigger (plain edit start, no char seed); `[]` disables it.
 */
export type GridAction =
  | "moveUp" | "moveDown" | "moveLeft" | "moveRight"
  | "retainMoveUp" | "retainMoveDown" | "retainMoveLeft" | "retainMoveRight"
  | "scrollActiveIntoView"
  | "moveRowStart" | "moveRowEnd"
  | "jumpUp" | "jumpDown" | "jumpLeft" | "jumpRight"
  | "moveFirstCell" | "moveLastCell"
  | "pageUp" | "pageDown"
  | "extendUp" | "extendDown" | "extendLeft" | "extendRight"
  | "extendJumpUp" | "extendJumpDown" | "extendJumpLeft" | "extendJumpRight"
  | "extendFirstCell" | "extendLastCell"
  | "selectRow" | "selectColumn" | "selectAll"
  | "edit" | "editReplace" | "commitDown" | "commitUp" | "commitRight" | "commitLeft"
  | "cancel" | "deleteContents"
  | "undo" | "redo"
  | "fillDown" | "fillRight"
  | "insertRowBelow" | "duplicateRow";

/**
 * Key binding string: `mod` = Ctrl (win/linux) / Cmd (mac), `ctrl` = the LITERAL physical Ctrl key
 * on every platform (it bypasses `mod` resolution), plus `shift`, `alt`.
 * Format: "mod+shift+ArrowUp", key is `KeyboardEvent.key`. Multiple bindings per action allowed.
 * Keep `ctrl` where `DEFAULT_KEYMAP` uses it (`ctrl+ ` for selectColumn): `mod+ ` on macOS is
 * Cmd+Space, which the OS intercepts (Spotlight), so the binding would be dead there.
 */
export type Keymap = Partial<Record<GridAction, string[]>>;

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
 * `cellTypes` object checks its five built-ins against a literal
 * `BuiltinCellTypeKey` union, decoupled from this interface, so augmenting it
 * with a new key never breaks that file's compile.
 */
export interface GridCellTypes {
  text: { value: string; options: { placeholder?: string } };
  number: {
    value: number | null;
    options: {
      min?: number;
      max?: number;
      /** @reserved — accepted but a no-op for now: stepping is editor-keyboard behavior and gets decided after P4 lands; do not rely on it. */
      step?: number;
      decimals?: number;
    };
  };
  checkbox: { value: boolean; options: object };
  select: {
    value: string | null;
    options: { choices: readonly { value: string; label: string }[] };
  };
  date: {
    value: string | null;
    /** `locale` defaults to `"en-US"` — an explicit default keeps SSR and client HTML identical. */
    options: { min?: string; max?: string; displayFormat?: Intl.DateTimeFormatOptions; locale?: string };
  };
}

/**
 * Plain JSON-serializable snapshot of a grid's column layout (widths/order/pins/hidden) — the save
 * payload for `onColumnLayoutChange`/`defaultColumnLayout` (PLAN events-state gap fix 1). `widths`
 * holds only columns the user has actually resized (a def's own `width` isn't duplicated in here);
 * `order` is always the full current column-id order, not just the moved one.
 */
export type ColumnLayout = {
  widths: Record<string, number>;
  order: string[];
  pins: Record<string, "left" | "right">;
  hidden: string[];
};

/** Registered cell-type keys (built-in + consumer-augmented). */
export type CellTypeKey = keyof GridCellTypes;

/** Value type for a given cell-type key. */
export type CellValueOf<K extends CellTypeKey> = GridCellTypes[K]["value"];

/** Options type for a given cell-type key. */
export type CellOptionsOf<K extends CellTypeKey> = GridCellTypes[K]["options"];
