import { type Column, type Table, getTableColumns } from "drizzle-orm";
import { type ColumnMap, type ColumnSpec, defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { isDev } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";

export type ColumnsFromDrizzleTableOptions<Id extends string> = {
  /** The columns the client may see, by the table's property names. Required: no helper maps a whole table. */
  pick: readonly Id[];
  /** Per-column changes to the generated spec. */
  overrides?: { [K in Id]?: Partial<ColumnSpec> };
  /** Columns that order rows when the table has no single-column primary key. */
  tieBreaker?: readonly Id[];
};

const SMALL = new Set(["PgSmallInt", "PgSmallSerial"]);
const INT53 = new Set(["PgBigInt53", "PgBigSerial53", "SQLiteInteger"]);
const FLOAT = new Set(["PgReal", "PgDoublePrecision", "SQLiteReal"]);

function specFor(id: string, column: Column): ColumnSpec {
  const columnType = column.columnType;
  const base = { required: column.notNull, primaryKey: column.primary, field: id };
  const sqlite = columnType.startsWith("SQLite");
  switch (column.dataType) {
    case "number":
      if (columnType.endsWith("NumericNumber")) return { ...base, type: "number", numeric: "decimal" };
      if (FLOAT.has(columnType)) return { ...base, type: "number", numeric: "float" };
      return { ...base, type: "number", numeric: SMALL.has(columnType) ? "int2" : INT53.has(columnType) ? "int8" : "int4" };
    case "bigint":
      if (columnType.endsWith("NumericBigInt")) return { ...base, type: "number", numeric: "decimal" };
      return { ...base, type: "number", numeric: "int8" };
    case "boolean":
      return { ...base, type: "checkbox" };
    case "date":
      if (columnType === "PgTimestamp") return { ...base, type: "date", time: true, storage: "native" };
      if (sqlite) return { ...base, type: "date", time: true, storage: (column as unknown as { mode?: string }).mode === "timestamp_ms" ? "epoch-ms" : "epoch-s" };
      return { ...base, type: "date" };
    case "string": {
      if (columnType === "PgNumeric" || columnType === "SQLiteNumeric") {
        const scale = (column as unknown as { scale?: number }).scale;
        return { ...base, type: "number", numeric: "decimal", ...(scale === undefined || scale === null ? {} : { scale }) };
      }
      if (columnType === "PgDateString") return { ...base, type: "date" };
      if (columnType === "PgTimestampString") return { ...base, type: "date", time: true, storage: "native" };
      if (columnType === "PgEnumColumn" && column.enumValues) return { ...base, type: "select", native: "enum", choices: [...column.enumValues] };
      if (columnType === "PgUUID") return { ...base, type: "text", native: "uuid" };
      return { ...base, type: "text" };
    }
    default:
      if (isDev()) console.warn(`gridcn query layer: column "${id}" has the type ${columnType}, which the column map reads as text. Override it if that is wrong.`);
      return { ...base, type: "text" };
  }
}

/**
 * Builds the column map of picked Drizzle columns: kinds, nullability, enums, uuids, decimals, and the primary key come
 * from the schema. Adjust one column with `overrides`.
 *
 * @example
 * const columns = columnsFromDrizzleTable(users, { pick: ["id", "name", "tenantId"], overrides: { name: { searchable: true } } });
 */
export function columnsFromDrizzleTable<TTable extends Table, Id extends keyof TTable["_"]["columns"] & string>(table: TTable, options: ColumnsFromDrizzleTableOptions<Id>): ColumnMap<Id> {
  const all = getTableColumns(table) as Record<string, Column>;
  const specs: Record<string, ColumnSpec> = {};
  const primaries = options.pick.filter((id) => all[id]?.primary);
  const overrides = options.overrides as Record<string, Partial<ColumnSpec>> | undefined;
  for (const id of options.pick) {
    const column = Object.hasOwn(all, id) ? all[id] : undefined;
    if (!column) throw new Error(`columnsFromDrizzleTable: the table has no column "${id}"`);
    const generated = specFor(id, column);
    if (primaries.length > 1) generated.primaryKey = false;
    specs[id] = { ...generated, ...(overrides && Object.hasOwn(overrides, id) ? overrides[id] : {}) };
  }
  const tieBreaker = options.tieBreaker ?? (primaries.length > 1 ? primaries : undefined);
  return defineColumnMap(specs, tieBreaker ? { tieBreaker } : {}) as unknown as ColumnMap<Id>;
}
