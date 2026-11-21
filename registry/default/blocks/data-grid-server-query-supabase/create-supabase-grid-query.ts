import {
  type AdapterCapabilities,
  type AggregateReducer,
  type ColumnMap,
  type GridQuery,
  QueryError,
  type QueryLimits,
  type RowCountMode,
  type RowScope,
} from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type PlanColumn, createGridQuery, likePattern, mapOf, resolveLimits, toSafeText } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";
import { type Filter, isTextual, renderFilter, treeText } from "./render-postgrest";

type Method = (...args: never[]) => unknown;

/** The caller's Supabase client, such as the one `createClient` returns, typed by shape so the adapter imports no client. */
export type SupabaseClientLike = { from: Method; rpc: Method };

/** The order of a plan as `.order(column, { ascending, nullsFirst })` calls take it. */
export type SupabaseOrder = { column: string; ascending: boolean; nullsFirst: false }[];

export type SupabaseGridQueryOptions<TContext = never> = {
  client: SupabaseClientLike;
  /** The table or view PostgREST exposes. */
  table: string;
  columns: ColumnMap;
  /** Equalities on mapped columns that every query ANDs in. Needs `context` on every call. */
  rowScope?: RowScope<TContext>;
  /** When a rows request also counts the result. Default `"firstBlock"`. */
  rowCount?: RowCountMode;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
  /** `"cursor"` pages `fetchRows` by keyset cursors and never counts; every sortable text column then needs `maxLength`. Default `"offset"`. */
  paging?: "offset" | "cursor";
  /**
   * The table's grid function from `grid-query.sql`, such as `"items_grid"`. It answers set values, aggregates, groups,
   * requests whose URL is over `maxUrlLength`, and reads of more rows than `maxRows`. Without it those are `unsupported`,
   * and a long URL is `limit-exceeded`.
   */
  rpc?: string;
  /** The longest request URL the client sends, in characters; a longer request goes to `rpc`. Default 8,000. */
  maxUrlLength?: number;
  /**
   * PostgREST's `max-rows` setting, which cuts every REST answer without an error. Default 1,000, Supabase's default.
   * A read of more rows, the look-ahead row included, goes to `rpc`. Without `rpc`, creation throws when
   * `limits.maxPageSize + 1` exceeds it.
   */
  maxRows?: number;
};

/** One request of the grid function: the plan as one JSON argument. Columns are physical names; the function checks each. */
export type GridFunctionPlan =
  | { kind: "rows"; where: Filter; select: { c: string; text: boolean }[]; order: { c: string; desc: boolean }[]; offset: number; limit: number }
  | { kind: "count"; where: Filter }
  | { kind: "values"; where: Filter; c: string; form: "plain" | "text" | "folded" | "day"; zone: string; pattern: string | null; limit: number }
  | { kind: "aggregates"; where: Filter; columns: GridFunctionAggregate[] }
  /** Under `pivot`, each group also answers `cells`: per key, one value per aggregate. Each key is the filter that keeps its rows. */
  | { kind: "groups"; where: Filter; level: GridFunctionKey; next: GridFunctionKey | null; desc: boolean; offset: number; limit: number; aggregates: GridFunctionAggregate[]; pivot?: { keys: Filter[] } }
  /** The first `limit` keys of `level` in key order, each with the count of all keys as `total`; `values` generated columns per key. */
  | { kind: "pivotKeys"; where: Filter; level: GridFunctionKey; desc: boolean; limit: number; values: number }
  | { kind: "groupCount"; where: Filter; level: GridFunctionKey };
type GridFunctionAggregate = { c: string; reducer: AggregateReducer; blank: boolean };
type GridFunctionKey = { c: string; blank: boolean };

type Result = { data: unknown; error: { message?: unknown } | null; count?: number | null; status?: number };
type Builder = PromiseLike<Result> & {
  or(filters: string): Builder;
  order(column: string, options: { ascending: boolean; nullsFirst: boolean }): Builder;
  range(from: number, to: number): Builder;
  abortSignal(signal: AbortSignal): Builder;
};
type Client = {
  from(relation: string): { select(columns: string, options?: { count?: "exact"; head?: boolean }): Builder };
  rpc(fn: string, args: { plan: GridFunctionPlan }): PromiseLike<Result> & { abortSignal(signal: AbortSignal): PromiseLike<Result> };
};
type Row = Record<string, unknown>;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_MAX_URL_LENGTH = 8000;
const DEFAULT_MAX_ROWS = 1000;

