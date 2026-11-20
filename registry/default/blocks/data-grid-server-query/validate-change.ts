import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import { QueryError } from "./errors";
import { type QueryLimits, resolveLimits } from "./limits";
import { decimalToString, isIntType, parseBoolean, parseDate, parseDecimal, parseInstant, parseUuid } from "./operands";
import { type Cell, IMPORT_REFUSAL_MESSAGES, type ImportRefusalCode, readCell } from "./parse-import-rows";
import { type Operand, type Predicate, combine, leaf } from "./plan";
import { toSafeText } from "./safe-text";

const WRITE_REFUSAL_MESSAGES = { ...IMPORT_REFUSAL_MESSAGES, "not-writable": "Not writable" } as const;
// The grid refuses every row of a save answer that lists more rejections than this.
const MAX_WRITE_REJECTIONS = 10_000;

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
  /** `beforeWhere` and `afterWhere` match each neighbor id within `rowScope`, so a lookup cannot read another scope's row. */
  moves: { rowId: string; where: TWhere; beforeRowId?: string; beforeWhere?: TWhere; afterRowId?: string; afterWhere?: TWhere }[];
  rejected: WriteRefusal[];
};

export type ValidateChangeOptions = {
  columns: ColumnMap;
  limits?: QueryLimits;
  /** The `rowScope` predicate of the call: an AND of `exact` tests. */
  scope?: Predicate;
};

type Raw = Record<string, unknown>;
type Limits = ReturnType<typeof resolveLimits>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const refusal = (rowId: string, code: WriteRefusalCode, columnId?: string): WriteRefusal =>
  columnId === undefined ? { rowId, code, message: WRITE_REFUSAL_MESSAGES[code] } : { rowId, columnId, code, message: WRITE_REFUSAL_MESSAGES[code] };
// A plain assignment of `__proto__` sets the prototype instead of a key.
const put = (target: Raw, key: string, value: unknown) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });

function writeCell(column: PlanColumn, value: unknown, limits: Limits, path: (string | number)[]): Cell {
  if ((column.kind === "text" || column.kind === "select") && typeof value === "string" && value.length > limits.maxValueLength) {
    return { ok: false, code: "too-long", message: IMPORT_REFUSAL_MESSAGES["too-long"] };
  }
  return readCell(column, value, limits, path);
}

/** Why a row id gives no key: `shape`, no value of the physical type looks like it; `declined`, the type could hold it but it exceeds a length or digit limit. */
export type KeyMiss = "shape" | "declined";

/**
 * The operand of a row id under the key column. A key is compared, never validated: the physical type alone parses it,
 * so `choices`, `maxLength`, a decimal's `scale`, and the blank rule do not apply, an empty text id is a text key, and a
 * uuid keeps the case it was sent in.
 */
export function keyOperand(column: PlanColumn, rowId: string, limits: Limits): Operand | KeyMiss {
  if (column.kind === "number") {
    if (rowId.length > limits.maxNumberLength) return isIntType(column.numeric) ? "shape" : "declined";
    const cell = readCell(column.scale === undefined ? column : { ...column, scale: undefined }, rowId, limits, []);
    if (!cell.ok) return cell.code === "out-of-range" && column.numeric === "decimal" ? "declined" : "shape";
    if (cell.value === null) return "shape";
    // The float's shortest text; the canonical decimal of `1e-300` has 300 digits.
    if (column.numeric === "float") return { kind: "number", v: toSafeText(cell.value) };
    const canonical = decimalToString(parseDecimal(rowId.trim())!);
    return column.numeric === "decimal" ? { kind: "number", v: canonical } : { kind: "bigint", v: BigInt(canonical) };
  }
  if (rowId.length > limits.maxValueLength) return column.kind === "checkbox" || column.kind === "date" || column.native === "uuid" ? "shape" : "declined";
  switch (column.kind) {
    case "checkbox": {
      const parsed = parseBoolean(rowId);
      return parsed === null ? "shape" : { kind: "boolean", v: parsed };
    }
    case "date": {
      const parsed = column.time ? parseInstant(rowId) : parseDate(rowId);
      return parsed === null ? "shape" : { kind: column.time ? "instant" : "date", v: parsed };
    }
    default:
      return column.native === "uuid" && parseUuid(rowId) === null ? "shape" : { kind: "text", v: rowId };
  }
}

/** The write form of a parsed operand, the same form `readCell` returns for the column. */
function operandValue(column: PlanColumn, operand: Operand): unknown {
  if (operand.kind === "bigint") return Number.isSafeInteger(Number(operand.v)) ? Number(operand.v) : operand.v.toString();
  if (operand.kind === "number" && column.numeric === "float") return Number(operand.v);
  return operand.v;
}

function scopeEqualities(scope: Predicate | undefined): { column: PlanColumn; value: Operand }[] {
  if (!scope) return [];
  const items = scope.t === "and" ? scope.items : [scope];
  return items.flatMap((item) => (item.t === "leaf" && item.test.k === "exact" ? [{ column: item.column, value: item.test.value }] : []));
}

