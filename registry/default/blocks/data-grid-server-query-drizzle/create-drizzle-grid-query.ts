import { type Column, SQL, type Table, getTableColumns, sql } from "drizzle-orm";
import type { AdapterCapabilities, ColumnMap, GridQuery, QueryLimits, RowCountMode, RowScope } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import {
  type CustomHandler,
  type PlanColumn,
  type SqlAlgebra,
  assertCustomOperatorHandlers,
  createGridQuery,
  createSqlRenderer,
  mapOf,
} from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";

type Rows = Record<string, unknown>[];
type Builder = PromiseLike<Rows> & {
  from(table: Table): Builder;
  where(condition: SQL): Builder;
  orderBy(...order: SQL[]): Builder;
  groupBy(...group: SQL[]): Builder;
  limit(count: number): Builder;
  offset(count: number): Builder;
};

/** A Drizzle database of any driver. */
export type DrizzleDatabase = { select: (...args: never[]) => unknown };

export type DrizzleGridQueryOptions<TContext = never> = {
  db: DrizzleDatabase;
  table: Table;
  columns: ColumnMap;
  /** Equalities on mapped columns that every query ANDs in. Needs `context` on every call. */
  rowScope?: RowScope<TContext>;
  /** When a rows request also counts the result. Default `"firstBlock"`. */
  rowCount?: RowCountMode;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
  /** Handlers for the custom operators the column map declares; each returns a Drizzle `sql` fragment and must bind `value` through it. */
  customOperators?: Record<string, (ctx: { column: PlanColumn; value: unknown }) => SQL>;
  /** `"cursor"` pages `fetchRows` by keyset cursors and never counts; every sortable text column then needs `maxLength`. Default `"offset"`. */
  paging?: "offset" | "cursor";
};