const get = (row: unknown, key: string): unknown => (typeof row === "object" && row !== null && Object.hasOwn(row, key) ? (row as Row)[key] : null);
const rowsOf = (data: unknown): unknown[] => (Array.isArray(data) ? data : []);
/** JSON numbers lose int8 and decimal digits, so those columns travel as text. */
const asText = (column: PlanColumn): boolean => column.kind === "number" && (column.numeric === "int8" || column.numeric === "decimal");
const blankText = (column: PlanColumn): boolean => isTextual(column) && !column.keepBlankText;
/** The grid function answers keys and aggregates as text; an epoch instant reads as its number. */
const fromText = (column: PlanColumn, value: unknown): unknown =>
  column.time && (column.storage === "epoch-ms" || column.storage === "epoch-s") && typeof value === "string" ? Number(value) : value;

/** The request URL's length; postgrest-js keeps the URL in its builder's `url`, which its types mark protected. */
function urlLength(builder: Builder): number {
  const url = (builder as { url?: unknown }).url;
  if (typeof url !== "object" || url === null || typeof (url as { href?: unknown }).href !== "string") {
    throw new Error("createSupabaseGridQuery: the client's query builder has no `url`, so the URL length cannot be checked");
  }
  return (url as { href: string }).href.length;
}

async function read(request: PromiseLike<Result>): Promise<Result> {
  const result = await request;
  // A HEAD answer, such as a count's, has no body, so its error has no message.
  if (result.error) throw new Error(`Supabase request failed: ${toSafeText(result.error.message) || `HTTP ${toSafeText(result.status)}`}`);
  return result;
}

/**
 * Reads and counts rows through the caller's Supabase client, from the column map and a request body. It imports no
 * client and sends every filter as one PostgREST logic tree in one `or=(...)`, with every value quoted and escaped.
 *
 * - Set values, aggregates, groups, pivots, requests whose URL is over `maxUrlLength`, and reads of more rows than `maxRows`
 *   run in the table's grid function (`rpc`), which takes the plan as one JSON argument. Without `rpc` they are
 *   `unsupported` or `limit-exceeded`.
 * - A literal `*` in a LIKE test (contains, startsWith, endsWith, case-insensitive equals and set filters, quick search) is
 *   `unsupported-value`: PostgREST reads every `*` of a LIKE value as `%`.
 * - LIKE tests on native enum and uuid columns are `unsupported`: PostgREST cannot cast a filtered column to text.
 * - With a user JWT the browser can call PostgREST directly, so row-level security is the only tenancy boundary;
 *   `rowScope` narrows this layer's own queries.
 * - The grid function takes its plan from the caller and does NOT enforce `rowScope`. A direct caller can read every
 *   column of the wrapper's allow-list, `serverOnly` columns included; only column GRANTs hide a column. Never make
 *   the wrapper SECURITY DEFINER: row-level security would check its owner. Revoke EXECUTE on the wrapper from
 *   `public` and `anon`, and grant it to `authenticated`.
 * - A `where` of `validateChange` is safe only as the sole argument of one `.or()`, as in
 *   `.update(values).or(where).select(pk)`. Joined with another condition in the same `.or()`, the scope becomes one
 *   branch of the OR and stops narrowing.
 * - Writes are not atomic through the adapter: each REST call is its own transaction. Run a whole change in one
 *   consumer RPC, never in a loop of `.update()` calls.
 *
 * @example
 * const columns = defineColumnMap({
 *   id: { type: "number", numeric: "int8", primaryKey: true },
 *   name: { type: "text", searchable: true, maxLength: 200 },
 *   tenantId: { type: "number", numeric: "int4", serverOnly: true },
 * });
 * export const itemsQuery = createSupabaseGridQuery<Item, Session>({ client: supabase, table: "items", columns, rpc: "items_grid", rowScope: (s) => ({ tenantId: s.tenantId }) });
 */