const optionalId = (op: Raw, key: string, path: (string | number)[]): string | undefined => {
  const value = op[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new QueryError("invalid-request", [...path, key]);
  return value;
};

/**
 * Applies the column map to the `DataChange` of `onSave`. Unmapped and `serverOnly` keys are skipped, never written.
 * A column that shares the physical field of the key or of a `rowScope` column is fixed: a `cells` entry or a changed
 * whole-row value for it is `not-writable`, while the row's key entry and the fixed entries of an insert are skipped;
 * an insert writes the parsed `rowScope` values. A refused cell drops every entry of its column from a `cells` update; any refusal drops
 * a whole-row update or an insert. A row or neighbor id that gives no key refuses its operation as `not-an-id`.
 * A malformed change throws `invalid-request`; more than `maxChangeOps` operations
 * or more than 10,000 refusals throw `limit-exceeded`; a map without one `primaryKey` throws `unsupported`.
 */
export function validateChange(input: unknown, options: ValidateChangeOptions): ValidatedChange<Predicate> {
  const limits = resolveLimits(options.limits);
  const { byId } = mapOf(options.columns);
  const key = [...byId.values()].find((column) => column.primaryKey);
  if (!key) throw new QueryError("unsupported", ["ops"]);
  if (!isRecord(input) || !Array.isArray(input["ops"])) throw new QueryError("invalid-request", ["ops"]);
  const ops: unknown[] = input["ops"];
  if (ops.length > limits.maxChangeOps) throw new QueryError("limit-exceeded", ["ops"]);
  const scope = scopeEqualities(options.scope);
  // By field: two ids may share one physical column, and an alias must not write the key or the scope.
  const fixedFields = new Set([key.field, ...scope.map((entry) => entry.column.field)]);
  const fixed = (column: PlanColumn) => fixedFields.has(column.field);
  const scopedWhere = (rowId: string): Predicate | null => {
    const id = keyOperand(key, rowId, limits);
    return typeof id === "string" ? null : combine("and", [leaf(key, { k: "exact", value: id }), ...(options.scope ? [options.scope] : [])]);
  };
  const writable = (id: string) => {
    const column = byId.get(id);
    return column && !column.serverOnly ? column : undefined;
  };
  const result: ValidatedChange<Predicate> = { updates: [], inserts: [], deletes: [], moves: [], rejected: [] };
  const reject = (refused: WriteRefusal[]) => {
    result.rejected.push(...refused);
    if (result.rejected.length > MAX_WRITE_REJECTIONS) throw new QueryError("limit-exceeded", ["ops"]);
  };

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
        if (cell.ok) put(values, column.field, cell.value);
        else refused.push(refusal(rowId, cell.code, id));
      }
      for (const column of byId.values()) {
        if (column.required && !column.serverOnly && !fixed(column) && !Object.hasOwn(row, column.id)) refused.push(refusal(rowId, "required", column.id));
      }
      for (const { column, value } of scope) put(values, column.field, operandValue(column, value));
      if (refused.length > 0) reject(refused);
      else result.inserts.push({ rowId, values });
      continue;
    }

    if (type !== "update" && type !== "delete" && type !== "move") throw new QueryError("invalid-request", [...path, "type"]);
    const changes: [string, unknown][] = [];
    let wholeRow = false;
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
        wholeRow = true;
        for (const id of Object.keys(row)) if (id !== key.id && row[id] !== (Object.hasOwn(prev, id) ? prev[id] : undefined)) changes.push([id, row[id]]);
      }
    }
    const beforeRowId = type === "move" ? optionalId(op, "beforeRowId", path) : undefined;
    const afterRowId = type === "move" ? optionalId(op, "afterRowId", path) : undefined;

    const where = scopedWhere(rowId);
    const beforeWhere = beforeRowId === undefined ? undefined : scopedWhere(beforeRowId);
    const afterWhere = afterRowId === undefined ? undefined : scopedWhere(afterRowId);
    if (where === null || beforeWhere === null || afterWhere === null) {
      reject([refusal(rowId, "not-an-id")]);
      continue;
    }

    if (type === "delete") result.deletes.push({ rowId, where });
    else if (type === "move") {
      result.moves.push({
        rowId,
        where,
        ...(beforeWhere === undefined ? {} : { beforeRowId, beforeWhere }),
        ...(afterWhere === undefined ? {} : { afterRowId, afterWhere }),
      });
    } else {
      const accepted = new Map<string, [field: string, value: unknown]>();
      const refused: WriteRefusal[] = [];
      for (const [columnId, value] of changes) {
        const column = writable(columnId);
        if (!column) continue;
        if (fixed(column)) {
          refused.push(refusal(rowId, "not-writable", columnId));
          continue;
        }
        const cell = writeCell(column, value, limits, [...path, "cells", columnId]);
        // Delete first so the last entry also wins between two ids that share a field.
        if (!cell.ok) {
          refused.push(refusal(rowId, cell.code, columnId));
          continue;
        }
        accepted.delete(columnId);
        accepted.set(columnId, [column.field, cell.value]);
      }
      reject(refused);
      // The grid reverts every entry of a refused column, so a repeated valid entry for it is not written.
      const refusedIds = new Set(refused.map((entry) => entry.columnId));
      const values: Raw = {};
      for (const [columnId, [field, value]] of accepted) if (!refusedIds.has(columnId)) put(values, field, value);
      // The grid reverts a whole-row update on any refusal, so the server writes none of it.
      if (Object.keys(values).length > 0 && !(wholeRow && refused.length > 0)) result.updates.push({ rowId, values, where });
    }
  }
  return result;
}
