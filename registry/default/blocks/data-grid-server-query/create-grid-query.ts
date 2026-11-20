import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import { isDev } from "./is-dev";
import { QueryError } from "./errors";
import { type QueryLimits, resolveLimits } from "./limits";
import { assertCursorColumns, cursorAfter, cursorBytes, decodeCursor, keyTextAliases, planHash, resumePredicate } from "./cursor";
import { type Paging, type RowCountMode, parseQuery, pivotKeyTest } from "./parse-query";
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

/**
 * What an ORM adapter can do. The conformance suite reads it to choose expected results, and the factory refuses a request
 * that needs a missing capability with `unsupported` (or `unsupported-value`, `limit-exceeded`) before the executor runs.
 * An optional field left unset keeps the full behavior of the SQL renderers, except `pivot`, which stays off.
 */
export type AdapterCapabilities = {
  /** `"like-only"`: only LIKE leaves fold case (ASCII); case-insensitive equals, set filters, and excluded uuid ids are `unsupported`. */
  caseInsensitiveText: "native" | "ascii" | "collation" | "like-only";
  /** `false`: a `%` or `_` in a LIKE leaf, the quick search, or a value query is `unsupported-value`. */
  likeEscape: boolean;
  literalAsterisk: boolean;
  nullsLast: "native" | "emulated";
  aggregates: boolean;
  groupBy: boolean;
  localDayGrouping: boolean;
  /**
   * The adapter reads a `time` value exactly: the `keyText` of a cursor key in `selectRows`, and the group keys of
   * `selectGroups`. Default `true`; `false` makes a cursor sort on a `time` column, and grouping by one, `unsupported`.
   */
  exactInstantKeys?: boolean;
  /** A LIKE leaf can match case. Default `true`; `false` makes a case-sensitive contains, notContains, startsWith, or endsWith `unsupported`. */
  caseSensitiveLike?: boolean;
  /** LIKE matches a native enum or uuid column as text. Default `true`; `false` makes such a leaf, and a quick search over such a column, `unsupported`. */
  nativeLike?: boolean;
  /**
   * `selectValues` groups by an expression: the folded text of a column without `caseSensitive`, a `time` column, and the
   * text of a non-text column a value query matches. Default `true`; `false` makes those values requests `unsupported`.
   */
  expressionValues?: boolean;
  /** min, max, and count read a text `''` as blank. Default `true`; `false` makes them `unsupported` on text without `keepBlankText`. */
  blankTextAggregates?: boolean;
  /** The longest id list the adapter binds, a positive integer. A longer selection is `limit-exceeded`. Default: no limit. */
  maxBoundIds?: number;
  /** The adapter answers `spec.pivot` through `selectPivotKeys` and the pivot cells of `selectGroups`. Default `false`: a pivot is `unsupported`. */
  pivot?: boolean;
};

/**
 * One group row as the database returns it; `aggregates` is keyed by column id. Under `plan.pivot`, `pivotCells` holds
 * one value per key and aggregate, key-major: the cell of key `k` and aggregate `a` sits at `k * aggregates.length + a`.
 */
export type RawGroupRow = { key: unknown; count: unknown; childCount: unknown; aggregates: Record<string, unknown>; pivotCells?: readonly unknown[] };

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
  /**
   * The first `limit` groups of `plan.level` in key order with the empty key last, in one query; each row's `total` is
   * the group count of the whole result. `plan.aggregates` holds the values of each key. Required when `capabilities.pivot` is on.
   */
  selectPivotKeys?(plan: GroupsPlan, page: { limit: number; signal?: AbortSignal }): Promise<{ key: unknown; total: unknown }[]>;
  where(plan: { where: Predicate }): TWhere;
  orderBy(plan: RowsPlan): TOrder;
  /**
   * Turns one validated write value into the driver's value, such as a `BigInt` for int8 or a `Date` for a time. The
   * value is `null` or what `validateChange` checked: a number or digit text, a `YYYY-MM-DD` day, an ISO instant, text,
   * or a boolean. Without it the `values` of a validated change stay in those forms.
   */
  nativeValue?(column: PlanColumn, value: unknown): unknown;
};

