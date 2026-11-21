import { mapOf, type ColumnMap, type PlanColumn } from "./column-map";
import { QueryError } from "./errors";
import { resolveLimits, type QueryLimits } from "./limits";
import { decimalToString, exceedsDigits, holdsInstant, INT_RANGE, isIntType, isSubMillisecond, parseBoolean, parseDate, parseDecimal, parseInstant, parseUuid } from "./operands";

/** The English text of each refusal code; map the `code` of a refusal to your own language. */
export const IMPORT_REFUSAL_MESSAGES = {
  "not-a-number": "Not a number",
  "not-a-whole-number": "Not a whole number",
  "out-of-range": "Out of range",
  "too-many-decimals": "Too many decimal places",
  "not-text": "Not text",
  "too-long": "Too long",
  "not-an-id": "Not a valid id",
  "not-a-choice": "Not an allowed choice",
  "not-a-date": "Not a date",
  "not-a-boolean": "Not true or false",
  required: "Required",
} as const;

export type ImportRefusalCode = keyof typeof IMPORT_REFUSAL_MESSAGES;

/** One refusal of {@link parseImportRows}; `rowIndex` is the 0-based index into the request's `rows`, `code` names the reason. */
export type ImportRowRefusal = { rowIndex: number; columnId?: string; code?: ImportRefusalCode; message?: string };

/** Options for {@link parseImportRows}. */
export type ParseImportRowsOptions = {
  /** The column map that names the keys a row may carry. */
  columns: ColumnMap;
  /** Bounds; `maxImportRows`, `maxValueLength`, and `maxNumberLength` apply. */
  limits?: QueryLimits;
};

/** The parsed import request. `rows` holds the rows without a refusal; `rejected` lists the others, one entry per refused cell. */
export type ParsedImportRows = { rows: Record<string, unknown>[]; rejected: ImportRowRefusal[] };

type Raw = Record<string, unknown>;
type Limits = ReturnType<typeof resolveLimits>;
export type CellRead = { ok: true; value: unknown } | { ok: false; code: ImportRefusalCode; message: string };

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const ok = (value: unknown): CellRead => ({ ok: true, value });
const refuse = (code: ImportRefusalCode): CellRead => ({ ok: false, code, message: IMPORT_REFUSAL_MESSAGES[code] });
const isBlank = (value: unknown): boolean => value === null || value === undefined;

function numberCell(column: PlanColumn, value: unknown, limits: Limits, path: (string | number)[]): CellRead {
  if (typeof value === "number" && !Number.isFinite(value)) return refuse("not-a-number");
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string") return refuse("not-a-number");
  if (text.length > limits.maxNumberLength) throw new QueryError("limit-exceeded", path);
  const decimal = parseDecimal(text.trim());
  if (!decimal) return refuse("not-a-number");
  if (column.numeric === "float") {
    const float = Number(text.trim()) + 0; // `+ 0` reads -0 as 0, as the canonical text does.
    return Number.isFinite(float) ? ok(float) : refuse("out-of-range");
  }
  const int = isIntType(column.numeric);
  if (int && decimal.scale > 0) return refuse("not-a-whole-number");
  if (!int && column.scale !== undefined && decimal.scale > column.scale) return refuse("too-many-decimals");
  if (exceedsDigits(decimal, limits.maxNumberLength)) return refuse("out-of-range");
  const canonical = decimalToString(decimal);
  if (int) {
    const whole = BigInt(canonical);
    const [low, high] = INT_RANGE[column.numeric];
    if (whole < low || whole > high) return refuse("out-of-range");
    return ok(typeof value === "number" && Number.isSafeInteger(value) ? value : canonical);
  }
  return ok(canonical);
}

function textCell(column: PlanColumn, value: unknown, limits: Limits, path: (string | number)[]): CellRead {
  if (typeof value !== "string") return refuse("not-text");
  if (value.length > limits.maxValueLength) throw new QueryError("limit-exceeded", path);
  if (column.maxLength !== undefined && value.length > column.maxLength) return refuse("too-long");
  if (column.native === "uuid") {
    const uuid = parseUuid(value);
    return uuid === null ? refuse("not-an-id") : ok(uuid);
  }
  if (column.native === "enum" || (column.kind === "select" && column.choices)) {
    const choice = column.choices?.find((candidate) => candidate === value) ?? (column.native === "enum" ? column.choices?.find((candidate) => candidate.toLowerCase() === value.toLowerCase()) : undefined);
    return choice === undefined ? refuse("not-a-choice") : ok(choice);
  }
  return ok(value);
}

