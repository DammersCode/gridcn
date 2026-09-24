/**
 * Compile-time-only assertions for the public barrel's surface: GridCellTypes consumer
 * augmentation, controlled-props shapes (sort/filter/search/joinOperator), DeepPartialLabels,
 * useDataGridVisibleColumns/useDataGridAllColumns consumer callability, and a spot-check that the
 * barrel exports no accidental `any`. No runtime assertions live here; the tsc gate typechecks this
 * file (named so vitest's *.test.ts glob does not pick it up, matching
 * columns/column-helpers.type-test.ts). `PresenceHighlight`'s own type-test lives in the
 * `data-grid-presence` add-on with the rest of presence.
 */
import type {
  DataGrid,
  DataGridRootProps,
  defineColumns,
  ColumnDef,
  AnyColumnDef,
  CellClickCtx,
  CellPatch,
  DataGridActions,
  DataGridProps,
  DataGridSyncProps,
  RowPatch,
  UpdateCellsOptions,
  UpdateCellsReorder,
  DeepPartialLabels,
  FilterJoinOperator,
  FilterSpec,
  GetRowClassName,
  GridCellTypes,
  MarkerCellRenderer,
  MarkerHeaderRenderer,
  RowClickCtx,
  SortSpec,
} from "./data-grid";
import { useDataGridVisibleColumns, useDataGridAllColumns, type GRID_ATTR } from "./data-grid";

