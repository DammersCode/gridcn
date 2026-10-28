import type { FilterGroup, FilterNode, FilterOperator, FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_FILTER_GROUP_DEPTH, groupChildren, isFilterGroup } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { isFilterOperator } from "./filter-operators";
import { safeDecode } from "./sort-param";

/** In-value separator for `isBetween`'s two-part value. `encodeURIComponent` leaves `~` in its unreserved set untouched, so a literal `~` inside a bound must be escaped separately (see {@link encodeRangePart}) to stay unambiguous against the separator. */
const RANGE_SEPARATOR = "~";

/** In-value separator for the `isAnyOf` and `isNoneOf` choice lists. `encodeURIComponent` escapes a literal `|` inside a choice to `%7C`, so the raw separator can never collide with a choice's own characters. */
const ANYOF_SEPARATOR = "|";

/** Token for an empty list entry (the "(Blanks)" value). `encodeURIComponent` never emits a lone `%`, so no encoded value collides with it, and a sole empty entry stays distinct from an empty list. */
const EMPTY_ENTRY_TOKEN = "%";

/** A hand-edited URL must not express an unbounded view state; filter segments beyond the cap are dropped. */
const MAX_URL_FILTERS = 64;

/** Groups kept from a URL; the `[` and `]` segments are bounded separately from the leaf rows. */
const MAX_URL_FILTER_GROUPS = 16;

/** Raw comma-separated segments read before parsing stops; bounds the work a URL of empty segments can cost. */
const MAX_URL_FILTER_SEGMENTS = MAX_URL_FILTERS * 4;

const GROUP_CLOSE = "]";

/** Bound for one `isAnyOf` or `isNoneOf` list parsed from a URL when the caller names no per-column limit. */
const DEFAULT_MAX_ANYOF_CHOICES = 1000;

/** Options for {@link parseFilterState}. */
export type ParseFilterStateOptions = {
  /** Most entries an `isAnyOf` or `isNoneOf` list of this column may hold, usually its number of `choices`. Returns `undefined` for the 1000 default. */
  maxChoices?: (columnId: string) => number | undefined;
};

/** `encodeURIComponent` plus escaping the one character it doesn't (`~`), so a literal tilde in a bound never collides with {@link RANGE_SEPARATOR}. */
function encodeRangePart(part: string): string {
  return encodeURIComponent(part).replace(/~/g, "%7E");
}

function encodeFilterValue(operator: FilterOperator, value: FilterSpec["value"]): string {
  if (value === undefined) return "";
  if (Array.isArray(value) && operator === "isBetween") return `${encodeRangePart(value[0])}${RANGE_SEPARATOR}${encodeRangePart(value[1])}`;
  if (Array.isArray(value)) return value.map((entry) => (entry === "" ? EMPTY_ENTRY_TOKEN : encodeURIComponent(entry))).join(ANYOF_SEPARATOR);
  return encodeURIComponent(value);
}

/**
 * Compact URL encoding for a {@link FilterNode}[]: comma-separated `columnId:operator:value` triples
 * (`value` omitted for operators with none, e.g. `empty`/`notEmpty`), column id and value
 * percent-encoded. `isBetween`'s two-value range encodes as `min~max`, the `isAnyOf` and `isNoneOf` choice lists as
 * `a|b|c` (each choice percent-encoded, so the raw `|` separator can never collide) — both still
 * one `value` field, so every other operator's format — and any URL generated before those
 * operators existed — round-trips unchanged. An empty list entry encodes as the lone token `%`
 * (`a|%`), so `[""]` differs from `[]`; a part left empty by hand-editing still reads as an empty entry. `filterId` is never serialized — it's a transient
 * list-rendering identity the store re-derives on parse, not part of the filter's meaning.
 * A {@link FilterGroup} is an open segment `[or` or `[and`, its children, and a closing `]` segment;
 * `encodeURIComponent` escapes `[` and `]`, so no id or value can imitate one. A group nests one more
 * group at most; deeper and empty groups are not written.
 *
 * @example serializeFilterState([{ columnId: "age", operator: "gt", value: "30" }])
 * // => "age:gt:30"
 * @example serializeFilterState([{ columnId: "name", operator: "empty" }])
 * // => "name:empty:"
 * @example serializeFilterState([{ columnId: "age", operator: "isBetween", value: ["10", "30"] }])
 * // => "age:isBetween:10~30"
 * @example serializeFilterState([{ columnId: "status", operator: "isAnyOf", value: ["new", "open"] }])
 * // => "status:isAnyOf:new|open"
 * @example serializeFilterState([{ join: "or", filters: [{ columnId: "a", operator: "equals", value: "1" }] }])
 * // => "[or,a:equals:1,]"
 */
export function serializeFilterState(filters: readonly FilterNode[]): string {
  const segments: string[] = [];
  writeNodes(filters, 0, segments);
  return segments.join(",");
}