function dateCell(column: PlanColumn, value: unknown, limits: Limits, path: (string | number)[]): CellRead {
  if (typeof value !== "string") return refuse("not-a-date");
  if (value.length > limits.maxValueLength) throw new QueryError("limit-exceeded", path);
  if (!column.time) {
    const day = parseDate(value);
    return day === null ? refuse("not-a-date") : ok(day);
  }
  if (isSubMillisecond(value)) return refuse("too-many-decimals");
  const instant = parseInstant(value);
  if (instant === null) return refuse("not-a-date");
  // An integer seconds column would cut the fraction silently.
  if (!holdsInstant(column, instant)) throw new QueryError("unsupported-value", path);
  return ok(instant);
}

function checkboxCell(value: unknown): CellRead {
  if (typeof value === "boolean") return ok(value);
  const parsed = typeof value === "string" ? parseBoolean(value) : null;
  return parsed === null ? refuse("not-a-boolean") : ok(parsed);
}

/** Checks one value against its column: kind, `required`, `choices`, integer range, `scale`, finite floats, `maxLength`. Over `maxValueLength` or `maxNumberLength` it throws `limit-exceeded`. */
export function readCell(column: PlanColumn, value: unknown, limits: Limits, path: (string | number)[]): CellRead {
  const blank = isBlank(value) || (typeof value === "string" && value === "" && column.kind !== "checkbox" && !column.keepBlankText);
  if (blank) return column.required ? refuse("required") : ok(null);
  switch (column.kind) {
    case "number":
      return numberCell(column, value, limits, path);
    case "checkbox":
      return checkboxCell(value);
    case "date":
      return dateCell(column, value, limits, path);
    default:
      return textCell(column, value, limits, path);
  }
}

/**
 * Reads the body of an import request, `{ rows: Record<string, unknown>[] }`, against the column map.
 * The bounds apply before any value is read: `maxImportRows` rows, only mapped columns that are not `serverOnly`,
 * values within `maxValueLength` and `maxNumberLength`. A request outside the bounds throws a `QueryError`.
 * A value that does not fit its column kind is a refusal, not an error: the row stays out of `rows` and `rejected` names the cell.
 */
export function parseImportRows(input: unknown, options: ParseImportRowsOptions): ParsedImportRows {
  const limits = resolveLimits(options.limits);
  const { byId } = mapOf(options.columns);
  if (!isRecord(input) || !Array.isArray(input["rows"])) throw new QueryError("invalid-request", ["rows"]);
  const source: unknown[] = input["rows"];
  if (source.length > limits.maxImportRows) throw new QueryError("limit-exceeded", ["rows"]);
  const rows: Raw[] = [];
  const rejected: ImportRowRefusal[] = [];
  for (let rowIndex = 0; rowIndex < source.length; rowIndex++) {
    const row = source[rowIndex];
    if (!isRecord(row)) throw new QueryError("invalid-request", ["rows", rowIndex]);
    const parsed: Raw = {};
    let refused = false;
    for (const key of Object.keys(row)) {
      const column = byId.get(key);
      if (!column || column.serverOnly) throw new QueryError("unknown-column", ["rows", rowIndex, key]);
      const cell = readCell(column, row[key], limits, ["rows", rowIndex, key]);
      // A plain assignment to `__proto__` sets the prototype instead of the mapped column's key.
      if (cell.ok) Object.defineProperty(parsed, key, { value: cell.value, enumerable: true, writable: true, configurable: true });
      else {
        refused = true;
        rejected.push({ rowIndex, columnId: key, code: cell.code, message: cell.message });
      }
    }
    for (const column of byId.values()) {
      if (!column.required || column.serverOnly || column.primaryKey || Object.hasOwn(row, column.id)) continue;
      refused = true;
      rejected.push({ rowIndex, columnId: column.id, code: "required", message: IMPORT_REFUSAL_MESSAGES.required });
    }
    if (!refused) rows.push(parsed);
  }
  return { rows, rejected };
}
