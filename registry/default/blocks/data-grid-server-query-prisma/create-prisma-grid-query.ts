import { type AdapterCapabilities, type ColumnMap, type GridQuery, QueryError, type QueryLimits, type RowCountMode, type RowScope } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type AggregatesPlan, type GroupsPlan, type PlanColumn, type RawGroupRow, createGridQuery, mapOf, toSafeText } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";
import {
  type PrismaNode,
  type PrismaOrderBy,
  type PrismaProvider,
  type PrismaWhere,
  and,
  assertBindBudget,
  boundValues,
  createPrismaRenderer,
  field,
  foldsEmptyText,
  isTextual,
  maxBoundIds,
  oneOf,
  or,
  own,
  toWhere,
  unsupported,
  writeValue,
} from "./render-prisma";
import { nullableColumnIds } from "./columns";

type Method = (...args: never[]) => unknown;

/** The model delegate of a generated Prisma client, such as `prisma.user`, typed by shape so the adapter imports no client. */
export type PrismaModelDelegate = { findMany: Method; count: Method; groupBy: Method; aggregate: Method };

export type PrismaGridQueryOptions<TContext = never> = {
  /** The model delegate of the table, such as `prisma.user`. */
  model: PrismaModelDelegate;
  /** The datasource `provider` of the schema. It sets the bound-value budget (PostgreSQL 32,766, SQLite 999), LIKE escaping, and `mode`. */
  provider: PrismaProvider;
  /** The map from `definePrismaColumnMap`, whose `nullable` mirrors the schema; another map throws. */
  columns: ColumnMap;
  /** Equalities on mapped columns that every query ANDs in. Needs `context` on every call. */
  rowScope?: RowScope<TContext>;
  /** When a rows request also counts the result. Default `"firstBlock"`. */
  rowCount?: RowCountMode;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
  /** `"cursor"` pages `fetchRows` by keyset cursors and never counts; every sortable text column then needs `maxLength`, and a sortable native enum throws at creation. Default `"offset"`. */
  paging?: "offset" | "cursor";
  /** Most rows of the `groupBy` that counts a level's groups or a page's child groups; more is `limit-exceeded`. Default 10,000. */
  maxGroupRows?: number;
};

type Row = Record<string, unknown>;

const get = (row: unknown, key: string): unknown => (typeof row === "object" && row !== null && Object.hasOwn(row, key) ? (row as Row)[key] : null);
const isDecimal = (value: unknown): value is { toFixed(): string } =>
  typeof value === "object" && value !== null && !(value instanceof Date) && typeof (value as { toFixed?: unknown }).toFixed === "function";

/** Trailing zeros up to `scale`, as PostgreSQL returns `numeric(p, s)`; Prisma's `Decimal` drops them. */
function padToScale(text: string, scale: number | undefined): string {
  const dot = text.indexOf(".");
  const places = dot === -1 ? 0 : text.length - dot - 1;
  if (scale === undefined || places >= scale) return text;
  return `${text}${dot === -1 ? "." : ""}${"0".repeat(scale - places)}`;
}

/** A Prisma value in the form the core reads: `Decimal` and a `bigint` number as text, a date-only `Date` as its UTC day. */
function plainValue(column: PlanColumn, value: unknown): unknown {
  // The core reads an epoch `bigint` as an instant; its digits as text would read as no date.
  if (typeof value === "bigint") return column.kind === "date" ? value : value.toString();
  // decimal.js `toFixed()` with no argument never switches to exponent notation, unlike `toString()`.
  if (isDecimal(value)) return padToScale(value.toFixed(), column.scale);
  if (value instanceof Date && column.kind === "date" && !column.time) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return value;
}

const isBlankValue = (column: PlanColumn, value: unknown): boolean => value === null || value === undefined || (value === "" && foldsEmptyText(column));
const keyId = (column: PlanColumn, value: unknown): string => {
  if (isBlankValue(column, value)) return "blank";
  return `k:${value instanceof Date ? value.toISOString() : toSafeText(plainValue(column, value))}`;
};

/** `NULLIF(col, '')` in min, max, and count has no object-API form. */
function assertAggregates(columns: AggregatesPlan["columns"]): void {
  for (const { column, reducer } of columns) {
    if (reducer !== "sum" && reducer !== "avg" && isTextual(column) && !column.keepBlankText && column.native === undefined) throw unsupported(column);
  }
}

function aggregateSelection(columns: AggregatesPlan["columns"]): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const { column, reducer } of columns) own((out[`_${reducer}`] ??= {}), column.field, true);
  return out;
}