function writeNodes(nodes: readonly FilterNode[], depth: number, segments: string[]): void {
  for (const node of nodes) {
    if (!isFilterGroup(node)) {
      segments.push(`${encodeURIComponent(node.columnId)}:${node.operator}:${encodeFilterValue(node.operator, node.value)}`);
      continue;
    }
    const children = groupChildren(node);
    if (depth >= MAX_FILTER_GROUP_DEPTH || children.length === 0) continue;
    const start = segments.length;
    segments.push(`[${node.join === "or" ? "or" : "and"}`);
    writeNodes(children, depth + 1, segments);
    if (segments.length === start + 1) segments.pop();
    else segments.push(GROUP_CLOSE);
  }
}

/** Sentinel distinguishing "decode failed, drop the segment" from a legitimately-empty decoded value (`""`). */
const DECODE_FAILED = Symbol("decode-failed");

/** Decodes a segment's value part per `operator`: `isBetween` splits on {@link RANGE_SEPARATOR} into a tuple, `isAnyOf` and `isNoneOf` split on {@link ANYOF_SEPARATOR} into a choice list (empty value = empty list), everything else stays a plain string. Malformed input (wrong tuple arity, bad percent-encoding) returns {@link DECODE_FAILED}. */
function decodeFilterValue(operator: string, raw: string, maxChoices: number): FilterSpec["value"] | typeof DECODE_FAILED {
  if (operator === "isAnyOf" || operator === "isNoneOf") {
    if (raw === "") return [];
    const parts: string[] = [];
    for (const rawPart of raw.split(ANYOF_SEPARATOR)) {
      if (parts.length >= maxChoices) {
        // a truncated exclusion list would match more rows than the link meant
        if (operator === "isNoneOf") return DECODE_FAILED;
        break;
      }
      const decoded = rawPart === EMPTY_ENTRY_TOKEN ? "" : safeDecode(rawPart);
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
 * column id, wrong field count, malformed `isBetween` range or `isAnyOf` / `isNoneOf` list) are dropped silently
 * rather than throwing — a corrupt/hand-edited URL degrades to fewer filters, never an error.
 * Parsing stops after 256 raw segments. The parsed tree is capped at 64 filter rows and 16 groups, and each `isAnyOf`
 * list at `options.maxChoices(columnId)` entries (1000 by default); the first segments win, so a
 * hand-edited URL cannot express an unbounded filter set. A group opener deeper than the nesting cap,
 * with an unknown join, or over the group cap drops its whole subtree; a stray `]` is ignored, an
 * unclosed group closes at the end, and an empty group is dropped. An `isNoneOf` list over its bound drops
 * the whole segment.
 * Every filter parses without a `filterId`; the store backfills a fresh stable one on the next sync.
 *
 * @example parseFilterState("age:gt:30") // => [{ columnId: "age", operator: "gt", value: "30" }]
 * @example parseFilterState("name:empty:") // => [{ columnId: "name", operator: "empty", value: "" }]
 * @example parseFilterState("age:isBetween:10~30") // => [{ columnId: "age", operator: "isBetween", value: ["10", "30"] }]
 * @example parseFilterState("status:isAnyOf:new|open") // => [{ columnId: "status", operator: "isAnyOf", value: ["new", "open"] }]
 * @example parseFilterState("garbage") // => []
 */
export function parseFilterState(raw: string, options: ParseFilterStateOptions = {}): FilterNode[] {
  if (!raw) return [];
  type Frame = { join: FilterGroup["join"]; filters: FilterNode[]; dropped: boolean };
  const root: Frame = { join: "and", filters: [], dropped: false };
  const stack: Frame[] = [root];
  let leaves = 0;
  let groups = 0;
  const closeTop = () => {
    const frame = stack.pop()!;
    if (frame.dropped || frame.filters.length === 0) return;
    stack[stack.length - 1]!.filters.push({ join: frame.join, filters: frame.filters });
  };
  let start = 0;
  for (let read = 0; read < MAX_URL_FILTER_SEGMENTS && start <= raw.length && leaves < MAX_URL_FILTERS; read++) {
    const comma = raw.indexOf(",", start);
    const end = comma === -1 ? raw.length : comma;
    const segment = raw.slice(start, end);
    start = end + 1;
    if (segment === GROUP_CLOSE) {
      if (stack.length > 1) closeTop();
      continue;
    }
    if (segment.startsWith("[")) {
      const join = segment === "[or" ? "or" : segment === "[and" ? "and" : undefined;
      const parent = stack[stack.length - 1]!;
      const dropped = parent.dropped || join === undefined || stack.length > MAX_FILTER_GROUP_DEPTH || groups >= MAX_URL_FILTER_GROUPS;
      if (!dropped) groups++;
      stack.push({ join: join ?? "and", filters: [], dropped });
      continue;
    }
    const parts = segment.split(":");
    if (parts.length !== 3) continue;
    const [columnId, operator, rawValue] = parts;
    if (!columnId || operator === undefined || rawValue === undefined || !isFilterOperator(operator)) continue;
    const decodedId = safeDecode(columnId);
    if (decodedId === null || decodedId === "") continue;
    const value = decodeFilterValue(operator, rawValue, options.maxChoices?.(decodedId) ?? DEFAULT_MAX_ANYOF_CHOICES);
    if (value === DECODE_FAILED) continue;
    const frame = stack[stack.length - 1]!;
    if (frame.dropped) continue;
    frame.filters.push({ columnId: decodedId, operator, value });
    leaves++;
  }
  while (stack.length > 1) closeTop();
  return root.filters;
}
