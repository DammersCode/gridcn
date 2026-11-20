import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import { QueryError } from "./errors";
import { type QueryLimits, resolveLimits } from "./limits";
import { type Cell, IMPORT_REFUSAL_MESSAGES, type ImportRefusalCode, readCell } from "./parse-import-rows";
import { type Operand, type Predicate, combine, leaf } from "./plan";

const WRITE_REFUSAL_MESSAGES = { ...IMPORT_REFUSAL_MESSAGES, "not-writable": "Not writable" } as const;
// Consumers cannot tune this until `QueryLimits` gains a `maxChangeOps` field.
const MAX_CHANGE_OPS = 10_000;

export type WriteRefusalCode = ImportRefusalCode | "not-writable";

/** One refused row or cell of a {@link ValidatedChange}; it assigns to the grid's `SaveRejection`. Without `columnId` the whole operation is refused. */
export type WriteRefusal = { rowId: string; columnId?: string; code: WriteRefusalCode; message: string };

/**
 * The writes of a `DataChange` that passed the column map. `values` are keyed by the physical `field`;
 * each `where` matches the row id within `rowScope`. A write whose `where` matches no row is the route's refusal to add.
 */
export type ValidatedChange<TWhere> = {
  updates: { rowId: string; values: Record<string, unknown>; where: TWhere }[];
  inserts: { rowId: string; values: Record<string, unknown> }[];
  deletes: { rowId: string; where: TWhere }[];
  moves: { rowId: string; beforeRowId?: string; afterRowId?: string; where: TWhere }[];
  rejected: WriteRefusal[];
};

export type ValidateChangeOptions = {
  columns: ColumnMap;
  limits?: QueryLimits;
  /** The `rowScope` result of the call: its predicate, and its values keyed by column id. */
  scope?: { where: Predicate; values: Readonly<Record<string, unknown>> };
};

type Raw = Record<string, unknown>;
type Limits = ReturnType<typeof resolveLimits>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const refusal = (rowId: string, code: WriteRefusalCode, columnId?: string): WriteRefusal =>
  columnId === undefined ? { rowId, code, message: WRITE_REFUSAL_MESSAGES[code] } : { rowId, columnId, code, message: WRITE_REFUSAL_MESSAGES[code] };

function writeCell(column: PlanColumn, value: unknown, limits: Limits, path: (string | number)[]): Cell {
  if ((column.kind === "text" || column.kind === "select") && typeof value === "string" && value.length > limits.maxValueLength) {
    return { ok: false, code: "too-long", message: IMPORT_REFUSAL_MESSAGES["too-long"] };
  }
  return readCell(column, value, limits, path);
}

function keyOperand(column: PlanColumn, rowId: string, limits: Limits, path: (string | number)[]): Operand | null {
  const cell = readCell(column, rowId, limits, path);
  if (!cell.ok || cell.value === null) return null;
  const value = cell.value;
  switch (column.kind) {
    case "number":
      return column.numeric === "decimal" || column.numeric === "float" ? { kind: "number", v: String(value) } : { kind: "bigint", v: BigInt(value as string | number) };
    case "checkbox":
      return { kind: "boolean", v: value as boolean };
    case "date":
      return { kind: column.time ? "instant" : "date", v: value as string };
    default:
      return { kind: "text", v: value as string };
  }
}

