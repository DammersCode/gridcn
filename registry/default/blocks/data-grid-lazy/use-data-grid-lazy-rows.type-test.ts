/**
 * Compile-time-only pin of the public lazy API: `UseDataGridLazyRowsResult<TData>` member
 * signatures (gridProps/onDataChange/unloadedCount/isLoading/reset/evict/getLoadedRanges),
 * the `UseDataGridLazyRowsOptions<TData>` shape, `Range` identity (the evict param and the
 * getLoadedRanges element type), and that `gridProps` spreads onto `DataGrid`'s props. No runtime
 * assertions live here; the tsc gate typechecks this file (named so vitest's *.test.ts glob does
 * not pick it up, matching the repo's other type-test files).
 */
import type { ColumnDefOf, DataChange, DataGridProps } from "@/registry/default/blocks/data-grid/data-grid";
import type { Range, UseDataGridLazyRowsOptions, UseDataGridLazyRowsResult } from "./data-grid-lazy";

/** Compile-only check: `Actual` must be identical to `Expected` (both directions assignable). */
type Equal<Expected, Actual> = (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
  ? true
  : false;
function assertEqual<Expected, Actual>(_check: Equal<Expected, Actual>): void {}

type Row = { id: string; name: string };

// --- UseDataGridLazyRowsResult<TData> member signatures -------------------------

type LazyResult = UseDataGridLazyRowsResult<Row>;

assertEqual<(next: readonly Row[], change: DataChange<Row>) => void, LazyResult["onDataChange"]>(true);
assertEqual<number, LazyResult["unloadedCount"]>(true);
assertEqual<boolean, LazyResult["isLoading"]>(true);
assertEqual<() => void, LazyResult["reset"]>(true);
assertEqual<(range: Range) => void, LazyResult["evict"]>(true);
assertEqual<() => readonly Range[], LazyResult["getLoadedRanges"]>(true);
assertEqual<
  { data: readonly Row[]; getRowId: (row: Row, index: number) => string; onRowWindowChange: (range: Range) => void },
  LazyResult["gridProps"]
>(true);

// --- UseDataGridLazyRowsOptions<TData> shape ------------------------------------

type LazyOptions = UseDataGridLazyRowsOptions<Row>;

assertEqual<number, LazyOptions["total"]>(true);
assertEqual<(start: number, end: number, signal: AbortSignal) => Promise<Row[]>, LazyOptions["fetchRows"]>(true);
assertEqual<(row: Row, index: number) => string, LazyOptions["getRowId"]>(true);
assertEqual<number | undefined, LazyOptions["overscan"]>(true);
assertEqual<number | undefined, LazyOptions["batchSize"]>(true);
assertEqual<number | undefined, LazyOptions["maxFetchRows"]>(true);
assertEqual<((error: unknown, range: Range) => void) | undefined, LazyOptions["onError"]>(true);
assertEqual<((range: Range) => void) | undefined, LazyOptions["onLoaded"]>(true);

// --- Range identity: an object of the exported Range is exactly the evict param
// and the getLoadedRanges element type; a malformed range is rejected.

declare const lazy: LazyResult;

const range: Range = { start: 0, end: 50 };
lazy.evict(range);
const loaded = lazy.getLoadedRanges();
const first: Range = loaded[0]!;
void first;

assertEqual<Range, Parameters<LazyResult["evict"]>[0]>(true);
assertEqual<Range, ReturnType<LazyResult["getLoadedRanges"]>[number]>(true);

// @ts-expect-error - a range whose end is a string is not a Range
lazy.evict({ start: 0, end: "50" });

// --- gridProps is spreadable onto DataGrid's props (the documented integration) --

declare const columns: readonly ColumnDefOf<Row>[];
const grid: DataGridProps<Row> = { ...lazy.gridProps, columns, onDataChange: lazy.onDataChange };
void grid;

export {};