function aggregateValues(found: unknown, columns: AggregatesPlan["columns"]): Row {
  const out: Row = {};
  for (const { column, reducer } of columns) own(out, column.id, plainValue(column, get(get(found, `_${reducer}`), column.field)));
  return out;
}

/**
 * Reads and counts rows with a Prisma 7 model delegate, from the column map and a request body. It renders Prisma's object
 * API only and imports no client: pass `prisma.user` and the schema's `provider`.
 *
 * - Prisma has no runtime data model, so the map is written by hand with {@link definePrismaColumnMap}, typed by the
 *   generated model: `nullable` decides the NULL branches and `nulls: "last"`, which Prisma refuses on a field without `?`.
 * - Every statement counts its bound values and answers `limit-exceeded` past the provider budget (PostgreSQL 32,766,
 *   SQLite 999), because Prisma splits a plain `in` beyond it and merges wrong rows. On SQLite a selection of about 990
 *   ids or excluded ids, and a page of about 990 groups that have a next level, is `limit-exceeded`. `where` also reserves one value per mapped column for the `data` of a write.
 * - Its `capabilities` refuse, before any call, what the object API has no exact form for (`unsupported`): on SQLite
 *   case-insensitive `equals` and set filters, case-sensitive LIKE leaves, and excluded ids on a uuid key; on PostgreSQL
 *   cursor sorts on and grouping by `time` columns; LIKE leaves on a native enum or uuid; set values of `time` columns and
 *   of text without `caseSensitive`, and a value query on a non-text column; min, max, and count of text without
 *   `keepBlankText`. A custom operator throws at creation, and so does a sortable native enum with `paging: "cursor"`.
 * - On SQLite a `%` or `_` in a LIKE leaf is `unsupported-value`: SQLite LIKE has no ESCAPE clause there. On an `epoch-s`
 *   column a comparison or range rounds a fraction of a second to the exact whole second; any other instant with a
 *   fraction, such as an `equals` value or a written value, is `unsupported-value`.
 * - Group child counts and group counts read one extra `groupBy` of at most `maxGroupRows` rows.
 * - A pivot (`spec.pivot`) is `unsupported`: a two-field `groupBy` returns one row per group and key, 40,000 for a
 *   200-group page and 200 keys, past `maxGroupRows`, and it answers `''` and NULL as two keys.
 *
 * @example
 * import { Prisma, PrismaClient, type User } from "@/generated/prisma/client";
 *
 * const columns = definePrismaColumnMap<User>()(Prisma.UserScalarFieldEnum, {
 *   id: { type: "number", numeric: "int4", primaryKey: true },
 *   name: { type: "text", searchable: true, nullable: true },
 *   tenantId: { type: "number", numeric: "int4", serverOnly: true },
 * });
 * export const usersQuery = createPrismaGridQuery<User, Session>({ model: prisma.user, provider: "postgresql", columns, rowScope: (s) => ({ tenantId: s.tenantId }) });
 */
