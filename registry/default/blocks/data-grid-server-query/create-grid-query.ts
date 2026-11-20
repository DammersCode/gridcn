import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import { isDev } from "./is-dev";
import { QueryError } from "./errors";
import { type QueryLimits, resolveLimits } from "./limits";
import { type RowCountMode, parseQuery } from "./parse-query";
import { parseSelection, selectionBodyBytes } from "./parse-selection";
import type { AggregatesPlan, GroupsPlan, Operand, Predicate, RowsPlan, Test, ValuesPlan } from "./plan";
import { combine } from "./plan";
import { type RowScope, rowScopePredicate } from "./row-scope";
import { serializeRow, serializeValue } from "./serialize-row";
import { toSafeText } from "./safe-text";
import { type SaveAnswer, type ValidatedChange, type WriteCounts, saveAnswer, validateChange } from "./validate-change";

/** Largest row count an answer carries; the grid clamps to the same bound. */
export const MAX_TOTAL_ROW_COUNT = 10_000_000;
const MAX_VALUES = 1000;
const MAX_VALUE_TEXT = 256;

/** What an ORM adapter can do. The conformance suite reads it to choose expected results. */
export type AdapterCapabilities = {
  caseInsensitiveText: "native" | "ascii" | "collation";
  likeEscape: boolean;
  literalAsterisk: boolean;
  nullsLast: "native" | "emulated";
  aggregates: boolean;
  groupBy: boolean;
  localDayGrouping: boolean;
};

/** One group row as the database returns it; `aggregates` is keyed by column id. */
export type RawGroupRow = { key: unknown; count: unknown; childCount: unknown; aggregates: Record<string, unknown> };

/** The part of a query layer an ORM adapter supplies: it renders plans and runs them. */
export type QueryExecutor<TWhere, TOrder> = {
  capabilities: AdapterCapabilities;
  selectRows(plan: RowsPlan, page: { offset: number; limit: number; signal?: AbortSignal }): Promise<Record<string, unknown>[]>;
  countRows(plan: RowsPlan, signal?: AbortSignal): Promise<unknown>;
  selectValues(plan: ValuesPlan, options: { limit: number; signal?: AbortSignal }): Promise<{ value: unknown; count: unknown }[]>;
  aggregate(plan: AggregatesPlan, signal?: AbortSignal): Promise<Record<string, unknown>>;
  /** One page of the groups of `plan.level`, in key order with the empty key last; `childCount` is the row count, or the group count of the next level. */
  selectGroups(plan: GroupsPlan, page: { offset: number; limit: number; signal?: AbortSignal }): Promise<RawGroupRow[]>;
  countGroups(plan: GroupsPlan, signal?: AbortSignal): Promise<unknown>;
  where(plan: { where: Predicate }): TWhere;
  orderBy(plan: RowsPlan): TOrder;
};

export type QueryCallOptions<TContext = never> = { signal?: AbortSignal } & ([TContext] extends [never] ? { context?: undefined } : { context: TContext });
export type CallArgs<TContext> = [TContext] extends [never] ? [opts?: QueryCallOptions] : [opts: QueryCallOptions<TContext>];

/** The answer `useDataGridServerRows` reads. */
export type RowsAnswer<TRow> = { rows: TRow[]; totalRowCount?: number | null; hasMore?: boolean };
export type ValuesAnswer = { values: { value: string; label?: string; count?: number }[] };
export type AggregatesAnswer = Record<string, number | string | null>;
export type GroupsAnswer = {
  groups: { key: string | number | boolean | null; childCount: number; totalRowCount: number; aggregates?: Record<string, number | string | null> }[];
  groupCount: number;
  /** The top level: the row count of the whole result. */
  totalRowCount?: number;
};
/** The answer of `selection`: the count of the selected rows, and with `include` one page of their ids or rows. */
export type SelectionAnswer<TRow> = { count: number; ids?: string[]; rows?: TRow[]; hasMore?: boolean };

/** Runs the writes of a validated change and answers how many rows each write matched. In one transaction, a throw writes none. */
export type ApplyChange<TWhere, TContext = never> = (change: ValidatedChange<TWhere>, opts: QueryCallOptions<TContext>) => Promise<WriteCounts>;

