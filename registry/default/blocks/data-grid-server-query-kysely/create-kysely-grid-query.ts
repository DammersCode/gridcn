import { type Expression, type Kysely, type RawBuilder, sql } from "kysely";
import type { AdapterCapabilities, ColumnMap, GridQuery, QueryLimits, RowCountMode, RowScope } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import {
  type CustomHandler,
  type PlanColumn,
  type SqlAlgebra,
  assertCustomOperatorHandlers,
  createGridQuery,
  createSqlRenderer,
} from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";

type Fragment = RawBuilder<unknown>;
type Rows = Record<string, unknown>[];

export type KyselyGridQueryOptions<TContext = never> = {
  db: Kysely<any>;
  /** The table name. */
  table: string;
  dialect: "pg" | "sqlite";
  columns: ColumnMap;
  /** Equalities on mapped columns that every query ANDs in. Needs `context` on every call. */
  rowScope?: RowScope<TContext>;
  /** When a rows request also counts the result. Default `"firstBlock"`. */
  rowCount?: RowCountMode;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
  /** Handlers for the custom operators the column map declares; each returns a Kysely expression and must bind `value` through it. */
  customOperators?: Record<string, (ctx: { column: PlanColumn; value: unknown }) => Expression<unknown>>;
};

const isExpression = (value: unknown): value is Expression<unknown> => typeof value === "object" && value !== null && "toOperationNode" in value;

/** Reads and counts rows with Kysely, from the column map and a request body. */
export function createKyselyGridQuery<TRow = Record<string, unknown>, TContext = never>(options: KyselyGridQueryOptions<TContext>): GridQuery<TRow, TContext, Fragment, Fragment> {
  const { db, table, dialect, columns } = options;
  assertCustomOperatorHandlers(columns, options.customOperators);
  const algebra: SqlAlgebra<Fragment> = {
    dialect,
    raw: (text) => sql.raw(text),
    param: (value) => sql`${sql.val(value)}`,
    column: (column) => sql.id(table, column.field),
    cat: (...parts) => sql.join(parts, sql.raw("")),
    native: (value) => {
      if (!isExpression(value)) throw new Error("customOperators: a handler must return a Kysely expression");
      return sql`${value}`;
    },
  };
  const renderer = createSqlRenderer(algebra, new Map(Object.entries(options.customOperators ?? {})) as ReadonlyMap<string, CustomHandler>);
  const run = async (query: Fragment): Promise<Rows> => (await query.execute(db)).rows as Rows;
  const capabilities: AdapterCapabilities = {
    caseInsensitiveText: dialect === "pg" ? "collation" : "ascii",
    likeEscape: true,
    literalAsterisk: true,
    nullsLast: "native",
    aggregates: true,
    groupBy: true,
    localDayGrouping: dialect === "pg",
  };
  const from = sql`from ${sql.id(table)}`;
  const aliasList = (items: { alias: string; expr: Fragment }[]): Fragment => sql.join(items.map(({ alias, expr }) => sql`${expr} as ${sql.id(alias)}`));

  return createGridQuery<TRow, TContext, Fragment, Fragment>({
    columns,
    rowScope: options.rowScope,
    rowCount: options.rowCount,
    limits: options.limits,
    timeZone: options.timeZone,
    executor: {
      capabilities,
      where: (plan) => renderer.predicate(plan.where),
      orderBy: (plan) => renderer.orderBy(plan.orderBy),
      selectRows: (plan, page) => {
        const list = aliasList(plan.projection.map((column) => ({ alias: column.id, expr: sql.id(table, column.field) })));
        return run(sql`select ${list} ${from} where ${renderer.predicate(plan.where)} order by ${renderer.orderBy(plan.orderBy)} limit ${sql.val(page.limit)} offset ${sql.val(page.offset)}`);
      },
      countRows: async (plan) => (await run(sql`select count(*) as ${sql.id("n")} ${from} where ${renderer.predicate(plan.where)}`))[0]?.["n"],
      selectValues: (plan, { limit }) => {
        const { key, value } = renderer.valueKey(plan.column, options.timeZone ?? "UTC");
        return run(
          sql`select ${value} as ${sql.id("value")}, count(*) as ${sql.id("count")} ${from} where ${renderer.valuesFilter(plan, options.timeZone ?? "UTC")} group by ${key} order by count(*) desc, ${value} asc limit ${sql.val(limit)}`,
        ) as Promise<{ value: unknown; count: unknown }[]>;
      },
      aggregate: async (plan) => {
        const list = aliasList(plan.columns.map(({ column, reducer }, index) => ({ alias: `c${index}`, expr: renderer.aggregate(column, reducer) })));
        const rows = await run(sql`select ${list} ${from} where ${renderer.predicate(plan.where)}`);
        const row = rows[0] ?? {};
        return Object.fromEntries(plan.columns.map(({ column }, index) => [column.id, row[`c${index}`]]));
      },
    },
  });
}