export function createPrismaGridQuery<TRow = Record<string, unknown>, TContext = never>(options: PrismaGridQueryOptions<TContext> & { paging: "cursor" }): GridQuery<TRow, TContext, PrismaWhere, PrismaOrderBy, string>;
export function createPrismaGridQuery<TRow = Record<string, unknown>, TContext = never>(options: PrismaGridQueryOptions<TContext> & { paging?: "offset" }): GridQuery<TRow, TContext, PrismaWhere, PrismaOrderBy>;
/** A `paging` known only at run time may page by cursor, so the answer's cursor is typed. */
export function createPrismaGridQuery<TRow = Record<string, unknown>, TContext = never>(options: PrismaGridQueryOptions<TContext>): GridQuery<TRow, TContext, PrismaWhere, PrismaOrderBy, string>;
export function createPrismaGridQuery<TRow, TContext>(options: PrismaGridQueryOptions<TContext>): GridQuery<TRow, TContext, PrismaWhere, PrismaOrderBy, string> {
  const { model, provider, columns } = options;
  if (provider !== "postgresql" && provider !== "sqlite") throw new Error('createPrismaGridQuery: `provider` must be "postgresql" or "sqlite"');
  for (const column of mapOf(columns).byId.values()) {
    if (column.operators.size > 0) throw new Error(`createPrismaGridQuery: column "${column.id}" declares a custom operator, which the Prisma adapter does not render`);
    if (options.paging === "cursor" && column.native === "enum" && column.sortable) {
      throw new Error(`createPrismaGridQuery: column "${column.id}" is a native enum, and a Prisma enum filter has no gt or lt to resume a cursor after it; set \`sortable: false\``);
    }
  }
  const maxGroupRows = options.maxGroupRows ?? 10_000;
  const renderer = createPrismaRenderer(provider, nullableColumnIds(columns));
  const pg = provider === "postgresql";

  const run = async (method: keyof PrismaModelDelegate, args: Row): Promise<unknown> => {
    for (const key of Object.keys(args)) boundValues(args[key]);
    assertBindBudget(args["where"], provider);
    return (model as unknown as Record<string, (input: Row) => PromiseLike<unknown>>)[method]!(args);
  };
  const many = async (method: "findMany" | "groupBy", args: Row): Promise<Row[]> => (await run(method, args)) as Row[];
  const where = (node: PrismaNode): PrismaWhere => toWhere(node);
  const select = (fields: readonly PlanColumn[]): Row => {
    const out: Row = {};
    for (const column of fields) own(out, column.field, true);
    return out;
  };
  const fromRow = (row: Row, projection: readonly PlanColumn[]): Row => {
    const out: Row = {};
    for (const column of projection) own(out, column.id, plainValue(column, get(row, column.field)));
    return out;
  };
  const tooMany = (rows: readonly unknown[]): void => {
    if (rows.length > maxGroupRows) throw new QueryError("limit-exceeded", ["spec", "groupBy"]);
  };

  const capabilities: AdapterCapabilities = {
    // SQLite: LIKE folds ASCII case and has no ESCAPE clause, `=` never folds, and `mode` is an unknown argument.
    caseInsensitiveText: pg ? "native" : "like-only",
    ...(pg ? {} : { caseSensitiveLike: false }),
    likeEscape: pg,
    literalAsterisk: true,
    nullsLast: pg ? "native" : "emulated",
    aggregates: true,
    groupBy: true,
    localDayGrouping: false,
    // Prisma reads a PostgreSQL DateTime in milliseconds, so a microsecond key would not compare back equal.
    exactInstantKeys: !pg,
    // Prisma's enum and `@db.Uuid` filters have no `contains`, `startsWith`, or `endsWith`.
    nativeLike: false,
    // `groupBy` takes fields only, and the object API has no `NULLIF(col, '')`.
    expressionValues: false,
    blankTextAggregates: false,
    // A two-field `groupBy` returns one row per group and key, past `maxGroupRows` at a full page.
    pivot: false,
    maxBoundIds: maxBoundIds(provider),
  };

  const pairWhere = (plan: GroupsPlan, keys: readonly unknown[], withBlank: boolean): PrismaWhere => {
    const { level } = plan;
    const blankLevel = withBlank ? renderer.blank(level, false, false, foldsEmptyText(level)) : false;
    return where(and([renderer.node(plan.where), or([keys.length > 0 ? oneOf(level, keys) : false, blankLevel])]));
  };
  const selectGroupPage = async (plan: GroupsPlan, page: { offset: number; limit: number }): Promise<RawGroupRow[]> => {
    assertAggregates(plan.aggregates);
    const { level } = plan;
    const base = renderer.node(plan.where);
    const emptyIsBlank = foldsEmptyText(level);
    const blankLevel = renderer.blank(level, false, false, emptyIsBlank);
    const keyed = where(and([base, renderer.blank(level, true, false, emptyIsBlank)]));
    const selection = aggregateSelection(plan.aggregates);
    own((selection["_count"] ??= {}), "_all", true);
    const order = [own({}, level.field, plan.direction)];
    const found = await many("groupBy", { by: [level.field], where: keyed, ...selection, orderBy: order, skip: page.offset, take: page.limit });
    const groupRow = (group: unknown, key: unknown): RawGroupRow => ({
      key: plainValue(level, key),
      count: get(get(group, "_count"), "_all"),
      childCount: null,
      aggregates: aggregateValues(group, plan.aggregates),
    });
    const keys = found.map((group) => get(group, level.field));
    const rows = found.map((group, index) => groupRow(group, keys[index]));
    // The blank group sorts last in both directions: it is on this page when the non-blank groups end inside it.
    const endsHere = async () => found.length > 0 || page.offset === 0 || (await many("groupBy", { by: [level.field], where: keyed, orderBy: order, skip: page.offset - 1, take: 1 })).length > 0;
    let blankOnPage = false;
    if (blankLevel !== false && found.length < page.limit && (await endsHere())) {
      const blank = await run("aggregate", { where: where(and([base, blankLevel])), ...selection });
      blankOnPage = Number(get(get(blank, "_count"), "_all")) > 0;
      if (blankOnPage) rows.push(groupRow(blank, null));
    }
    const next = plan.nextLevel;
    if (!next || rows.length === 0) return rows;
    // `_count` is COUNT(col), not a distinct count, so the child groups come from a second groupBy over this page's keys.
    const pairs = await many("groupBy", {
      by: [level.field, next.field],
      where: pairWhere(plan, keys, blankOnPage),
      orderBy: [own({}, level.field, "asc"), own({}, next.field, "asc")],
      take: maxGroupRows + 1,
    });
    tooMany(pairs);
    // A set per level key: the `''` and NULL rows of either level fold into one group.
    const children = new Map<string, Set<string>>();
    for (const pair of pairs) {
      const id = keyId(level, get(pair, level.field));
      const set = children.get(id) ?? new Set<string>();
      set.add(keyId(next, get(pair, next.field)));
      children.set(id, set);
    }
    const groupKeys = [...keys, ...(blankOnPage ? [null] : [])];
    return rows.map((row, index) => ({ ...row, childCount: children.get(keyId(level, groupKeys[index]))?.size ?? 0 }));
  };

  return createGridQuery<TRow, TContext, PrismaWhere, PrismaOrderBy, string>({
    columns,
    rowScope: options.rowScope,
    rowCount: options.rowCount,
    limits: options.limits,
    timeZone: options.timeZone,
    paging: options.paging,
    executor: {
      capabilities,
      where: (plan) => {
        const rendered = where(renderer.node(plan.where));
        // A write's `data` binds one value per written field, at most one per mapped column, next to the take and skip reserve.
        assertBindBudget(rendered, provider, 2 + mapOf(columns).byId.size);
        return rendered;
      },
      orderBy: (plan) => renderer.orderBy(plan.orderBy),
      nativeValue: writeValue,
      selectRows: async (plan, page) => {
        const keyText = plan.keyText ?? [];
        const fields = select([...plan.projection, ...keyText.map(({ column }) => column)]);
        const rows = await many("findMany", { where: where(renderer.node(plan.where)), orderBy: renderer.orderBy(plan.orderBy), skip: page.offset, take: page.limit, select: fields });
        return rows.map((row) => {
          const out = fromRow(row, plan.projection);
          // Only SQLite asks for `keyText`: the stored text or integer is the exact key, a `DateTime` a millisecond `Date`.
          for (const { column, as } of keyText) {
            const raw = get(row, column.field);
            own(out, as, raw instanceof Date ? raw.toISOString() : raw);
          }
          return out;
        });
      },
      countRows: async (plan) => run("count", { where: where(renderer.node(plan.where)) }),
      selectValues: async (plan, { limit }) => {
        const { column } = plan;
        if (column.time || (isTextual(column) && !column.caseSensitive) || (!isTextual(column) && plan.query !== "")) throw unsupported(column);
        const base = renderer.node(plan.where);
        const matched = plan.query === "" ? base : and([base, field(column, renderer.textFilter(column, "contains", plan.query, false))]);
        const emptyIsBlank = foldsEmptyText(column);
        const groups = await many("groupBy", {
          by: [column.field],
          where: where(and([matched, renderer.blank(column, true, false, emptyIsBlank)])),
          _count: own({}, column.field, true),
          orderBy: [{ _count: own({}, column.field, "desc") }, own({}, column.field, "asc")],
          take: limit,
        });
        const found = groups.map((group) => ({ value: plainValue(column, get(group, column.field)), count: get(get(group, "_count"), column.field) }));
        const blank = renderer.blank(column, false, false, emptyIsBlank);
        // A value query never matches a blank value.
        if (plan.query === "" && blank !== false) {
          const count = await run("count", { where: where(and([base, blank])) });
          if (Number(count) > 0) found.push({ value: null, count });
        }
        return found;
      },
      aggregate: async (plan) => {
        assertAggregates(plan.columns);
        return aggregateValues(await run("aggregate", { where: where(renderer.node(plan.where)), ...aggregateSelection(plan.columns) }), plan.columns);
      },
      selectGroups: selectGroupPage,
      countGroups: async (plan) => {
        const { level } = plan;
        const groups = await many("groupBy", { by: [level.field], where: where(renderer.node(plan.where)), orderBy: [own({}, level.field, "asc")], take: maxGroupRows + 1 });
        tooMany(groups);
        // NULL and `''` are one group, as the SQL renderers' NULLIF folds them.
        const blank = groups.some((group) => isBlankValue(level, get(group, level.field)));
        return groups.filter((group) => !isBlankValue(level, get(group, level.field))).length + (blank ? 1 : 0);
      },
    },
  });
}
