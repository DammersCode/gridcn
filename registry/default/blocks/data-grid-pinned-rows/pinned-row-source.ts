import type { AggregateSpecs, UseDataGridAggregateOptions } from "./use-data-grid-aggregate";
import type { UseDataGridServerAggregateOptions } from "./use-data-grid-server-aggregate";

/** Options of {@link aggregateRow}. */
export type AggregateRowOptions = UseDataGridAggregateOptions & {
  /** Fixed cell values by column id, such as the row id and a label. Aggregated values replace a cell of the same column id. */
  cells?: Record<string, unknown>;
};

/** Options of {@link serverAggregateRow}. */
export type ServerAggregateRowOptions = UseDataGridServerAggregateOptions & {
  /** Fixed cell values by column id, such as the row id and a label. Fetched values replace a cell of the same column id. */
  cells?: Record<string, unknown>;
  /** `"settled"` (default) fetches again once every save in flight has settled. `false` never does; call `refresh()` on a {@link DataGridServerAggregateReporter} yourself. */
  refreshAfterSave?: false | "settled";
};

/** A pinned row whose values the band computes inside the grid. Build one with {@link aggregateRow} or {@link serverAggregateRow}. */
export type PinnedRowSource =
  | Readonly<{ kind: "aggregate"; specs: AggregateSpecs<never>; scope: NonNullable<UseDataGridAggregateOptions["scope"]>; cells: Readonly<Record<string, unknown>> | undefined }>
  | Readonly<{ kind: "server-aggregate"; options: ServerAggregateRowOptions; cells: Readonly<Record<string, unknown>> | undefined }>;

const SOURCES = new WeakSet<object>();

function register<T extends PinnedRowSource>(source: T): T {
  Object.freeze(source);
  SOURCES.add(source);
  return source;
}

/** True for a value built by {@link aggregateRow} or {@link serverAggregateRow}. */
export function isPinnedRowSource(value: unknown): value is PinnedRowSource {
  return typeof value === "object" && value !== null && SOURCES.has(value);
}

/**
 * A pinned totals row that reduces `specs` over the grid's rows (see {@link useDataGridAggregate}). Put it in
 * `useDataGridPinnedRows`'s `topRows` or `bottomRows`. The band reads each value by column id, so it needs no
 * `accessorKey` that matches the id. Create it once, at module scope.
 */
export function aggregateRow<TData = unknown>(specs: AggregateSpecs<TData>, options: AggregateRowOptions = {}): PinnedRowSource {
  const { scope = "view", cells } = options;
  // Boundary cast: the source keeps specs for any row type; the band hands them back to the aggregate engine untouched.
  return register({ kind: "aggregate", specs: specs as AggregateSpecs<never>, scope, cells: cells && Object.freeze({ ...cells }) });
}

/**
 * A pinned totals row whose values come from a server (see {@link useDataGridServerAggregate}). Put it in one band
 * of `useDataGridPinnedRows`. The band dims while values load, and fetches again after pending saves settle.
 * Create it once, at module scope.
 */
export function serverAggregateRow(options: ServerAggregateRowOptions): PinnedRowSource {
  const { cells, ...rest } = options;
  return register({ kind: "server-aggregate", options: rest, cells: cells && Object.freeze({ ...cells }) });
}
