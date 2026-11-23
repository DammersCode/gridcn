import type { PlanColumn } from "./column-map";
import { toSafeText } from "./safe-text";

function dayText(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = toSafeText(value);
  if (text === "") return null;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

const EPOCH_TEXT = /^-?\d{1,16}$/;
/** The JavaScript date range; a value outside it has no ISO text. */
const MAX_DATE_MS = 8.64e15;

/** A driver timestamp as an ISO text with `Z`: `Date`, epoch number or its digits as text, or the text PostgreSQL and SQLite return. */
export function instantText(value: unknown, column: PlanColumn): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const epoch = column.storage === "epoch-ms" || column.storage === "epoch-s";
  let ms: number;
  if (typeof value === "number") ms = column.storage === "epoch-s" ? value * 1000 : value;
  else if (typeof value === "bigint") ms = Number(value) * (column.storage === "epoch-s" ? 1000 : 1);
  else {
    const text = toSafeText(value).trim();
    if (text === "") return null;
    // node-postgres and the Supabase grid function answer an int8 epoch as its digits.
    if (epoch && EPOCH_TEXT.test(text)) return instantText(Number(text), column);
    const normalized = /^\d{4}-\d{2}-\d{2} \d/.test(text) ? text.replace(" ", "T") : text;
    const zoned = /(?:Z|[-+]\d{2}(?::?\d{2})?)$/i.test(normalized) ? normalized.replace(/([-+]\d{2})$/, "$1:00") : `${normalized}Z`;
    ms = Date.parse(zoned);
  }
  return Math.abs(ms) <= MAX_DATE_MS ? new Date(ms).toISOString() : null;
}

function numberValue(value: unknown, column: PlanColumn): number | string | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    const safe = value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER);
    return safe ? Number(value) : value.toString();
  }
  const text = toSafeText(value).trim();
  if (text === "") return null;
  if (column.scale !== undefined) return text;
  const n = Number(text);
  const exact = Number.isFinite(n) && (Number.isSafeInteger(n) || column.numeric === "float" || column.numeric === "decimal");
  return exact ? n : text;
}

/** One cell value in the wire form: JSON-safe, with numbers, dates, and booleans in the shapes the grid cells hold. */
export function serializeValue(value: unknown, column: PlanColumn): unknown {
  if (value === null || value === undefined) return null;
  switch (column.kind) {
    case "number":
      return numberValue(value, column);
    case "checkbox":
      if (typeof value === "boolean") return value;
      if (value === 1 || (typeof value === "bigint" && value === BigInt(1)) || value === "t" || value === "1" || value === "true") return true;
      if (value === 0 || (typeof value === "bigint" && value === BigInt(0)) || value === "f" || value === "0" || value === "false") return false;
      return null;
    case "date":
      return column.time ? instantText(value, column) : dayText(value);
    default:
      return toSafeText(value);
  }
}

/** A wire row from a driver row keyed by column id: only the projected columns. */
export function serializeRow(row: Record<string, unknown>, projection: readonly PlanColumn[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of projection) {
    const value = serializeValue(Object.hasOwn(row, column.id) ? row[column.id] : null, column);
    // A plain assignment to `__proto__` sets the prototype instead of the mapped column's key.
    Object.defineProperty(out, column.id, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}
