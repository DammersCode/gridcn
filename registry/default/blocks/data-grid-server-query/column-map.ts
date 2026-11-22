/** The cell-type names the column map understands. A custom cell type declares `kind` instead. */
export type ColumnType = "text" | "number" | "checkbox" | "select" | "date" | "url" | "longText";
export type ColumnKind = "text" | "number" | "checkbox" | "select" | "date";
export type NumericType = "int2" | "int4" | "int8" | "float" | "decimal";
export type DateStorage = "native" | "iso-text" | "epoch-ms" | "epoch-s";
export type AggregateReducer = "sum" | "avg" | "min" | "max" | "count";
export type NativeStringType = "enum" | "uuid";
export type OperatorInput = "none" | "single" | "range" | "list";

/** A custom operator a column accepts next to the 15 built-ins. */
export type ColumnOperator = { id: string; label: string; input: OperatorInput };

/** What a request may do with one column, and how the column is stored. */
export type ColumnSpec = {
  /** Grid cell-type name. `url` and `longText` behave as `text`. A name outside the list needs `kind`. */
  type: ColumnType | (string & {});
  /** Behavior of a custom cell type. */
  kind?: ColumnKind;
  /** Physical column name when it differs from the id. */
  field?: string;
  primaryKey?: boolean;
  /** Never selected, filtered, sorted, searched, or aggregated for the client; usable by `rowScope`. */
  serverOnly?: boolean;
  /** Quick search covers only columns that set this. */
  searchable?: boolean;
  /** `false` rejects a filter on the column. Default `true`. */
  filterable?: boolean;
  /** `false` rejects a sort on the column. Default `true`. */
  sortable?: boolean;
  /** A write or import refuses a blank value. It promises no NOT NULL. */
  required?: boolean;
  caseSensitive?: boolean;
  /** A stored `''` is a value, not empty. */
  keepBlankText?: boolean;
  /** A `date` column that holds instants; day-bound expansion applies to it. */
  time?: boolean;
  storage?: DateStorage;
  /** Physical PostgreSQL type of a `text` or `select` column that is not text. */
  native?: NativeStringType;
  /** Physical number type. Required on every `number` column. */
  numeric?: NumericType;
  /** Decimal places of a `decimal` column. */
  scale?: number;
  choices?: readonly string[];
  maxLength?: number;
  aggregate?: AggregateReducer;
  operators?: readonly ColumnOperator[];
};

/** A column after validation. */
export type PlanColumn = Readonly<{
  id: string;
  field: string;
  kind: ColumnKind;
  numeric?: NumericType;
  scale?: number;
  native?: NativeStringType;
  time: boolean;
  storage: DateStorage;
  caseSensitive: boolean;
  keepBlankText: boolean;
  required: boolean;
  primaryKey: boolean;
  serverOnly: boolean;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  choices?: readonly string[];
  maxLength?: number;
  aggregate?: AggregateReducer;
  operators: ReadonlyMap<string, ColumnOperator>;
  type: string;
}>;

/** Whether the column holds text: a `text` or a `select` column. */
export const isTextual = (column: PlanColumn): boolean => column.kind === "text" || column.kind === "select";

export type ColumnMapOptions<Id extends string = string> = {
  /** Unique, non-null, non-`serverOnly` columns that order rows when the map has no `primaryKey`. */
  tieBreaker?: readonly Id[];
};

declare const columnMapBrand: unique symbol;

/** The allow-list, the projection, and the semantics of the columns a request may name. */
export type ColumnMap<Id extends string = string> = {
  readonly [columnMapBrand]: Id;
  /** Every column, `serverOnly` included, by id. */
  readonly byId: ReadonlyMap<string, PlanColumn>;
  /** The columns the client sees, in map order. */
  readonly visible: readonly PlanColumn[];
  /** The columns that give rows a total order. */
  readonly tieBreaker: readonly PlanColumn[];
};

export const MAX_SEARCH_COLUMNS = 16;

const BUILT_IN_KINDS = new Map<string, ColumnKind>([
  ["text", "text"],
  ["url", "text"],
  ["longText", "text"],
  ["number", "number"],
  ["checkbox", "checkbox"],
  ["select", "select"],
  ["date", "date"],
]);
const NUMERIC_TYPES: ReadonlySet<string> = new Set<NumericType>(["int2", "int4", "int8", "float", "decimal"]);
const STORAGES: ReadonlySet<string> = new Set<DateStorage>(["native", "iso-text", "epoch-ms", "epoch-s"]);
const REDUCERS: ReadonlySet<string> = new Set<AggregateReducer>(["sum", "avg", "min", "max", "count"]);
const INPUTS: ReadonlySet<string> = new Set<OperatorInput>(["none", "single", "range", "list"]);
const BUILT_IN_OPERATOR_IDS: ReadonlySet<string> = new Set([
  "contains", "notContains", "equals", "notEquals", "startsWith", "endsWith", "empty", "notEmpty",
  "gt", "gte", "lt", "lte", "isBetween", "isAnyOf", "isNoneOf",
]);

export function isBuiltInOperatorId(id: string): boolean {
  return BUILT_IN_OPERATOR_IDS.has(id);
}

function fail(id: string, message: string): never {
  throw new Error(`defineColumnMap: column "${id}" ${message}`);
}