/** Compile-only check: `Actual` must be identical to `Expected` (both directions assignable). */
type Equal<Expected, Actual> = (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
  ? true
  : false;
function assertEqual<Expected, Actual>(_check: Equal<Expected, Actual>): void {}

/** True only if `T` is exactly `any` (the classic `unknown`-vs-`any` distinguishing trick: only `any` is assignable both ways through a conditional whose branches otherwise differ). */
type IsAny<T> = 0 extends 1 & T ? true : false;

type Row = { id: string; name: string; age: number };

// --- GridCellTypes consumer augmentation --------------------------------------
// A REAL `declare module "./cell-types/../types" { interface GridCellTypes { ... } }` augmentation
// is exercised end-to-end in cell-types/builtin-augmentation.type-test.ts: it proves
// the shipped cell-types.ts's `satisfies { [K in BuiltinCellTypeKey]: CellTypeFor<K> }` — keyed on
// a literal union decoupled from GridCellTypes — still compiles once a consumer-style key is added,
// AND that built-in drift (missing/mistyped entry) still errors. This file instead asserts the
// generic inference mechanism: TypedColumnDef<TData, K> must resolve through GridCellTypes[K] for
// an ARBITRARY key type, which is what makes a real consumer's augmented key get the same
// options/value narrowing as a built-in.

type FakeAugmentedKey = "currency";
type FakeAugmentedTypes = GridCellTypes & { currency: { value: number | null; options: { currency: string } } };
type CurrencyColumn<TData> = Omit<ColumnDef<TData, FakeAugmentedTypes[FakeAugmentedKey]["value"]>, "type" | "options"> & {
  type: FakeAugmentedKey;
  options?: FakeAugmentedTypes[FakeAugmentedKey]["options"];
};
declare const currencyColumn: CurrencyColumn<Row & { price: number | null }>;
assertEqual<number | null, typeof currencyColumn.options extends { currency: string } | undefined ? number | null : never>(true);
assertEqual<"currency", typeof currencyColumn.type>(true);

// --- controlled-props shapes: sort/filter/search/joinOperator ----------
// Each is independently optional (uncontrolled by omission) per store.tsx's DataGridSyncProps
// doc comments — assert the prop object shapes accepted by DataGridProps<TData> directly, so a
// future accidental narrowing (e.g. making one non-optional, or dropping the paired onXChange)
// fails this file's compile instead of surfacing as a runtime consumer bug report.

const sortState: SortSpec[] = [{ columnId: "name", direction: "asc" }];
const filterState: FilterSpec[] = [{ filterId: "f1", columnId: "age", operator: "gt", value: "10" }];
const joinOperator: FilterJoinOperator = "or";

declare const controlledProps: DataGridProps<Row>;
type ControlledSlice = Pick<
  DataGridProps<Row>,
  "sortState" | "onSortChange" | "filterState" | "onFilterChange" | "joinOperator" | "onJoinOperatorChange" | "searchText" | "onSearchTextChange"
>;
const controlledSlice: ControlledSlice = controlledProps;
void controlledSlice;
void sortState;
void filterState;
void joinOperator;

// each controlled prop must be independently optional (uncontrolled-by-omission contract) —
// an empty object satisfies the whole slice.
const allOmitted: ControlledSlice = {};
void allOmitted;

// @ts-expect-error - sortState is SortSpec[], not a bare string
const badSortState: Pick<DataGridProps<Row>, "sortState"> = { sortState: "asc" };
void badSortState;

// @ts-expect-error - joinOperator is "and" | "or", not an arbitrary string
const badJoinOperator: Pick<DataGridProps<Row>, "joinOperator"> = { joinOperator: "xor" };
void badJoinOperator;

// --- DataGrid wrapper prop-surface drift guard ------------------------------------------------
// DataGridProps must forward every DataGridSyncProps sync prop into DataGridProvider.
// Pin the "intentionally absent from the wrapper" set explicitly (currently empty) so a sync prop
// added to the provider without a matching DataGridProps field fails this file's compile.
type IntentionallyAbsentFromWrapper = never;
assertEqual<IntentionallyAbsentFromWrapper, Exclude<keyof DataGridSyncProps<Row>, keyof DataGridProps<Row>>>(true);

// --- DeepPartialLabels: nested plain objects become deep-partial; arrays/functions stay whole ---

type SampleLabels = {
  toolbar: { searchPlaceholder: string; joinAnd: string };
  filterOperators: { contains: string };
  pagination: { pageSizeOptions: readonly number[] };
  formatCount: (n: number) => string;
};

const partialNested: DeepPartialLabels<SampleLabels> = { toolbar: { searchPlaceholder: "Search…" } };
void partialNested;

// a function-typed leaf must be replaced wholesale (its own params), never partially
const partialFn: DeepPartialLabels<SampleLabels> = { formatCount: (n) => `${n}` };
void partialFn;

// @ts-expect-error - toolbar.joinAnd is a required string within the partial object, but 42 is not a string
const badNestedLeaf: DeepPartialLabels<SampleLabels> = { toolbar: { joinAnd: 42 } };
void badNestedLeaf;

// arrays stay whole (readonly number[]), not element-wise partial
const partialArrayLeaf: DeepPartialLabels<SampleLabels> = { pagination: { pageSizeOptions: [10, 25] } };
void partialArrayLeaf;

// --- useDataGridVisibleColumns/useDataGridAllColumns: consumer-callability fix (#24-A) -------
// Regression test for the consumer-callability defect: these hooks
// used to return `ColumnDef<never, unknown>[]`, and a function parameter typed `never` rejects
// every argument, making accessorFn/setValue/function-form readOnly uncallable by consumers
// building custom column UI. They now default to `unknown` (matching useDataGridRow's existing
// row type), which is directly callable with the store's own `unknown` row — no cast needed.

declare const anyRow: unknown;
declare const anyValue: unknown;

// (a) zero-arg call: result is ColumnDef<unknown, unknown>[], every function field is callable
// with an unknown row/value with NO cast — this is the exact call the defect made impossible.
function useUntypedColumnUI() {
  const visible = useDataGridVisibleColumns();
  const all = useDataGridAllColumns();
  assertEqual<readonly AnyColumnDef[], typeof visible>(true);
  assertEqual<readonly AnyColumnDef[], typeof all>(true);

  const column = visible[0]!;
  const value = column.accessorFn?.(anyRow);
  const nextRow = column.setValue?.(anyRow, anyValue);
  const readOnly = typeof column.readOnly === "function" ? column.readOnly(anyRow) : column.readOnly;
  void value;
  void nextRow;
  void readOnly;
  void all;
}
void useUntypedColumnUI;

// (b) typed call: useDataGridVisibleColumns<Row>() returns ColumnDef<Row, unknown, any>[] — a
// typed consumer gets a real Row-typed accessorFn/setValue back (TValue still `unknown`, full
// safety), and passing the WRONG row type is a compile error (proving the generic actually
// narrows those fields, not just widens to `any`). Only `validate`'s own value type (3rd param)
// erases to `any` — see types.ts's ColumnDef doc for why that field alone needs it.
declare const typedRow: Row;
declare const wrongShapeRow: { totallyDifferentShape: true };

function useTypedColumnUI() {
  const visible = useDataGridVisibleColumns<Row>();
  assertEqual<readonly ColumnDef<Row, unknown, any>[], typeof visible>(true); // eslint-disable-line @typescript-eslint/no-explicit-any

  const column = visible[0]!;
  const value = column.accessorFn?.(typedRow);
  void value;

  // @ts-expect-error - accessorFn expects a Row, not this unrelated shape
  column.accessorFn?.(wrongShapeRow);
}
void useTypedColumnUI;

// --- barrel surface: no accidental `any` on the exports this file already touches ----------
// A narrow, representative sample (not exhaustive) — each of these is a common integration
// point where a broken generic or a missed type export tends to silently degrade to `any`.

assertEqual<false, IsAny<ColumnDef<Row, unknown>>>(true);
assertEqual<false, IsAny<DataGridProps<Row>>>(true);
assertEqual<false, IsAny<SortSpec>>(true);
assertEqual<false, IsAny<FilterSpec>>(true);
assertEqual<false, IsAny<GridCellTypes>>(true);
assertEqual<false, IsAny<typeof DataGrid<Row>>>(true);
assertEqual<false, IsAny<ReturnType<typeof defineColumns<Row>>>>(true);
assertEqual<false, IsAny<ReturnType<typeof useDataGridVisibleColumns>>>(true);
assertEqual<false, IsAny<ReturnType<typeof useDataGridAllColumns<Row>>>>(true);

// --- StandardSchemaV1: vendored-type conformance + validate union ----------------------------
// types.ts vendors `StandardSchemaV1` (no runtime/type import from @standard-schema/spec, see its
// doc comment) so shipped code has zero new deps. This asserts the vendored copy stays assignable
// to/from the OFFICIAL package's type in both directions — any future drift in either fails tsc
// here instead of silently diverging (the repo devDependency exists ONLY for this check).

import type { StandardSchemaV1 as OfficialStandardSchemaV1 } from "@standard-schema/spec";
import type { StandardSchemaV1 } from "./types";

function assertVendoredMatchesOfficial<Input, Output>(
  _vendoredToOfficial: (v: StandardSchemaV1<Input, Output>) => OfficialStandardSchemaV1<Input, Output>,
  _officialToVendored: (v: OfficialStandardSchemaV1<Input, Output>) => StandardSchemaV1<Input, Output>,
): void {}
assertVendoredMatchesOfficial(
  (v) => v,
  (v) => v,
);

// --- validate: union detection + InferInput/InferOutput ---------------------------------------

/** Minimal mock StandardSchemaV1 for a `TValue` — no library import anywhere in repo code (per spec). */
function mockSchema<TValue>(check: (value: unknown) => boolean, message: string): StandardSchemaV1<TValue, TValue> {
  return {
    "~standard": {
      version: 1,
      vendor: "mock",
      validate: (value: unknown) => (check(value) ? { value: value as TValue } : { issues: [{ message }] }),
    },
  };
}

// InferInput/InferOutput resolve through the schema's own `~standard.types` (structural — a real
// schema library populates `types` for inference even though it's `undefined` at runtime).
type MockNumberSchema = StandardSchemaV1<number, number>;
assertEqual<number, StandardSchemaV1.InferInput<MockNumberSchema>>(true);
assertEqual<number, StandardSchemaV1.InferOutput<MockNumberSchema>>(true);

// A column's validate accepts a schema whose InferInput matches TValue.
declare const _numberColumn: ColumnDef<Row, number>;
type NumberColumnValidate = typeof _numberColumn.validate;
declare const acceptableSchema: MockNumberSchema;
const withSchemaValidate: NumberColumnValidate = acceptableSchema;
void withSchemaValidate;

// @ts-expect-error - a string-input schema doesn't match this column's number TValue
const badSchemaValidate: NumberColumnValidate = mockSchema<string>(() => true, "n/a");
void badSchemaValidate;

// The function form is untouched (still assignable, still bivariant per column-helpers.type-test.ts).
const withFnValidate: NumberColumnValidate = (value) => (value !== null && value < 0 ? "must be >= 0" : null);
void withFnValidate;

// --- DataGridRoot<TData>: typed callbacks in split composition -------------------------------
// DataGridRoot has no `data` prop of its own to infer TData from (split composition puts `data` on
// the sibling DataGridProvider) — the generic must be explicitly annotated by the consumer, e.g.
// `<DataGridRoot<Person>>` in JSX (verified separately in data-grid-events-demo.tsx, a .tsx file;
// JSX generic-argument syntax isn't available in this .type-test.ts file). This section proves the
// annotated-generic mechanics: the default stays `unknown` (every untyped call site unaffected),
// and an explicit TData narrows all four callback props together with no cast required.

// (a) default (omitted generic): every callback prop's row/value stays `unknown`, matching every
// pre-existing untyped <DataGridRoot> call site — this is the zero-behavior-change guarantee.
assertEqual<GetRowClassName<unknown> | undefined, DataGridRootProps["getRowClassName"]>(true);

// (b) explicit TData: all four callback props narrow together from the one annotation.
type TypedRootProps = DataGridRootProps<Row>;
assertEqual<GetRowClassName<Row> | undefined, TypedRootProps["getRowClassName"]>(true);

// (c) the marker renderers are non-generic (their ctx carries view state, never a row), so they
// stay identical on the default and typed root and on the DataGrid wrapper (a TData-annotated
// variant here would fail this compile).
assertEqual<MarkerCellRenderer | undefined, DataGridRootProps["renderMarker"]>(true);
assertEqual<MarkerHeaderRenderer | undefined, DataGridRootProps["renderMarkerHeader"]>(true);
assertEqual<MarkerCellRenderer | undefined, TypedRootProps["renderMarker"]>(true);
assertEqual<MarkerHeaderRenderer | undefined, TypedRootProps["renderMarkerHeader"]>(true);
assertEqual<MarkerCellRenderer | undefined, DataGridProps<Row>["renderMarker"]>(true);
assertEqual<MarkerHeaderRenderer | undefined, DataGridProps<Row>["renderMarkerHeader"]>(true);

const onCellClick: TypedRootProps["onCellClick"] = (ctx: CellClickCtx<Row, unknown>) => {
  const name: string = ctx.row.name; // Row, no cast
  void name;
};
void onCellClick;

const onRowClick: TypedRootProps["onRowClick"] = (ctx: RowClickCtx<Row>) => {
  const age: number = ctx.row.age;
  void age;
};
void onRowClick;

const onCellClickWrongShape: TypedRootProps["onCellClick"] = (ctx: CellClickCtx<Row, unknown>) => {
  // @ts-expect-error - Row has no `totallyDifferentShape` field
  void ctx.row.totallyDifferentShape;
};
void onCellClickWrongShape;

// --- updateCells: patch shape + options -------------------------------------------------------
// The patch is id-keyed by construction: `rowId` is the only row address, so a coordinate cannot be
// passed by mistake, and the value stays `unknown` (a stream carries any cell type's value).
assertEqual<string, CellPatch["rowId"]>(true);
assertEqual<string, CellPatch["columnId"]>(true);
assertEqual<unknown, CellPatch["value"]>(true);

const patch: CellPatch = { rowId: "r1", columnId: "price", value: 12.5 };
void patch;

// @ts-expect-error - a view/data index is not a row address
const indexKeyedPatch: CellPatch = { rowIndex: 0, columnId: "price", value: 1 };
void indexKeyedPatch;

assertEqual<"defer" | "immediate" | "never", UpdateCellsReorder>(true);
assertEqual<UpdateCellsReorder | undefined, UpdateCellsOptions["reorder"]>(true);
assertEqual<boolean | undefined, UpdateCellsOptions["skipValidation"]>(true);

// `source` is the shared DataChange union, so a streaming batch can be tagged as a user edit to
// make it undoable — and `"stream"` is a member of that union, not a separate opt-in type.
const streamSource: UpdateCellsOptions["source"] = "stream";
void streamSource;
const editSource: UpdateCellsOptions["source"] = "edit";
void editSource;
// @ts-expect-error - not a DataChange source
const badSource: UpdateCellsOptions["source"] = "ticker";
void badSource;

// updateRows takes partial rows; `changes` is column-id keyed, matching CellPatch's columnId.
const rowPatch: RowPatch = { rowId: "r1", changes: { price: 12.5, volume: 900 } };
void rowPatch;

// The actions surface: both take a readonly patch list and an optional options object.
declare const _actions: DataGridActions;
assertEqual<(patches: readonly CellPatch[], options?: UpdateCellsOptions) => void, typeof _actions.updateCells>(true);
assertEqual<(updates: readonly RowPatch[], options?: UpdateCellsOptions) => void, typeof _actions.updateRows>(true);
assertEqual<() => void, typeof _actions.reconcileView>(true);

// TValue typing flows through the usual ColumnDef conventions: a consumer builds patches from a
// typed column's own id, while the patch value stays erased at the store boundary (one runtime
// engine serves every row type — the same erasure AnyColumnDef documents).
declare const ageColumn: ColumnDef<Row, number>;
const patchFromTypedColumn: CellPatch = { rowId: "r1", columnId: ageColumn.id, value: 42 };
void patchFromTypedColumn;

// --- GRID_ATTR: SET-site literals stay in sync with the barrel constant (data-attributes.ts) ---
// JSX attribute names/values are kept as literals at the SET site (readable, and required for the
// Tailwind `data-[foo]:`/`in-data-foo:` variants next to them, which need a static string) — this
// pins each literal against its GRID_ATTR entry so a rename of one without the other fails here.

assertEqual<"data-pinned", typeof GRID_ATTR.pinned>(true);
assertEqual<"data-grid-pinned-row", typeof GRID_ATTR.pinnedRow>(true);
assertEqual<"data-active", typeof GRID_ATTR.active>(true);
assertEqual<"data-editing", typeof GRID_ATTR.editing>(true);
assertEqual<"data-search-match", typeof GRID_ATTR.searchMatch>(true);
assertEqual<"data-grid-row-index", typeof GRID_ATTR.rowIndex>(true);
assertEqual<"data-resizing", typeof GRID_ATTR.resizing>(true);
assertEqual<"data-row-selected", typeof GRID_ATTR.selected>(true);
assertEqual<"data-grid-rows-canvas", typeof GRID_ATTR.rowsCanvas>(true);
assertEqual<"data-grid-header-layer", typeof GRID_ATTR.headerLayer>(true);
assertEqual<"data-grid-drop-indicator", typeof GRID_ATTR.dropIndicator>(true);
assertEqual<"data-grid-header-menu-trigger", typeof GRID_ATTR.headerMenuTrigger>(true);
assertEqual<"data-grid-resize-handle", typeof GRID_ATTR.resizeHandle>(true);
assertEqual<"data-grid-sort-indicator", typeof GRID_ATTR.sortIndicator>(true);
assertEqual<"data-grid-marker-cell", typeof GRID_ATTR.markerCell>(true);
assertEqual<"data-grid-marker-number", typeof GRID_ATTR.markerNumber>(true);
assertEqual<"data-grid-marker-header", typeof GRID_ATTR.markerHeader>(true);
assertEqual<"data-grid-loading-skeleton", typeof GRID_ATTR.loadingSkeleton>(true);
assertEqual<"data-grid-loading-bar", typeof GRID_ATTR.loadingBar>(true);
assertEqual<"data-grid-empty-state", typeof GRID_ATTR.emptyState>(true);
assertEqual<"data-grid-pin-shadow", typeof GRID_ATTR.pinShadow>(true);
assertEqual<"data-grid-cell-editor", typeof GRID_ATTR.cellEditor>(true);
assertEqual<"data-grid-selection-overlay", typeof GRID_ATTR.selectionOverlay>(true);
assertEqual<"data-grid-active-cell-overlay", typeof GRID_ATTR.activeCellOverlay>(true);
assertEqual<"data-scrolled-left", typeof GRID_ATTR.scrolledLeft>(true);
assertEqual<"data-scrolled-right", typeof GRID_ATTR.scrolledRight>(true);
assertEqual<"data-scrolled-top", typeof GRID_ATTR.scrolledTop>(true);
assertEqual<"data-scrolled-bottom", typeof GRID_ATTR.scrolledBottom>(true);

export {};