export type QueryCallOptions<TContext = never> = { signal?: AbortSignal } & ([TContext] extends [never] ? { context?: undefined } : { context: TContext });
export type CallArgs<TContext> = [TContext] extends [never] ? [opts?: QueryCallOptions] : [opts: QueryCallOptions<TContext>];

/** The answer `useDataGridServerRows` reads. A cursor factory answers `nextCursor` and no `totalRowCount`. */
export type RowsAnswer<TRow, TCursor = never> = { rows: TRow[]; totalRowCount?: number | null; hasMore?: boolean } & ([TCursor] extends [never] ? unknown : { nextCursor?: TCursor | null });
export type ValuesAnswer = { values: { value: string; label?: string; count?: number }[] };
/**
 * One value per column id. A number column answers a JavaScript number, so a value beyond 15 significant digits loses precision.
 * `min` and `max` of a text or date column answer text; `count` answers an integer.
 */
export type AggregatesAnswer = Record<string, number | string | null>;
export type GroupsAnswer = {
  /** Under `spec.pivot`, `pivotCells` holds one number or `null` per entry of `pivotColumns`; a decimal beyond 15 significant digits loses precision. */
  groups: { key: string | number | boolean | null; childCount: number; totalRowCount: number; aggregates?: AggregatesAnswer; pivotCells?: (number | null)[] }[];
  groupCount: number;
  /** The top level: the row count of the whole result. */
  totalRowCount?: number;
  /** Under `spec.pivot`: the generated columns, key-major; `valueIndex` indexes `spec.aggregates`. */
  pivotColumns?: { path: (string | number | boolean | null)[]; valueIndex: number }[];
  /** Under `spec.pivot`: the generated columns cut past `maxPivotColumns`, plus those of a stored key without an exact test (a native enum value outside `choices`, a number over `maxNumberLength`). */
  pivotOmitted?: number;
};
/** The answer of `selection`: the count of the selected rows, and with `include` one page of their ids or rows. */
export type SelectionAnswer<TRow> = { count: number; ids?: string[]; rows?: TRow[]; hasMore?: boolean };

/** Sets an own data property, so a column id such as `__proto__` stays a plain key. */
const own = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * Runs the writes of a validated change and answers how many rows each write matched ({@link WriteCounts}). Requirements:
 * run every write in one transaction, so a throw writes none; throw when an insert fails; filter each write by its
 * `where` alone, never by `rowId`, which carries no `rowScope`; write all writes of one row id or none of them, because
 * a count of 0 for any of them refuses the whole row. A throw or a miscount answers a 500 for the whole change.
 *
 * @example
 * const applyUserWrites: ApplyChange<SQL, Session> = async (change) =>
 *   db.transaction((tx) => {
 *     if (change.moves.length > 0) throw new Error("users have no row order");
 *     for (const insert of change.inserts) tx.insert(users).values(insert.values).run();
 *     return {
 *       updates: change.updates.map((write) => tx.update(users).set(write.values).where(write.where).run().changes),
 *       deletes: change.deletes.map((write) => tx.delete(users).where(write.where).run().changes),
 *       moves: [],
 *     };
 *   });
 */
export type ApplyChange<TWhere, TContext = never> = (change: ValidatedChange<TWhere>, opts: QueryCallOptions<TContext>) => Promise<WriteCounts>;