export function createSupabaseGridQuery<TRow = Record<string, unknown>, TContext = never>(options: SupabaseGridQueryOptions<TContext> & { paging: "cursor" }): GridQuery<TRow, TContext, string, SupabaseOrder, string>;
export function createSupabaseGridQuery<TRow = Record<string, unknown>, TContext = never>(options: SupabaseGridQueryOptions<TContext> & { paging?: "offset" }): GridQuery<TRow, TContext, string, SupabaseOrder>;
/** A `paging` known only at run time may page by cursor, so the answer's cursor is typed. */
export function createSupabaseGridQuery<TRow = Record<string, unknown>, TContext = never>(options: SupabaseGridQueryOptions<TContext>): GridQuery<TRow, TContext, string, SupabaseOrder, string>;
export function createSupabaseGridQuery<TRow, TContext>(options: SupabaseGridQueryOptions<TContext>): GridQuery<TRow, TContext, string, SupabaseOrder, string> {
  const { table, columns, rpc } = options;
  const client = options.client as unknown as Client;
  const maxUrlLength = options.maxUrlLength ?? DEFAULT_MAX_URL_LENGTH;
  const timeZone = options.timeZone ?? "UTC";
  if (!Number.isSafeInteger(maxUrlLength) || maxUrlLength <= 0) throw new Error("createSupabaseGridQuery: `maxUrlLength` must be a positive integer");
  // PostgREST reads `,` `.` `(` `)` and `:` in names as grammar, and the grid function names columns by `format('%I')`.
  for (const [what, name] of [["table", table], ["rpc", rpc ?? "grid"]] as const) {
    if (typeof name !== "string" || !IDENTIFIER.test(name)) throw new Error(`createSupabaseGridQuery: \`${what}\` must be a plain identifier (letters, digits, _)`);
  }
  for (const column of mapOf(columns).byId.values()) {
    if (!IDENTIFIER.test(column.field)) throw new Error(`createSupabaseGridQuery: column "${column.id}" has the field "${column.field}", which is not a plain identifier (letters, digits, _)`);
    if (column.operators.size > 0) throw new Error(`createSupabaseGridQuery: column "${column.id}" declares a custom operator, which the Supabase adapter does not render`);
  }
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) throw new Error("createSupabaseGridQuery: `maxRows` must be a positive integer");
  const maxPageSize = resolveLimits(options.limits).maxPageSize;
  if (rpc === undefined && maxPageSize + 1 > maxRows) throw new Error(`createSupabaseGridQuery: a page of \`limits.maxPageSize\` (${maxPageSize}) rows plus the look-ahead row exceeds \`maxRows\` (${maxRows}), PostgREST's max-rows, which drops rows without an error. Set \`rpc\` to the table's grid function, or set \`limits.maxPageSize\` to ${maxRows - 1} or less.`);
  const anchor = mapOf(columns).tieBreaker[0]!.field;

  const withSignal = <B extends { abortSignal(signal: AbortSignal): unknown }>(builder: B, signal: AbortSignal | undefined): PromiseLike<Result> =>
    (signal ? builder.abortSignal(signal) : builder) as PromiseLike<Result>;
  const callFunction = async (plan: GridFunctionPlan, signal: AbortSignal | undefined, path: readonly (string | number)[]): Promise<unknown> => {
    if (rpc === undefined) throw new QueryError("unsupported", path);
    return (await read(withSignal(client.rpc(rpc, { plan }), signal))).data;
  };
  const filtered = (builder: Builder, filter: Filter): Builder => (filter === true ? builder : builder.or(treeText(filter, anchor)));
  /** Sends the builder when its URL and its row `limit` fit, else the same plan to the grid function. */
  const send = async (builder: Builder, signal: AbortSignal | undefined, plan: () => GridFunctionPlan, limit = 0): Promise<{ rest: Result } | { data: unknown }> => {
    if (urlLength(builder) <= maxUrlLength && limit <= maxRows) return { rest: await read(withSignal(builder, signal)) };
    if (rpc === undefined) throw new QueryError("limit-exceeded", []);
    return { data: await callFunction(plan(), signal, []) };
  };
  const key = (column: PlanColumn): GridFunctionKey => ({ c: column.field, blank: isTextual(column) });
  const aggregatesOf = (list: readonly { column: PlanColumn; reducer: AggregateReducer }[]): GridFunctionAggregate[] =>
    list.map(({ column, reducer }) => ({ c: column.field, reducer, blank: blankText(column) }));
  const byIndex = (list: readonly { column: PlanColumn }[], values: unknown): Row => Object.fromEntries(list.map(({ column }, index) => [column.id, fromText(column, rowsOf(values)[index] ?? null)]));

  const capabilities: AdapterCapabilities = {
    caseInsensitiveText: "native",
    likeEscape: true,
    // The adapter refuses a `*` in a LIKE test itself; the core does not read this flag.
    literalAsterisk: false,
    nullsLast: "native",
    aggregates: rpc !== undefined,
    groupBy: rpc !== undefined,
    pivot: rpc !== undefined,
    localDayGrouping: true,
    exactInstantKeys: true,
    millisecondInstantKeys: true,
    nativeLike: false,
  };

  return createGridQuery<TRow, TContext, string, SupabaseOrder, string>({
    columns,
    rowScope: options.rowScope,
    rowCount: options.rowCount,
    limits: options.limits,
    timeZone: options.timeZone,
    paging: options.paging,
    executor: {
      capabilities,
      where: (plan) => treeText(renderFilter(plan.where), anchor),
      orderBy: (plan) => plan.orderBy.map(({ column, direction }) => ({ column: column.field, ascending: direction === "asc", nullsFirst: false })),
      selectRows: async (plan, page) => {
        const filter = renderFilter(plan.where);
        const fields = [...plan.projection, ...(plan.keyText ?? []).map(({ column }) => column)];
        const select = [...new Map(fields.map((column) => [column.field, { c: column.field, text: asText(column) }])).values()];
        let builder = filtered(client.from(table).select(select.map(({ c, text }) => (text ? `${c}::text` : c)).join(",")), filter);
        for (const { column, direction } of plan.orderBy) builder = builder.order(column.field, { ascending: direction === "asc", nullsFirst: false });
        builder = builder.range(page.offset, page.offset + page.limit - 1);
        const order = plan.orderBy.map(({ column, direction }) => ({ c: column.field, desc: direction === "desc" }));
        const sent = await send(builder, page.signal, () => ({ kind: "rows", where: filter, select, order, offset: page.offset, limit: page.limit }), page.limit);
        return rowsOf("rest" in sent ? sent.rest.data : sent.data).map((row) => {
          const out: Row = Object.fromEntries(plan.projection.map((column) => [column.id, get(row, column.field)]));
          for (const { column, as } of plan.keyText ?? []) out[as] = get(row, column.field);
          return out;
        });
      },
      countRows: async (plan, signal) => {
        const filter = renderFilter(plan.where);
        const sent = await send(filtered(client.from(table).select(anchor, { count: "exact", head: true }), filter), signal, () => ({ kind: "count", where: filter }));
        return "rest" in sent ? sent.rest.count : sent.data;
      },
      selectValues: async (plan, { limit, signal }) => {
        const { column } = plan;
        if (column.time && (column.storage !== "native" || /^[+-]/.test(timeZone))) throw new QueryError("unsupported", ["columnId"]);
        const form = column.time ? "day" : !isTextual(column) ? "plain" : column.caseSensitive ? "text" : "folded";
        const pattern = plan.query === "" ? null : likePattern("contains", plan.query, "\\");
        const data = await callFunction({ kind: "values", where: renderFilter(plan.where), c: column.field, form, zone: timeZone, pattern, limit }, signal, ["columnId"]);
        return rowsOf(data).map((entry) => ({ value: get(entry, "value"), count: get(entry, "count") }));
      },
      aggregate: async (plan, signal) => byIndex(plan.columns, await callFunction({ kind: "aggregates", where: renderFilter(plan.where), columns: aggregatesOf(plan.columns) }, signal, [])),
      selectGroups: async (plan, page) => {
        const data = await callFunction(
          {
            kind: "groups",
            where: renderFilter(plan.where),
            level: key(plan.level),
            next: plan.nextLevel ? key(plan.nextLevel) : null,
            desc: plan.direction === "desc",
            offset: page.offset,
            limit: page.limit,
            aggregates: aggregatesOf(plan.aggregates),
            ...(plan.pivot ? { pivot: { keys: plan.pivot.keys.map(({ test }) => renderFilter(test)) } } : {}),
          },
          page.signal,
          ["spec", "groupBy"],
        );
        return rowsOf(data).map((group) => ({
          key: fromText(plan.level, get(group, "key")),
          count: get(group, "count"),
          childCount: get(group, "childCount"),
          aggregates: byIndex(plan.aggregates, get(group, "aggregates")),
          ...(plan.pivot ? { pivotCells: get(group, "cells") as unknown[] } : {}),
        }));
      },
      selectPivotKeys: async (plan, { limit, signal }) => {
        const data = await callFunction({ kind: "pivotKeys", where: renderFilter(plan.where), level: key(plan.level), desc: plan.direction === "desc", limit, values: plan.aggregates.length }, signal, ["spec", "pivot"]);
        return rowsOf(data).map((entry) => ({ key: get(entry, "key"), total: get(entry, "total") }));
      },
      countGroups: async (plan, signal) => callFunction({ kind: "groupCount", where: renderFilter(plan.where), level: key(plan.level) }, signal, ["spec", "groupBy"]),
    },
  });
}