/** Reads and counts rows with Drizzle, from the column map and a request body. */
export function createDrizzleGridQuery<TRow = Record<string, unknown>, TContext = never>(options: DrizzleGridQueryOptions<TContext> & { paging: "cursor" }): GridQuery<TRow, TContext, SQL, SQL, string>;
export function createDrizzleGridQuery<TRow = Record<string, unknown>, TContext = never>(options: DrizzleGridQueryOptions<TContext> & { paging?: "offset" }): GridQuery<TRow, TContext, SQL, SQL>;
/** A `paging` known only at run time may page by cursor, so the answer's cursor is typed. */
export function createDrizzleGridQuery<TRow = Record<string, unknown>, TContext = never>(options: DrizzleGridQueryOptions<TContext>): GridQuery<TRow, TContext, SQL, SQL, string>;
export function createDrizzleGridQuery<TRow, TContext>(options: DrizzleGridQueryOptions<TContext>): GridQuery<TRow, TContext, SQL, SQL, string> {
  const { db, table, columns } = options;
  const tableColumns = getTableColumns(table) as Record<string, Column>;
  const first = Object.values(tableColumns)[0];
  const dialect = first?.columnType.startsWith("SQLite") ? "sqlite" : "pg";
  const physical = new Map<string, Column>();
  for (const column of mapOf(columns).byId.values()) {
    const found = Object.hasOwn(tableColumns, column.field) ? tableColumns[column.field] : undefined;
    if (!found) throw new Error(`createDrizzleGridQuery: the table has no column "${column.field}" for "${column.id}"`);
    physical.set(column.id, found);
  }
  assertCustomOperatorHandlers(columns, options.customOperators);
  const algebra: SqlAlgebra<SQL> = {
    dialect,
    raw: (text) => sql.raw(text),
    // Drizzle expands a bare array into one parameter per entry; `sql.param` binds an id list as one.
    param: (value) => (Array.isArray(value) ? sql`${sql.param(value)}` : sql`${value}`),
    column: (column) => sql`${physical.get(column.id)!}`,
    cat: (...parts) => sql.join(parts, sql.raw("")),
    native: (value) => {
      if (!(value instanceof SQL)) throw new Error("customOperators: a handler must return a Drizzle sql fragment");
      return value;
    },
  };
  const renderer = createSqlRenderer(algebra, new Map(Object.entries(options.customOperators ?? {})) as ReadonlyMap<string, CustomHandler>);
  const selectFrom = (fields: Record<string, unknown>) => (db as unknown as { select(fields: Record<string, unknown>): { from(table: Table): Builder } }).select(fields).from(table);
  const capabilities: AdapterCapabilities = {
    caseInsensitiveText: dialect === "pg" ? "collation" : "ascii",
    likeEscape: true,
    literalAsterisk: true,
    nullsLast: "native",
    aggregates: true,
    groupBy: true,
    localDayGrouping: dialect === "pg",
    exactInstantKeys: true,
    pivot: true,
  };

  return createGridQuery<TRow, TContext, SQL, SQL, string>({
    columns,
    rowScope: options.rowScope,
    rowCount: options.rowCount,
    limits: options.limits,
    timeZone: options.timeZone,
    paging: options.paging,
    executor: {
      capabilities,
      where: (plan) => renderer.predicate(plan.where),
      orderBy: (plan) => renderer.orderBy(plan.orderBy),
      selectRows: (plan, page) => {
        const fields: Record<string, unknown> = Object.fromEntries(plan.projection.map((column) => [column.id, physical.get(column.id)!]));
        for (const { column, as } of plan.keyText ?? []) fields[as] = renderer.keyText(column);
        return Promise.resolve(selectFrom(fields).where(renderer.predicate(plan.where)).orderBy(renderer.orderBy(plan.orderBy)).limit(page.limit).offset(page.offset));
      },
      countRows: async (plan) => {
        const rows = await selectFrom({ n: sql`count(*)` }).where(renderer.predicate(plan.where));
        return rows[0]?.["n"];
      },
      selectValues: (plan, { limit }) => {
        const { key, value } = renderer.valueKey(plan.column, options.timeZone ?? "UTC");
        return Promise.resolve(
          selectFrom({ value, count: sql`count(*)` })
            .where(renderer.valuesFilter(plan, options.timeZone ?? "UTC"))
            .groupBy(key)
            .orderBy(sql`count(*) DESC`, sql`${value} ASC`)
            .limit(limit),
        ) as Promise<{ value: unknown; count: unknown }[]>;
      },
      selectGroups: async (plan, page) => {
        const key = renderer.groupKey(plan.level);
        const fields: Record<string, unknown> = { k: key, n: sql`count(*)`, c: plan.nextLevel ? renderer.keyCount(renderer.groupKey(plan.nextLevel)) : sql`count(*)` };
        plan.aggregates.forEach(({ column, reducer }, index) => (fields[`a${index}`] = renderer.aggregate(column, reducer)));
        const where = renderer.predicate(plan.where);
        const order = sql`${key} ${sql.raw(plan.direction === "asc" ? "ASC" : "DESC")} NULLS LAST`;
        const toGroup = (row: Rows[number]) => ({ key: row["k"], count: row["n"], childCount: row["c"], aggregates: Object.fromEntries(plan.aggregates.map(({ column }, index) => [column.id, row[`a${index}`]])) });
        if (!plan.pivot) {
          const rows = await selectFrom(fields).where(where).groupBy(key).orderBy(order).limit(page.limit).offset(page.offset);
          return rows.map(toGroup);
        }
        const cells = renderer.pivotCells(plan);
        cells.forEach((cell, index) => (fields[`p${index}`] = cell));
        const { name, key: pageKey } = renderer.pivotPage;
        const withPage = db as unknown as { $with(alias: string): { as(query: Builder): unknown }; with(...ctes: unknown[]): { select(fields: Record<string, unknown>): { from(table: Table): Builder } } };
        const pageCte = withPage.$with(name).as(selectFrom({ [pageKey]: sql`${key}`.as(pageKey) }).where(where).groupBy(key).orderBy(order).limit(page.limit).offset(page.offset));
        const rows = await withPage.with(pageCte).select(fields).from(table).where(sql`(${where}) AND ${renderer.pageBound(plan.level)}`).groupBy(key).orderBy(order);
        return rows.map((row) => ({ ...toGroup(row), pivotCells: cells.map((_, index) => row[`p${index}`]) }));
      },
      selectPivotKeys: async (plan, { limit }) => {
        const key = renderer.groupKey(plan.level);
        const rows = await selectFrom({ k: key, t: sql`count(*) over ()` })
          .where(renderer.predicate(plan.where))
          .groupBy(key)
          .orderBy(sql`${key} ${sql.raw(plan.direction === "asc" ? "ASC" : "DESC")} NULLS LAST`)
          .limit(limit);
        return rows.map((row) => ({ key: row["k"], total: row["t"] }));
      },
      countGroups: async (plan) => (await selectFrom({ n: renderer.keyCount(renderer.groupKey(plan.level)) }).where(renderer.predicate(plan.where)))[0]?.["n"],
      aggregate: async (plan) => {
        const fields = Object.fromEntries(plan.columns.map(({ column, reducer }, index) => [`c${index}`, renderer.aggregate(column, reducer)]));
        const rows = await selectFrom(fields).where(renderer.predicate(plan.where));
        const row = rows[0] ?? {};
        return Object.fromEntries(plan.columns.map(({ column }, index) => [column.id, row[`c${index}`]]));
      },
    },
  });
}