export interface GridQuery<TRow, TContext = never, TWhere = unknown, TOrder = unknown, TCursor = never> {
  /**
   * A request with `childKind: "groups"` answers a {@link GroupsAnswer}, every other request a {@link RowsAnswer}. A cursor
   * factory answers `{ rows, hasMore, nextCursor }`: a request with `cursor` resumes after that cursor's row, one without
   * reads from `start`; a cursor of another filter or order is `bad-cursor`, and a grouped request `unsupported`.
   */
  fetchRows(input: unknown, ...opts: CallArgs<TContext>): Promise<RowsAnswer<TRow, TCursor> | GroupsAnswer>;
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
   * The save route of `onSave`: validates the `DataChange`, hands the writes to `apply`, and answers the refusals; a row id
   * with a write that matched no row answers one `not-found` in place of its other refusals. `apply` runs even when every
   * operation is refused. The `limit-exceeded` of the grid's 10,000-refusal bound throws before `apply` runs.
   * `maxBodyBytes` is `maxChangeBytes` (8 MiB).
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
  /** `"cursor"` pages `fetchRows` by keyset cursors and never counts; every sortable text column then needs `maxLength`. Default `"offset"`. */
  paging?: Paging;
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
export function createGridQuery<TRow = Record<string, unknown>, TContext = never, TWhere = unknown, TOrder = unknown, TCursor = never>(
  options: CreateGridQueryOptions<TContext, TWhere, TOrder>,
): GridQuery<TRow, TContext, TWhere, TOrder, TCursor> {
  const { columns, executor, rowScope, rowCount, limits, timeZone } = options;
  const map = mapOf(columns);
  const { capabilities } = executor;
  // A partial executor that only serves `validateChange` carries no capabilities.
  const maxBoundIds = (capabilities as AdapterCapabilities | undefined)?.maxBoundIds;
  if (maxBoundIds !== undefined && !(Number.isSafeInteger(maxBoundIds) && maxBoundIds > 0)) throw new Error("createGridQuery: `capabilities.maxBoundIds` must be a positive integer");
  if ((capabilities as AdapterCapabilities | undefined)?.pivot && !executor.selectPivotKeys) throw new Error("createGridQuery: `capabilities.pivot` needs the executor's `selectPivotKeys`");
  const cursorPaging = options.paging === "cursor";
  if (cursorPaging) assertCursorColumns(columns, resolveLimits(limits));
  const keyTextAlias = keyTextAliases(columns);
  // `required` refuses blank writes and promises no NOT NULL, so only the primary key drops the NULL branch.
  const nonNull = (column: PlanColumn): boolean => column.primaryKey;
  if (isDev() && !map.visible.some((column) => column.searchable)) {
    console.warn("gridcn query layer: no column sets `searchable`, so quick search matches every row.");
  }
  const internal = new WeakMap<object, RowsPlan>();
  // The grid rejects a group key longer than 1,024 characters, so no limit above that lets one through.
  const resolvedLimits = resolveLimits(limits);
  const groupKeyCap = Math.min(resolvedLimits.maxGroupKeyLength, 1024);

  const scoped = (callOptions: { context?: unknown } | undefined): Predicate | undefined => {
    if (!rowScope) return undefined;
    if (callOptions?.context === undefined) throw new Error("rowScope is set and the call has no `context`");
    return rowScopePredicate(columns, rowScope(callOptions.context as TContext), resolveLimits(limits).maxNumberLength);
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
    register(deepFreeze(withScope(parseQuery(input, { columns, request: "rows", rowCount, limits, timeZone, capabilities }), callOptions)));
  const parseSelected = (input: unknown, callOptions: { context?: unknown } | undefined) => {
    const parsed = parseSelection(input, { columns, limits, timeZone, capabilities });
    return { include: parsed.include, plan: deepFreeze(withScope(parsed.plan, callOptions)) };
  };
  const trusted = (plan: RowsPlan): RowsPlan => {
    const known = internal.get(plan);
    if (!known) throw new Error("This plan was not made by this query's `parse`");
    return known;
  };
  const alive = (signal: AbortSignal | undefined): void => signal?.throwIfAborted();

  /** Phase 1 of a pivot: the kept keys in one query over the page's scoped `where`, each with the test that keeps its rows. */
  const withPivotKeys = async (plan: GroupsPlan, pivot: NonNullable<GroupsPlan["pivot"]>, signal: AbortSignal | undefined): Promise<GroupsPlan> => {
    const kept = Math.floor(resolvedLimits.maxPivotColumns / plan.aggregates.length);
    const keysPlan: GroupsPlan = { ...plan, level: pivot.column, nextLevel: undefined, direction: pivot.direction, rowRange: { start: 0, end: kept }, countRows: false, pivot: undefined };
    const found = (await executor.selectPivotKeys!(keysPlan, { limit: kept, signal })).slice(0, kept);
    // A stored key without an exact test drops, and the omitted count includes it.
    const keys = found.flatMap((entry) => {
      const key = groupKeyValue(entry.key, pivot.column);
      if (typeof key === "string" && key.length > groupKeyCap) throw new QueryError("limit-exceeded", ["spec", "pivot", "columnIds", 0]);
      const test = pivotKeyTest(pivot.column, key, resolvedLimits);
      return test === null ? [] : [{ key, test }];
    });
    const total = found.length === 0 ? 0 : (countOf(found[0]!.total) ?? 0);
    return { ...plan, pivot: { ...pivot, keys, omitted: Math.max(0, total - keys.length) * plan.aggregates.length } };
  };

  const pivotCellsOf = (entry: RawGroupRow, plan: GroupsPlan, keyCount: number): (number | null)[] => {
    const cells = entry.pivotCells;
    const expected = keyCount * plan.aggregates.length;
    if (!Array.isArray(cells) || cells.length !== expected) throw new Error(`gridcn query layer: the executor answered ${Array.isArray(cells) ? cells.length : "no"} pivot cells for ${expected} generated columns`);
    return cells.map((raw: unknown, index) => {
      const { column, reducer } = plan.aggregates[index % plan.aggregates.length]!;
      const value = aggregateValue(raw, column, reducer);
      return typeof value === "number" ? value : null;
    });
  };

  const fetchGroups = async (plan: GroupsPlan, signal: AbortSignal | undefined): Promise<GroupsAnswer> => {
    if (!executor.capabilities.groupBy) throw new QueryError("unsupported", ["spec", "groupBy"]);
    if (plan.pivot && !executor.capabilities.pivot) throw new QueryError("unsupported", ["spec"]);
    alive(signal);
    const size = plan.rowRange.end - plan.rowRange.start;
    const topLevelRows: RowsPlan = { kind: "rows", where: plan.where, orderBy: [], rowRange: plan.rowRange, runCount: true, projection: [] };
    const page = { offset: plan.rowRange.start, limit: size, signal };
    // The keys query runs alone first, so its failure starts no count.
    const paged = plan.pivot ? await withPivotKeys(plan, plan.pivot, signal) : plan;
    alive(signal);
    // `selectGroups` runs first and synchronously, so its synchronous refusal starts no count.
    const [found, groupCount, rowCount] = await Promise.all([
      executor.selectGroups(paged, page),
      executor.countGroups(plan, signal),
      plan.countRows ? executor.countRows(topLevelRows, signal) : Promise.resolve(undefined),
    ]);
    const pivot = paged.pivot;
    const groups = found.slice(0, size).map((entry) => {
      const count = countOf(entry.count) ?? 0;
      const key = groupKeyValue(entry.key, plan.level);
      if (typeof key === "string" && key.length > groupKeyCap) throw new QueryError("limit-exceeded", ["spec", "groupBy", plan.level.id]);
      const group: GroupsAnswer["groups"][number] = { key, childCount: plan.nextLevel ? (countOf(entry.childCount) ?? 0) : count, totalRowCount: count };
      if (plan.aggregates.length > 0) {
        group.aggregates = {};
        for (const { column, reducer } of plan.aggregates) own(group.aggregates, column.id, aggregateValue(Object.hasOwn(entry.aggregates, column.id) ? entry.aggregates[column.id] : null, column, reducer));
      }
      if (pivot) group.pivotCells = pivotCellsOf(entry, plan, pivot.keys.length);
      return group;
    });
    const answer: GroupsAnswer = { groups, groupCount: countOf(groupCount) ?? 0 };
    if (plan.countRows) answer.totalRowCount = countOf(rowCount) ?? 0;
    if (pivot) {
      answer.pivotColumns = pivot.keys.flatMap(({ key }) => plan.aggregates.map((_, valueIndex) => ({ path: [key], valueIndex })));
      answer.pivotOmitted = pivot.omitted;
    }
    return answer;
  };

  const fetchRows = async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<RowsAnswer<TRow> | GroupsAnswer> => {
    const planned = deepFreeze(withScope(parseQuery(input, { columns, request: "page", rowCount, limits, timeZone, capabilities }), callOptions));
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

  const fetchCursorPage = async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<RowsAnswer<TRow, string>> => {
    const parsed = parseQuery(input, { columns, request: "rows", limits, timeZone, paging: "cursor", capabilities });
    const resolved = resolveLimits(limits);
    const terms = parsed.orderBy;
    const timeTerms = terms.filter(({ column }) => keyTextAlias.has(column));
    if (timeTerms.length > 0 && capabilities.exactInstantKeys === false) throw new QueryError("unsupported", ["spec", "sorts"]);
    if ((cursorBytes(terms.map((term) => term.column), resolved) ?? Infinity) > resolved.maxCursorBytes) throw new QueryError("limit-exceeded", ["spec", "sorts"]);
    const ctx = { terms, hash: planHash(parsed), limits: resolved, nonNull };
    const sent = Object.hasOwn(input as object, "cursor") ? (input as Record<string, unknown>)["cursor"] : undefined;
    const keys = sent === undefined || sent === null ? null : decodeCursor(sent, ctx);
    const scoped = withScope(parsed, callOptions);
    const keyText = timeTerms.map(({ column }) => ({ column, as: keyTextAlias.get(column)! }));
    const plan: RowsPlan = deepFreeze({
      ...scoped,
      where: keys ? combine("and", [scoped.where, resumePredicate(terms, keys, nonNull)]) : scoped.where,
      ...(keyText.length > 0 ? { keyText } : {}),
    });
    alive(callOptions?.signal);
    const size = plan.rowRange.end - plan.rowRange.start;
    const rows = await executor.selectRows(plan, { offset: keys ? 0 : plan.rowRange.start, limit: size + 1, signal: callOptions?.signal });
    const hasMore = rows.length > size;
    const last = hasMore && size > 0 ? rows[size - 1] : undefined;
    const nextCursor = last ? cursorAfter(last, keyTextAlias, ctx) : null;
    return { rows: rows.slice(0, size).map((row) => serializeRow(row, plan.projection) as TRow), hasMore, nextCursor };
  };

  const filterValues = async (input: unknown, callOptions?: { signal?: AbortSignal; context?: unknown }): Promise<ValuesAnswer> => {
    const plan = withScope(parseQuery(input, { columns, request: "values", limits, timeZone, capabilities }), callOptions);
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
    const plan = withScope(parseQuery(input, { columns, request: "aggregates", limits, timeZone, capabilities }), callOptions);
    if (!executor.capabilities.aggregates) throw new QueryError("unsupported", []);
    if (plan.columns.length === 0) return {};
    alive(callOptions?.signal);
    const raw = await executor.aggregate(plan, callOptions?.signal);
    const out: AggregatesAnswer = {};
    for (const { column, reducer } of plan.columns) {
      const value = Object.hasOwn(raw, column.id) ? raw[column.id] : null;
      own(out, column.id, aggregateValue(value, column, reducer));
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
    const change = validateChange(input, { columns, limits, scope: scoped(callOptions), nativeValue: executor.nativeValue?.bind(executor) });
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
    fetchRows: cursorPaging ? fetchCursorPage : fetchRows,
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
  } as unknown as GridQuery<TRow, TContext, TWhere, TOrder, TCursor>;
}

function groupKeyValue(raw: unknown, column: PlanColumn): string | number | boolean | null {
  const key = serializeValue(raw, column);
  return key === "" || key === undefined ? null : (key as string | number | boolean | null);
}

function aggregateValue(raw: unknown, column: PlanColumn, reducer: string): number | string | null {
  if (raw === null || raw === undefined) return reducer === "count" ? 0 : null;
  if (reducer === "count") return countOf(raw) ?? 0;
  if (reducer === "avg" || column.kind === "number") {
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