const optionalId = (op: Raw, key: string, limits: Limits, path: (string | number)[]): string | undefined => {
  const value = op[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new QueryError("invalid-request", [...path, key]);
  if (value.length > limits.maxValueLength) throw new QueryError("limit-exceeded", [...path, key]);
  return value;
};

/**
 * Applies the column map to the `DataChange` of `onSave`. Unmapped and `serverOnly` keys are skipped, never written;
 * the key and the `rowScope` columns are `not-writable`. A refused cell drops that cell, a refused insert drops the row.
 * A malformed change throws `invalid-request`, more than 10,000 operations `limit-exceeded`, a map without one `primaryKey` `unsupported`.
 */
export function validateChange(input: unknown, options: ValidateChangeOptions): ValidatedChange<Predicate> {
  const limits = resolveLimits(options.limits);
  const { byId } = mapOf(options.columns);
  const key = [...byId.values()].find((column) => column.primaryKey);
  if (!key) throw new QueryError("unsupported", ["ops"]);
  if (!isRecord(input) || !Array.isArray(input["ops"])) throw new QueryError("invalid-request", ["ops"]);
  const ops: unknown[] = input["ops"];
  if (ops.length > MAX_CHANGE_OPS) throw new QueryError("limit-exceeded", ["ops"]);
  const scopeValues = options.scope?.values ?? {};
  const fixed = (column: PlanColumn) => column.primaryKey || Object.hasOwn(scopeValues, column.id);
  const writable = (id: string) => {
    const column = byId.get(id);
    return column && !column.serverOnly ? column : undefined;
  };
  const result: ValidatedChange<Predicate> = { updates: [], inserts: [], deletes: [], moves: [], rejected: [] };

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    const path = ["ops", index];
    if (!isRecord(op) || typeof op["rowId"] !== "string") throw new QueryError("invalid-request", path);
    const rowId = op["rowId"];
    const type = op["type"];

    if (type === "insert") {
      const row = op["row"];
      if (!isRecord(row)) throw new QueryError("invalid-request", [...path, "row"]);
      const values: Raw = {};
      const refused: WriteRefusal[] = [];
      for (const id of Object.keys(row)) {
        const column = writable(id);
        if (!column || fixed(column)) continue;
        const cell = writeCell(column, row[id], limits, [...path, "row", id]);
        if (cell.ok) values[column.field] = cell.value;
        else refused.push(refusal(rowId, cell.code, id));
      }
      for (const column of byId.values()) {
        if (column.required && !column.serverOnly && !fixed(column) && !Object.hasOwn(row, column.id)) refused.push(refusal(rowId, "required", column.id));
      }
      for (const id of Object.keys(scopeValues)) values[byId.get(id)!.field] = scopeValues[id];
      if (refused.length > 0) result.rejected.push(...refused);
      else result.inserts.push({ rowId, values });
      continue;
    }

    if (type !== "update" && type !== "delete" && type !== "move") throw new QueryError("invalid-request", [...path, "type"]);
    const changes: [string, unknown][] = [];
    if (type === "update") {
      const { row, prev, cells } = op;
      if (!isRecord(row) || !isRecord(prev)) throw new QueryError("invalid-request", [...path, "row"]);
      if (cells !== undefined) {
        if (!Array.isArray(cells)) throw new QueryError("invalid-request", [...path, "cells"]);
        for (const [at, entry] of (cells as unknown[]).entries()) {
          if (!isRecord(entry) || typeof entry["columnId"] !== "string") throw new QueryError("invalid-request", [...path, "cells", at]);
          changes.push([entry["columnId"], entry["value"]]);
        }
      } else {
        for (const id of Object.keys(row)) if (id !== key.id && row[id] !== prev[id]) changes.push([id, row[id]]);
      }
    }
    const beforeRowId = type === "move" ? optionalId(op, "beforeRowId", limits, path) : undefined;
    const afterRowId = type === "move" ? optionalId(op, "afterRowId", limits, path) : undefined;

    const id = keyOperand(key, rowId, limits, [...path, "rowId"]);
    if (id === null) {
      result.rejected.push(refusal(rowId, "not-an-id"));
      continue;
    }
    const where = combine("and", [leaf(key, { k: "exact", value: id }), ...(options.scope ? [options.scope.where] : [])]);

    if (type === "delete") result.deletes.push({ rowId, where });
    else if (type === "move") result.moves.push({ rowId, ...(beforeRowId === undefined ? {} : { beforeRowId }), ...(afterRowId === undefined ? {} : { afterRowId }), where });
    else {
      const values: Raw = {};
      for (const [columnId, value] of changes) {
        const column = writable(columnId);
        if (!column) continue;
        if (fixed(column)) {
          result.rejected.push(refusal(rowId, "not-writable", columnId));
          continue;
        }
        const cell = writeCell(column, value, limits, [...path, "cells", columnId]);
        if (cell.ok) values[column.field] = cell.value;
        else result.rejected.push(refusal(rowId, cell.code, columnId));
      }
      if (Object.keys(values).length > 0) result.updates.push({ rowId, values, where });
    }
  }
  return result;
}