export interface GridQuery<TRow, TContext = never, TWhere = unknown, TOrder = unknown> {
  /** A request with `childKind: "groups"` answers a {@link GroupsAnswer}, every other request a {@link RowsAnswer}. */
  fetchRows(input: unknown, ...opts: CallArgs<TContext>): Promise<RowsAnswer<TRow> | GroupsAnswer>;
  filterValues(input: unknown, ...opts: CallArgs<TContext>): Promise<ValuesAnswer>;
  aggregates(input: unknown, ...opts: CallArgs<TContext>): Promise<AggregatesAnswer>;
  parse(input: unknown, ...opts: CallArgs<TContext>): RowsPlan;
  /** The filter of a plan from `parse`, with `rowScope` applied, in the ORM's own type. */
  where(plan: RowsPlan): TWhere;
  /** The order of a plan from `parse`, in the ORM's own type. */
  orderBy(plan: RowsPlan): TOrder;
  /** Applies the column map and `rowScope` to the `DataChange` of `onSave`; each `where` is in the ORM's own type. */
  validateChange(input: unknown, ...opts: CallArgs<TContext>): ValidatedChange<TWhere>;
  /**
   * The save route of `onSave`: validates the `DataChange`, hands the writes to `apply`, and answers the refusals plus
   * a `not-found` for each row id whose write matched no row. `apply` runs even when every operation is refused.
   * More than 10,000 refusals throw `limit-exceeded` after `apply` ran, so the matched writes stay written while the grid
   * reverts every row. `maxBodyBytes` is `maxChangeBytes` (8 MiB).
   *
   * @example
   * export const POST = async (req: Request) => handleGridRequest(req, usersQuery.save(applyUserWrites), { context: await session(req) });
   */
  save(apply: ApplyChange<TWhere, TContext>): ((input: unknown, ...opts: CallArgs<TContext>) => Promise<SaveAnswer>) & { readonly maxBodyBytes: number };
  /**
   * Counts the rows of the grid's `DataGridSelectedRows` within `rowScope`; `include` also answers one page of their ids or rows.
   * `maxBodyBytes` (40 bytes per `maxSelectionIds` entry plus twice `maxTreeStringBytes`, about 8.1 MiB) is the body cap `handleGridRequest` reads when the route passes none.
   */
  selection: ((input: unknown, ...opts: CallArgs<TContext>) => Promise<SelectionAnswer<TRow>>) & { readonly maxBodyBytes: number };
  /** The plan of a selection with `rowScope` applied, for `where` and `orderBy`: the filter of a bulk write over the selected rows. */
  selectionPlan(input: unknown, ...opts: CallArgs<TContext>): RowsPlan;
  capabilities: AdapterCapabilities;
}

export type CreateGridQueryOptions<TContext, TWhere, TOrder> = {
  columns: ColumnMap;
  executor: QueryExecutor<TWhere, TOrder>;
  /** Equalities on mapped columns that every query ANDs in. Needs `context` on every call. */
  rowScope?: RowScope<TContext>;
  /** When a rows request also counts the result. Default `"firstBlock"`. */
  rowCount?: RowCountMode;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
};

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (typeof value === "object" && value !== null) {
    if (isColumn(value)) return value;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = clone((value as Record<string, unknown>)[key]);
    return out as T;
  }
  return value;
}

