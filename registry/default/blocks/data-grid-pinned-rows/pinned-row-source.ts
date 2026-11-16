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
};

/** A pinned row whose values the band computes inside the grid. Build one with {@link aggregateRow} or {@link serverAggregateRow}. */
export type PinnedRowSource =
  | Readonly<{ kind: "aggregate"; specs: AggregateSpecs<never>; scope: NonNullable<UseDataGridAggregateOptions["scope"]>; cells: Readonly<Record<string, unknown>> | undefined }>
  | Readonly<{ kind: "server-aggregate"; options: ServerAggregateRowOptions; cells: Readonly<Record<string, unknown>> | undefined }>;

const SOURCES = new WeakSet<object>();

/** The newest equal source of a held one, so an inline source with new function identities keeps its band and calls the newest functions. */
const LATEST_SOURCE = new WeakMap<object, PinnedRowSource>();

/** Points `held` at `next`, an equal source from a later render. */
export function forwardSource(held: PinnedRowSource, next: PinnedRowSource): void {
  if (held !== next && held.kind === next.kind) LATEST_SOURCE.set(held, next);
}

function latestOf<K extends PinnedRowSource["kind"]>(source: Extract<PinnedRowSource, { kind: K }>): Extract<PinnedRowSource, { kind: K }> {
  return (LATEST_SOURCE.get(source) as Extract<PinnedRowSource, { kind: K }> | undefined) ?? source;
}

/** The options of `source` with `fetchAggregates` and `onError` that call the newest ones. */
export function liveServerOptions(source: Extract<PinnedRowSource, { kind: "server-aggregate" }>): UseDataGridServerAggregateOptions {
  return { ...source.options, fetchAggregates: (request) => latestOf(source).options.fetchAggregates(request), onError: (error) => latestOf(source).options.onError?.(error) };
}

/** The specs of `source` with each reducer function calling the newest one. */
export function liveSpecs(source: Extract<PinnedRowSource, { kind: "aggregate" }>): AggregateSpecs<never> {
  return Object.fromEntries(
    Object.entries(source.specs).map(([key, reducer]) => [
      key,
      typeof reducer === "function" ? (values: readonly unknown[], rows: readonly never[]) => (latestOf(source).specs[key] as typeof reducer)(values, rows) : reducer,
    ]),
  );
}

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
 * `accessorKey` that matches the id. An inline call is fine: equal specs, `scope`, and `cells` keep the band. An inline
 * reducer function keeps the band too; the band calls the newest one when it next reduces, after a data or view change.
 */
export function aggregateRow<TData = unknown>(specs: AggregateSpecs<TData>, options: AggregateRowOptions = {}): PinnedRowSource {
  const { scope = "view", cells } = options;
  // Boundary cast: the source keeps specs for any row type; the band hands them back to the aggregate engine untouched.
  return register({ kind: "aggregate", specs: specs as AggregateSpecs<never>, scope, cells: cells && Object.freeze({ ...cells }) });
}

/**
 * A pinned totals row whose values come from a server (see {@link useDataGridServerAggregate}). Put it in one band
 * of `useDataGridPinnedRows`. The band dims while values load, and fetches again after pending saves settle.
 * An inline call is fine: equal options and `cells` keep the band, and the band calls the newest `fetchAggregates` and `onError`.
 */
export function serverAggregateRow(options: ServerAggregateRowOptions): PinnedRowSource {
  const { cells, ...rest } = options;
  return register({ kind: "server-aggregate", options: rest, cells: cells && Object.freeze({ ...cells }) });
}
