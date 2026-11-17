import { type ColumnMap, type ColumnOperator, mapOf } from "./column-map";

export type BuiltInOperatorName =
  | "contains" | "notContains" | "equals" | "notEquals" | "startsWith" | "endsWith" | "empty" | "notEmpty"
  | "gt" | "gte" | "lt" | "lte" | "isBetween" | "isAnyOf" | "isNoneOf";

/** What the client may offer for one column. */
export type ColumnDescriptor = {
  operators: (BuiltInOperatorName | ColumnOperator)[];
  filterable: boolean;
  sortable: boolean;
};

/** Serializable; the columns the client sees, by id. */
export type ColumnMapDescriptor = Record<string, ColumnDescriptor>;

const TEXT: readonly BuiltInOperatorName[] = ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith", "empty", "notEmpty"];
const COMPARISON: readonly BuiltInOperatorName[] = ["gt", "gte", "lt", "lte", "isBetween"];
const SET: readonly BuiltInOperatorName[] = ["isAnyOf", "isNoneOf"];
const TEXT_ONLY = new Set<string>(["contains", "notContains", "startsWith", "endsWith"]);
const ORDERING = new Set<string>(COMPARISON);
const CELL_TYPES = new Set(["text", "url", "longText", "number", "checkbox", "select", "date"]);

/** The operator list the client defaults to for a cell-type name (`operatorsForColumnType`). */
export function defaultOperatorsFor(typeName: string): BuiltInOperatorName[] {
  if (typeName === "number" || typeName === "date") return [...TEXT, ...COMPARISON, ...SET];
  if (typeName === "select" || typeName === "text") return [...TEXT, ...SET];
  return [...TEXT];
}

/**
 * Lists, for each column the client sees, the operators the server accepts. Pass an entry's `operators` as
 * `ColumnDef.filterOperators`, so the filter UI offers nothing the server refuses.
 */
export function describeFilterOperators(columns: ColumnMap): ColumnMapDescriptor {
  const out: ColumnMapDescriptor = {};
  for (const column of mapOf(columns).visible) {
    const typeName = CELL_TYPES.has(column.type) ? column.type : column.kind;
    const operators = defaultOperatorsFor(typeName).filter((operator) => {
      if ((column.kind === "number" || column.kind === "date" || column.kind === "checkbox") && TEXT_ONLY.has(operator)) return false;
      if ((column.kind === "checkbox" || column.kind === "select" || column.native !== undefined) && ORDERING.has(operator)) return false;
      return true;
    });
    out[column.id] = { operators: [...operators, ...column.operators.values()], filterable: column.filterable, sortable: column.sortable };
  }
  return out;
}
