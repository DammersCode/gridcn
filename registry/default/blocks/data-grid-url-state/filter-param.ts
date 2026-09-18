import type { FilterOperator, FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { isFilterOperator } from "./filter-operators";

/** In-value separator for `isBetween`'s two-part value. `encodeURIComponent` leaves `~` in its unreserved set untouched, so a literal `~` inside a bound must be escaped separately (see {@link encodeRangePart}) to stay unambiguous against the separator. */
const RANGE_SEPARATOR = "~";

/** In-value separator for `isAnyOf`'s choice list. `encodeURIComponent` escapes a literal `|` inside a choice to `%7C`, so the raw separator can never collide with a choice's own characters. */
const ANYOF_SEPARATOR = "|";

/** `encodeURIComponent` plus escaping the one character it doesn't (`~`), so a literal tilde in a bound never collides with {@link RANGE_SEPARATOR}. */
function encodeRangePart(part: string): string {
  return encodeURIComponent(part).replace(/~/g, "%7E");
}

function encodeFilterValue(operator: FilterOperator, value: FilterSpec["value"]): string {
  if (value === undefined) return "";
  if (Array.isArray(value) && operator === "isBetween") return `${encodeRangePart(value[0])}${RANGE_SEPARATOR}${encodeRangePart(value[1])}`;
  if (Array.isArray(value)) return value.map(encodeURIComponent).join(ANYOF_SEPARATOR);
  return encodeURIComponent(value);
}

/**
 * Compact URL encoding for {@link FilterSpec}[]: comma-separated `columnId:operator:value` triples
 * (`value` omitted for operators with none, e.g. `empty`/`notEmpty`), column id and value
 * percent-encoded. `isBetween`'s two-value range encodes as `min~max`, `isAnyOf`'s choice list as
 * `a|b|c` (each choice percent-encoded, so the raw `|` separator can never collide) — both still
 * one `value` field, so every other operator's format — and any URL generated before those
 * operators existed — round-trips unchanged. `filterId` is never serialized — it's a transient
 * list-rendering identity the store re-derives on parse, not part of the filter's meaning.
 *
 * @example serializeFilterState([{ columnId: "age", operator: "gt", value: "30" }])
 * // => "age:gt:30"
 * @example serializeFilterState([{ columnId: "name", operator: "empty" }])
 * // => "name:empty:"
 * @example serializeFilterState([{ columnId: "age", operator: "isBetween", value: ["10", "30"] }])
 * // => "age:isBetween:10~30"
 * @example serializeFilterState([{ columnId: "status", operator: "isAnyOf", value: ["new", "open"] }])
 * // => "status:isAnyOf:new|open"
 */
export function serializeFilterState(filters: readonly FilterSpec[]): string {
  return filters.map((f) => `${encodeURIComponent(f.columnId)}:${f.operator}:${encodeFilterValue(f.operator, f.value)}`).join(",");
}

/** `decodeURIComponent` throws on malformed `%` sequences a hand-edited URL can contain — never let that surface. */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Sentinel distinguishing "decode failed, drop the segment" from a legitimately-empty decoded value (`""`). */
const DECODE_FAILED = Symbol("decode-failed");

/** Decodes a segment's value part per `operator`: `isBetween` splits on {@link RANGE_SEPARATOR} into a tuple, `isAnyOf` splits on {@link ANYOF_SEPARATOR} into a choice list (empty value = empty list), everything else stays a plain string. Malformed input (wrong tuple arity, bad percent-encoding) returns {@link DECODE_FAILED}. */
function decodeFilterValue(operator: string, raw: string): FilterSpec["value"] | typeof DECODE_FAILED {
  if (operator === "isAnyOf") {
    if (raw === "") return [];
    const parts: string[] = [];
    for (const rawPart of raw.split(ANYOF_SEPARATOR)) {
      const decoded = safeDecode(rawPart);
      if (decoded === null) return DECODE_FAILED;
      parts.push(decoded);
    }
    return parts;
  }
  if (operator !== "isBetween") {
    const decoded = safeDecode(raw);
    return decoded === null ? DECODE_FAILED : decoded;
  }
  const parts = raw.split(RANGE_SEPARATOR);
  if (parts.length !== 2) return DECODE_FAILED;
  const [min, max] = parts.map(safeDecode);
  if (min == null || max == null) return DECODE_FAILED;
  return [min, max];
}

/**
 * Inverse of {@link serializeFilterState}. Malformed segments (unknown operator, empty/undecodable
 * column id, wrong field count, malformed `isBetween` range or `isAnyOf` list) are dropped silently
 * rather than throwing — a corrupt/hand-edited URL degrades to fewer filters, never an error.
 * Every filter parses without a `filterId`; the store backfills a fresh stable one on the next sync.
 *
 * @example parseFilterState("age:gt:30") // => [{ columnId: "age", operator: "gt", value: "30" }]
 * @example parseFilterState("name:empty:") // => [{ columnId: "name", operator: "empty", value: "" }]
 * @example parseFilterState("age:isBetween:10~30") // => [{ columnId: "age", operator: "isBetween", value: ["10", "30"] }]
 * @example parseFilterState("status:isAnyOf:new|open") // => [{ columnId: "status", operator: "isAnyOf", value: ["new", "open"] }]
 * @example parseFilterState("garbage") // => []
 */
export function parseFilterState(raw: string): FilterSpec[] {
  if (!raw) return [];
  const filters: FilterSpec[] = [];
  for (const segment of raw.split(",")) {
    const parts = segment.split(":");
    if (parts.length !== 3) continue;
    const [columnId, operator, rawValue] = parts;
    if (!columnId || operator === undefined || rawValue === undefined || !isFilterOperator(operator)) continue;
    const decodedId = safeDecode(columnId);
    if (decodedId === null || decodedId === "") continue;
    const value = decodeFilterValue(operator, rawValue);
    if (value === DECODE_FAILED) continue;
    filters.push({ columnId: decodedId, operator, value });
  }
  return filters;
}
