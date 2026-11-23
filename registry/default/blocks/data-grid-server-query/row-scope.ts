import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import { DEFAULT_LIMITS } from "./limits";
import { INT_RANGE, decimalToFloat, decimalToString, exceedsDigits, holdsInstant, isIntType, parseBoolean, parseDate, parseDecimal, parseInstant, parseUuid } from "./operands";
import { type Operand, type Predicate, combine, leaf } from "./plan";

/** Returns equalities on mapped columns (`{ tenantId: ctx.tenantId }`) that every query of the factory ANDs in. */
export type RowScope<TContext> = (context: TContext) => Readonly<Record<string, unknown>>;

function refuse(column: PlanColumn): never {
  throw new Error(`rowScope: the value for "${column.id}" is missing or invalid`);
}

function numberOperand(column: PlanColumn, value: unknown, maxNumberLength: number): Operand {
  if (isIntType(column.numeric)) {
    const [min, max] = INT_RANGE[column.numeric];
    let whole: bigint | null = null;
    if (typeof value === "number" && Number.isSafeInteger(value)) whole = BigInt(value);
    else if (typeof value === "bigint" && column.numeric === "int8") whole = value;
    if (whole === null || whole < min || whole > max) return refuse(column);
    return { kind: "bigint", v: whole };
  }
  if (typeof value !== "number" && !(typeof value === "string" && column.numeric === "decimal")) return refuse(column);
  const parsed = parseDecimal(String(value).trim());
  if (!parsed) return refuse(column);
  if (column.numeric === "float") return { kind: "number", v: String(decimalToFloat(parsed)) };
  if (exceedsDigits(parsed, maxNumberLength)) return refuse(column);
  return { kind: "number", v: decimalToString(parsed) };
}

function scopeOperand(column: PlanColumn, value: unknown, maxNumberLength: number): Operand {
  if (value === undefined || value === null || (typeof value === "number" && Number.isNaN(value))) return refuse(column);
  if (column.kind === "number") return numberOperand(column, value, maxNumberLength);
  if (column.kind === "checkbox") {
    const parsed = typeof value === "boolean" ? value : typeof value === "string" ? parseBoolean(value) : null;
    return parsed === null ? refuse(column) : { kind: "boolean", v: parsed };
  }
  if (typeof value !== "string") return refuse(column);
  if (column.kind === "date") {
    const parsed = column.time ? parseInstant(value) : parseDate(value);
    return parsed === null || !holdsInstant(column, parsed) ? refuse(column) : { kind: column.time ? "instant" : "date", v: parsed };
  }
  if (value.trim() === "") return refuse(column);
  const text = column.native === "uuid" ? parseUuid(value) : value;
  return text === null ? refuse(column) : { kind: "text", v: text };
}

/** The predicate of a `rowScope` result; throws (a 500, never a wider result) on anything that is not a plain, valid equality set. */
export function rowScopePredicate(columns: ColumnMap, scope: unknown, maxNumberLength: number = DEFAULT_LIMITS.maxNumberLength): Predicate {
  const prototype: unknown = typeof scope === "object" && scope !== null ? Object.getPrototypeOf(scope) : undefined;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope) || (prototype !== Object.prototype && prototype !== null)) {
    throw new Error("rowScope: must return a plain object");
  }
  const keys = Object.keys(scope);
  if (keys.length === 0) throw new Error("rowScope: returned no keys, which would match every row; omit rowScope for that");
  const items = keys.map((key) => {
    const column = mapOf(columns).byId.get(key);
    if (!column) throw new Error(`rowScope: "${key}" is not in the column map`);
    return leaf(column, { k: "exact", value: scopeOperand(column, (scope as Record<string, unknown>)[key], maxNumberLength) });
  });
  return combine("and", items);
}