function isColumn(value: object): boolean {
  return "operators" in value && "serverOnly" in value;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function countOf(raw: unknown): number | null {
  const n = typeof raw === "bigint" ? Number(raw) : typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? Math.min(n, MAX_TOTAL_ROW_COUNT) : null;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : toSafeText(value);
}

/**
 * Builds the query methods of one table over an executor. Adapters call this; consumers call the adapter's factory.
 * The methods are own arrow properties, so `usersQuery.fetchRows` passes unbound.
 */
export function createGridQuery<TRow = Record<string, unknown>, TContext = never, TWhere = unknown, TOrder = unknown>(
  options: CreateGridQueryOptions<TContext, TWhere, TOrder>,
): GridQuery<TRow, TContext, TWhere, TOrder> {
  const { columns, executor, rowScope, rowCount, limits, timeZone } = options;
  const map = mapOf(columns);
  if (isDev() && !map.visible.some((column) => column.searchable)) {
    console.warn("gridcn query layer: no column sets `searchable`, so quick search matches every row.");
  }
  const internal = new WeakMap<object, RowsPlan>();
  // The grid rejects a group key longer than 1,024 characters, so no limit above that lets one through.
  const groupKeyCap = Math.min(resolveLimits(limits).maxGroupKeyLength, 1024);

  const scoped = (callOptions: { context?: unknown } | undefined): Predicate | undefined => {
    if (!rowScope) return undefined;
    if (callOptions?.context === undefined) throw new Error("rowScope is set and the call has no `context`");
    return rowScopePredicate(columns, rowScope(callOptions.context as TContext));
  };
  const withScope = <P extends { where: Predicate }>(plan: P, callOptions: { context?: unknown } | undefined): P => {
    const scope = scoped(callOptions);
    return scope ? { ...plan, where: combine("and", [plan.where, scope]) } : plan;
  };
  const register = (plan: RowsPlan): RowsPlan => {
    internal.set(plan, deepFreeze(clone(plan)));
    return plan;
  };
  const parse = (input: unknown, callOptions?: { context?: unknown }): RowsPlan =>
    register(deepFreeze(withScope(parseQuery(input, { columns, request: "rows", rowCount, limits, timeZone }), callOptions)));
  const parseSelected = (input: unknown, callOptions: { context?: unknown } | undefined) => {
    const parsed = parseSelection(input, { columns, limits, timeZone });
    return { include: parsed.include, plan: deepFreeze(withScope(parsed.plan, callOptions)) };
  };
  const trusted = (plan: RowsPlan): RowsPlan => {
    const known = internal.get(plan);
    if (!known) throw new Error("This plan was not made by this query's `parse`");
    return known;
  };
  const alive = (signal: AbortSignal | undefined): void => signal?.throwIfAborted();

  const fetchGroups = async (plan: GroupsPlan, signal: AbortSignal | undefined): Promise<GroupsAnswer> => {
    if (!executor.capabilities.groupBy) throw new QueryError("unsupported", ["spec", "groupBy"]);
    alive(signal);
    const size = plan.rowRange.end - plan.rowRange.start;
    const topLevelRows: RowsPlan = { kind: "rows", where: plan.where, orderBy: [], rowRange: plan.rowRange, runCount: true, projection: [] };
    const [found, groupCount, rowCount] = await Promise.all([
      executor.selectGroups(plan, { offset: plan.rowRange.start, limit: size, signal }),
      executor.countGroups(plan, signal),
      plan.countRows ? executor.countRows(topLevelRows, signal) : Promise.resolve(undefined),
    ]);
    const groups = found.slice(0, size).map((entry) => {
      const count = countOf(entry.count) ?? 0;
      const key = groupKeyValue(entry.key, plan.level);
      if (typeof key === "string" && key.length > groupKeyCap) throw new QueryError("limit-exceeded", ["spec", "groupBy", plan.level.id]);
      const group: GroupsAnswer["groups"][number] = { key, childCount: plan.nextLevel ? (countOf(entry.childCount) ?? 0) : count, totalRowCount: count };
      if (plan.aggregates.length > 0) {
        group.aggregates = {};
        for (const { column, reducer } of plan.aggregates) group.aggregates[column.id] = aggregateValue(Object.hasOwn(entry.aggregates, column.id) ? entry.aggregates[column.id] : null, column, reducer);
      }
      return group;
    });
    const answer: GroupsAnswer = { groups, groupCount: countOf(groupCount) ?? 0 };
    if (plan.countRows) answer.totalRowCount = countOf(rowCount) ?? 0;
    return answer;
  };

  const fetchRows = async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<RowsAnswer<TRow> | GroupsAnswer> => {
    const planned = deepFreeze(withScope(parseQuery(input, { columns, request: "page", rowCount, limits, timeZone }), callOptions));
    if (planned.kind === "groups") return fetchGroups(planned, callOptions?.signal);
    const plan = planned;
    alive(callOptions?.signal);
    const size = plan.rowRange.end - plan.rowRange.start;
    const [rows, count] = await Promise.all([
      executor.selectRows(plan, { offset: plan.rowRange.start, limit: plan.runCount ? size : size + 1, signal: callOptions?.signal }),
      plan.runCount ? executor.countRows(plan, callOptions?.signal) : Promise.resolve(undefined),
    ]);
    const page = rows.slice(0, size).map((row) => serializeRow(row, plan.projection) as TRow);
    if (plan.runCount) return { rows: page, totalRowCount: countOf(count) };
    return { rows: page, hasMore: rows.length > size };
  };

  const filterValues = async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<ValuesAnswer> => {
    const plan = withScope(parseQuery(input, { columns, request: "values", limits, timeZone }), callOptions);
    alive(callOptions?.signal);
    if (plan.column.time && !executor.capabilities.localDayGrouping && (timeZone ?? "UTC") !== "UTC") throw new QueryError("unsupported", ["columnId"]);
    const found = await executor.selectValues(plan, { limit: MAX_VALUES + 1, signal: callOptions?.signal });
    const merged = new Map<string, number>();
    for (const entry of found) {
      const text = valueText(plan.column.time ? entry.value : serializeValue(entry.value, plan.column));
      const count = countOf(entry.count) ?? 0;
      if (text.length > MAX_VALUE_TEXT) continue;
      merged.set(text, (merged.get(text) ?? 0) + count);
    }
    const values = [...merged].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    return { values: values.slice(0, MAX_VALUES) };
  };

  const aggregates = async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<AggregatesAnswer> => {
    const plan = withScope(parseQuery(input, { columns, request: "aggregates", limits, timeZone }), callOptions);
    if (!executor.capabilities.aggregates) throw new QueryError("unsupported", []);
    if (plan.columns.length === 0) return {};
    alive(callOptions?.signal);
    const raw = await executor.aggregate(plan, callOptions?.signal);
    const out: AggregatesAnswer = {};
    for (const { column, reducer } of plan.columns) {
      const value = Object.hasOwn(raw, column.id) ? raw[column.id] : null;
      out[column.id] = aggregateValue(value, column, reducer);
    }
    return out;
  };

  const selection = async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<SelectionAnswer<TRow>> => {
    const { plan, include } = parseSelected(input, callOptions);
    const signal = callOptions?.signal;
    alive(signal);
    if (!include) return { count: countOf(await executor.countRows(plan, signal)) ?? 0 };
    const key = map.tieBreaker[0]!;
    const projection = include === "ids" ? [key] : plan.projection;
    const size = plan.rowRange.end - plan.rowRange.start;
    const [rows, count] = await Promise.all([
      executor.selectRows({ ...plan, projection }, { offset: plan.rowRange.start, limit: size + 1, signal }),
      executor.countRows(plan, signal),
    ]);
    const page = rows.slice(0, size);
    const answer: SelectionAnswer<TRow> = { count: countOf(count) ?? 0, hasMore: rows.length > size };
    if (include === "ids") answer.ids = page.map((row) => toSafeText(serializeValue(Object.hasOwn(row, key.id) ? row[key.id] : null, key)));
    else answer.rows = page.map((row) => serializeRow(row, projection) as TRow);
    return answer;
  };

  const validate = (input: unknown, callOptions?: { context?: unknown }): ValidatedChange<TWhere> => {
    const change = validateChange(input, { columns, limits, scope: scoped(callOptions) });
    const where = (predicate: Predicate) => executor.where({ where: predicate });
    return {
      ...change,
      updates: change.updates.map((update) => ({ ...update, where: where(update.where) })),
      deletes: change.deletes.map((entry) => ({ ...entry, where: where(entry.where) })),
      moves: change.moves.map(({ beforeWhere, afterWhere, ...move }) => ({
        ...move,
        where: where(move.where),
        ...(beforeWhere === undefined ? {} : { beforeWhere: where(beforeWhere) }),
        ...(afterWhere === undefined ? {} : { afterWhere: where(afterWhere) }),
      })),
    };
  };

  return {
    fetchRows,
    filterValues,
    aggregates,
    parse,
    where: (plan: RowsPlan) => executor.where(trusted(plan)),
    orderBy: (plan: RowsPlan) => executor.orderBy(trusted(plan)),
    validateChange: validate,
    save: (apply: ApplyChange<TWhere, TContext>) =>
      Object.assign(
        async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<SaveAnswer> => {
          const change = validate(input, callOptions);
          alive(callOptions?.signal);
          return saveAnswer(change, await apply(change, (callOptions ?? {}) as QueryCallOptions<TContext>));
        },
        { maxBodyBytes: resolveLimits(limits).maxChangeBytes },
      ),
    selection: Object.assign(selection, { maxBodyBytes: selectionBodyBytes(resolveLimits(limits)) }),
    selectionPlan: (input: unknown, callOptions?: { context?: unknown }) => register(parseSelected(input, callOptions).plan),
    capabilities: executor.capabilities,
  } as unknown as GridQuery<TRow, TContext, TWhere, TOrder>;
}

function groupKeyValue(raw: unknown, column: PlanColumn): string | number | boolean | null {
  const key = serializeValue(raw, column);
  return key === "" || key === undefined ? null : (key as string | number | boolean | null);
}

function aggregateValue(raw: unknown, column: PlanColumn, reducer: string): number | string | null {
  if (raw === null || raw === undefined) return reducer === "count" ? 0 : null;
  if (reducer === "count") return countOf(raw) ?? 0;
  if (reducer === "avg") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const value = serializeValue(raw, column);
  return typeof value === "number" || typeof value === "string" ? value : null;
}

/** Throws at creation when a column declares a custom operator that has no handler, or a handler names no declared operator. */
export function assertCustomOperatorHandlers(columns: ColumnMap, handlers: Readonly<Record<string, unknown>> | undefined): void {
  const declared = new Set<string>();
  for (const column of mapOf(columns).byId.values()) for (const id of column.operators.keys()) declared.add(id);
  const given = new Map(Object.entries(handlers ?? {}));
  for (const id of declared) if (!given.has(id)) throw new Error(`customOperators: no handler for the declared operator "${id}"`);
  for (const id of given.keys()) if (!declared.has(id)) throw new Error(`customOperators: "${id}" is not declared on any column`);
}

export type { Operand, Test };