function resolveColumn(id: string, spec: ColumnSpec): PlanColumn {
  const kind = spec.kind ?? BUILT_IN_KINDS.get(spec.type);
  if (kind === undefined) return fail(id, `has type "${spec.type}"; declare \`kind\` for a custom cell type`);
  if (spec.field !== undefined && (typeof spec.field !== "string" || spec.field === "")) fail(id, "has an empty field");
  if (kind === "number") {
    if (spec.numeric === undefined || !NUMERIC_TYPES.has(spec.numeric)) fail(id, "is a number column and needs `numeric`: int2, int4, int8, float, or decimal");
    if (spec.scale !== undefined && (spec.numeric !== "decimal" || !Number.isInteger(spec.scale) || spec.scale < 0)) fail(id, "has `scale` without `numeric: \"decimal\"`, or a scale that is not a non-negative integer");
  } else if (spec.numeric !== undefined || spec.scale !== undefined) fail(id, "sets `numeric` or `scale` on a column that is not a number");
  if (spec.native !== undefined) {
    if (kind !== "text" && kind !== "select") fail(id, "sets `native` on a column that is not text or select");
    if (spec.native === "enum" && (spec.choices === undefined || spec.choices.length === 0)) fail(id, "is a native enum and needs `choices`");
  }
  if (spec.storage !== undefined && !STORAGES.has(spec.storage)) fail(id, `has unknown storage "${spec.storage}"`);
  if (spec.time && kind !== "date") fail(id, "sets `time` on a column that is not a date");
  if (spec.aggregate !== undefined) {
    if (!REDUCERS.has(spec.aggregate)) fail(id, `has unknown aggregate "${spec.aggregate}"`);
    if ((spec.aggregate === "sum" || spec.aggregate === "avg") && kind !== "number") fail(id, `cannot ${spec.aggregate} a column that is not a number`);
  }
  if (spec.searchable && (kind === "date" || kind === "checkbox")) fail(id, "is searchable but holds a date or checkbox");
  if (spec.serverOnly && spec.primaryKey) fail(id, "is a primary key and cannot be serverOnly: rows would carry no id");
  const operators = new Map<string, ColumnOperator>();
  for (const operator of spec.operators ?? []) {
    if (typeof operator?.id !== "string" || operator.id === "" || BUILT_IN_OPERATOR_IDS.has(operator.id) || operators.has(operator.id)) fail(id, "declares an operator with a missing, built-in, or duplicate id");
    if (typeof operator.label !== "string" || !INPUTS.has(operator.input)) fail(id, `declares operator "${operator.id}" without a label or a valid input`);
    operators.set(operator.id, { id: operator.id, label: operator.label, input: operator.input });
  }
  return Object.freeze({
    id,
    field: spec.field ?? id,
    kind,
    numeric: spec.numeric,
    scale: spec.scale,
    native: spec.native,
    time: spec.time === true,
    storage: spec.storage ?? "native",
    caseSensitive: spec.caseSensitive === true,
    keepBlankText: spec.keepBlankText === true,
    required: spec.required === true,
    primaryKey: spec.primaryKey === true,
    serverOnly: spec.serverOnly === true,
    searchable: spec.searchable === true,
    filterable: spec.filterable !== false,
    sortable: spec.sortable !== false,
    choices: spec.choices ? Object.freeze([...spec.choices]) : undefined,
    maxLength: spec.maxLength,
    aggregate: spec.aggregate,
    operators,
    type: spec.type,
  });
}

/**
 * Validates the columns of a table and returns the map every query reads. A column maps to one physical column.
 *
 * @example
 * const columns = defineColumnMap({
 *   id: { type: "number", numeric: "int8", primaryKey: true },
 *   name: { type: "text", searchable: true },
 *   tenantId: { type: "number", numeric: "int4", serverOnly: true },
 * });
 */
export function defineColumnMap<const C extends Record<string, ColumnSpec>>(columns: C, options: ColumnMapOptions<keyof C & string> = {}): ColumnMap<keyof C & string> {
  const byId = new Map<string, PlanColumn>();
  for (const id of Object.keys(columns)) byId.set(id, resolveColumn(id, columns[id]!));
  if (byId.size === 0) throw new Error("defineColumnMap: the map needs at least one column");
  const primaryKeys = [...byId.values()].filter((column) => column.primaryKey);
  if (primaryKeys.length > 1) throw new Error("defineColumnMap: at most one primaryKey; use `tieBreaker` for a composite key");
  const tieBreakerIds = options.tieBreaker ?? [];
  const tieBreaker: PlanColumn[] = [];
  if (primaryKeys.length === 1 && tieBreakerIds.length === 0) tieBreaker.push(primaryKeys[0]!);
  else if (tieBreakerIds.length > 0) {
    if (primaryKeys.length === 1) throw new Error("defineColumnMap: pass `primaryKey` or `tieBreaker`, not both");
    for (const id of tieBreakerIds) {
      const column = byId.get(id);
      if (!column || column.serverOnly || tieBreaker.includes(column)) throw new Error(`defineColumnMap: tieBreaker "${id}" is unknown, serverOnly, or repeated`);
      tieBreaker.push(column);
    }
  } else throw new Error("defineColumnMap: mark one column `primaryKey` or pass `tieBreaker`, so every sort is a total order");
  const searchable = [...byId.values()].filter((column) => column.searchable && !column.serverOnly);
  if (searchable.length > MAX_SEARCH_COLUMNS) throw new Error(`defineColumnMap: at most ${MAX_SEARCH_COLUMNS} searchable columns`);
  const visible = [...byId.values()].filter((column) => !column.serverOnly);
  return Object.freeze({ byId, visible, tieBreaker }) as unknown as ColumnMap<keyof C & string>;
}

/** The internal view of a map; the brand type hides it from callers. */
export function mapOf(columns: ColumnMap): { byId: ReadonlyMap<string, PlanColumn>; visible: readonly PlanColumn[]; tieBreaker: readonly PlanColumn[] } {
  return columns as unknown as { byId: ReadonlyMap<string, PlanColumn>; visible: readonly PlanColumn[]; tieBreaker: readonly PlanColumn[] };
}
