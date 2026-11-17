import { type ColumnMap, type PlanColumn, isBuiltInOperatorId, mapOf } from "./column-map";
import { QueryError } from "./errors";
import { type QueryLimits, type ResolvedLimits, resolveLimits } from "./limits";
import {
  type Decimal,
  INT_RANGE,
  assertTimeZone,
  ceilDecimal,
  clampFloat,
  decimalToString,
  floorDecimal,
  isInteger,
  isIntType,
  nextDay,
  parseBoolean,
  parseDate,
  parseDecimal,
  parseInstant,
  parseUuid,
  startOfLocalDay,
} from "./operands";
import { type AggregatesPlan, FALSE, type Operand, type OrderTerm, type Predicate, type QueryPlan, type QueryRequestKind, type RowsPlan, TRUE, type ValuesPlan, combine, leaf } from "./plan";

/** How often a rows request also counts the result: the first scroll block (default), every request, or never. */
export type RowCountMode = "firstBlock" | "always" | "none";

export type ParseQueryOptions<R extends QueryRequestKind> = {
  columns: ColumnMap;
  request: R;
  rowCount?: RowCountMode;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
};

/** The deepest group nesting the client keeps. */
export const MAX_FILTER_DEPTH = 2;

type Budget = { nodes: number; leaves: number; listValues: number; bytes: number };
type Ctx = { map: ReturnType<typeof mapOf>; limits: ResolvedLimits; timeZone: string; budget: Budget };
type Path = readonly (string | number)[];
type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const encoder = new TextEncoder();

function charge(ctx: Ctx, text: string, path: Path, max = ctx.limits.maxValueLength): void {
  if (text.length > max) throw new QueryError("invalid-value", path);
  ctx.budget.bytes += encoder.encode(text).length;
  if (ctx.budget.bytes > ctx.limits.maxTreeStringBytes) throw new QueryError("limit-exceeded", path);
}

/**
 * Turns an untrusted request into a bounded, typed plan, or throws {@link QueryError}. `request` selects the shape:
 * `rows` reads `{ spec, start, end, page?, pageSize? }`, `values` reads `{ columnId, query, filters }`,
 * `aggregates` reads `{ spec, columnIds? }`. The plan holds no `rowScope`; the factory adds it.
 */
export function parseQuery<R extends QueryRequestKind>(input: unknown, options: ParseQueryOptions<R>): Extract<QueryPlan, { kind: R }> {
  const timeZone = options.timeZone ?? "UTC";
  assertTimeZone(timeZone);
  const ctx: Ctx = { map: mapOf(options.columns), limits: resolveLimits(options.limits), timeZone, budget: { nodes: 0, leaves: 0, listValues: 0, bytes: 0 } };
  if (!isRecord(input)) throw new QueryError("invalid-request", []);
  let plan: QueryPlan;
  if (options.request === "rows") plan = parseRows(input, ctx, options.rowCount ?? "firstBlock");
  else if (options.request === "values") plan = parseValues(input, ctx);
  else plan = parseAggregates(input, ctx);
  return plan as Extract<QueryPlan, { kind: R }>;
}

function specOf(input: Raw): Raw {
  const spec = input["spec"];
  if (spec === undefined || spec === null) return {};
  if (!isRecord(spec)) throw new QueryError("invalid-request", ["spec"]);
  return spec;
}

function rejectGrouping(input: Raw, spec: Raw): void {
  const filled = (value: unknown) => (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && !(isRecord(value) && Object.keys(value).length === 0));
  if (filled(spec["groupBy"]) || filled(spec["pivot"]) || filled(input["groupPath"]) || input["childKind"] === "groups") throw new QueryError("unsupported", ["spec"]);
}

function parseWhere(spec: Raw, ctx: Ctx): Predicate {
  const filters = parseFilters(spec["filters"], ctx);
  const search = parseSearch(spec["searchText"], ctx);
  return combine("and", [filters, search]);
}

function parseRows(input: Raw, ctx: Ctx, rowCount: RowCountMode): RowsPlan {
  const spec = specOf(input);
  rejectGrouping(input, spec);
  const where = parseWhere(spec, ctx);
  const orderBy = parseSorts(spec["sorts"], ctx);
  const { rowRange, paged } = parseRange(input, ctx);
  const runCount = paged ? rowCount !== "none" : rowCount === "always" || (rowCount === "firstBlock" && rowRange.start === 0);
  return { kind: "rows", where, orderBy, rowRange, runCount, projection: ctx.map.visible };
}

function parseValues(input: Raw, ctx: Ctx): ValuesPlan {
  const column = lookupColumn(input["columnId"], ctx, ["columnId"], "filter");
  const query = input["query"] === undefined || input["query"] === null ? "" : input["query"];
  if (typeof query !== "string") throw new QueryError("invalid-request", ["query"]);
  if (query.length > ctx.limits.maxValueQueryLength) throw new QueryError("invalid-value", ["query"]);
  return { kind: "values", where: parseFilters(input["filters"], ctx), column, query };
}

function parseAggregates(input: Raw, ctx: Ctx): AggregatesPlan {
  const spec = specOf(input);
  rejectGrouping(input, spec);
  const where = parseWhere(spec, ctx);
  const requested = input["columnIds"];
  let columns: PlanColumn[];
  if (requested === undefined || requested === null) columns = ctx.map.visible.filter((column) => column.aggregate !== undefined);
  else {
    if (!Array.isArray(requested)) throw new QueryError("invalid-request", ["columnIds"]);
    if (requested.length > ctx.limits.maxColumnIds) throw new QueryError("limit-exceeded", ["columnIds"]);
    const seen = new Set<PlanColumn>();
    for (const id of requested) {
      const column = typeof id === "string" ? ctx.map.byId.get(id) : undefined;
      if (column && !column.serverOnly && column.aggregate !== undefined) seen.add(column);
    }
    columns = [...seen];
  }
  return { kind: "aggregates", where, columns: columns.map((column) => ({ column, reducer: column.aggregate! })) };
}

function parseRange(input: Raw, ctx: Ctx): { rowRange: { start: number; end: number }; paged: boolean } {
  const whole = (value: unknown, path: string): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new QueryError("invalid-value", [path]);
    return value;
  };
  const { maxPageSize, maxOffset } = ctx.limits;
  let start: number;
  let end: number;
  const paged = input["page"] !== undefined && input["page"] !== null;
  if (paged) {
    const page = whole(input["page"], "page");
    const pageSize = whole(input["pageSize"], "pageSize");
    if (page < 1 || pageSize < 1 || pageSize > maxPageSize) throw new QueryError("invalid-value", ["pageSize"]);
    start = (page - 1) * pageSize;
    if (!Number.isSafeInteger(start + pageSize)) throw new QueryError("invalid-value", ["page"]);
    if (input["start"] !== undefined && input["start"] !== start) throw new QueryError("invalid-value", ["start"]);
    end = start + pageSize;
  } else {
    start = whole(input["start"], "start");
    end = whole(input["end"], "end");
    if (end < start || end - start > maxPageSize) throw new QueryError("invalid-value", ["end"]);
  }
  if (start > maxOffset) throw new QueryError("offset-too-deep", ["start"]);
  return { rowRange: { start, end }, paged };
}

function lookupColumn(id: unknown, ctx: Ctx, path: Path, use: "filter" | "sort"): PlanColumn {
  const column = typeof id === "string" ? ctx.map.byId.get(id) : undefined;
  if (!column || column.serverOnly) throw new QueryError("unknown-column", path);
  if (use === "filter" ? !column.filterable : !column.sortable) throw new QueryError("operator-not-allowed", path);
  return column;
}

function parseSorts(value: unknown, ctx: Ctx): OrderTerm[] {
  const terms: OrderTerm[] = [];
  const seen = new Set<PlanColumn>();
  if (value !== undefined && value !== null) {
    if (!Array.isArray(value)) throw new QueryError("invalid-request", ["spec", "sorts"]);
    if (value.length > ctx.limits.maxSorts) throw new QueryError("limit-exceeded", ["spec", "sorts"]);
    value.forEach((entry: unknown, index) => {
      const path = ["spec", "sorts", index] as const;
      if (!isRecord(entry)) throw new QueryError("invalid-request", path);
      const column = lookupColumn(entry["columnId"], ctx, [...path, "columnId"], "sort");
      if (entry["direction"] !== "asc" && entry["direction"] !== "desc") throw new QueryError("invalid-request", [...path, "direction"]);
      if (seen.has(column)) return;
      seen.add(column);
      terms.push({ column, direction: entry["direction"] });
    });
  }
  for (const column of ctx.map.tieBreaker) if (!seen.has(column)) terms.push({ column, direction: "asc" });
  return terms;
}

function parseFilters(value: unknown, ctx: Ctx): Predicate {
  if (value === undefined || value === null) return TRUE;
  return combine("and", parseNodes(value, ["spec", "filters"], 0, ctx));
}

function parseNodes(value: unknown, path: Path, depth: number, ctx: Ctx): Predicate[] {
  if (!Array.isArray(value)) throw new QueryError("invalid-request", path);
  return value.map((node: unknown, index) => {
    const nodePath = [...path, index];
    if (!isRecord(node)) throw new QueryError("invalid-request", nodePath);
    if (++ctx.budget.nodes > ctx.limits.maxFilterNodes) throw new QueryError("limit-exceeded", nodePath);
    if (Array.isArray(node["filters"])) {
      if (depth + 1 > MAX_FILTER_DEPTH) throw new QueryError("limit-exceeded", nodePath);
      const items = parseNodes(node["filters"], [...nodePath, "filters"], depth + 1, ctx);
      return combine(node["join"] === "or" ? "or" : "and", items);
    }
    if (++ctx.budget.leaves > ctx.limits.maxFilterLeaves) throw new QueryError("limit-exceeded", nodePath);
    return parseLeaf(node, nodePath, ctx);
  });
}

type Shaped = { text: string; pair: [string, string]; list: string[]; matchCase?: boolean };
const NO_SHAPE: Shaped = { text: "", pair: ["", ""], list: [] };

function takeList(value: unknown, path: Path, ctx: Ctx): string[] {
  if (!Array.isArray(value)) return [];
  if (value.length > ctx.limits.maxListLength) throw new QueryError("limit-exceeded", path);
  ctx.budget.listValues += value.length;
  if (ctx.budget.listValues > ctx.limits.maxTreeListValues) throw new QueryError("limit-exceeded", path);
  const out: string[] = [];
  for (const entry of value) if (typeof entry === "string") out.push(entry);
  out.forEach((entry, index) => charge(ctx, entry, [...path, index]));
  return out;
}

function shape(operator: string, value: unknown, path: Path, ctx: Ctx): Shaped {
  const valuePath = [...path, "value"];
  if (operator === "empty" || operator === "notEmpty") return NO_SHAPE;
  if (operator === "isAnyOf" || operator === "isNoneOf") return { ...NO_SHAPE, list: takeList(value, valuePath, ctx) };
  if (operator === "isBetween") {
    const pair: [string, string] = ["", ""];
    if (Array.isArray(value)) {
      for (const index of [0, 1] as const) {
        const entry: unknown = value[index];
        if (typeof entry === "string") {
          charge(ctx, entry, [...valuePath, index]);
          pair[index] = entry;
        }
      }
    }
    return { ...NO_SHAPE, pair };
  }
  if (typeof value !== "string") return NO_SHAPE;
  charge(ctx, value, valuePath);
  return { ...NO_SHAPE, text: value };
}

function parseLeaf(node: Raw, path: Path, ctx: Ctx): Predicate {
  const column = lookupColumn(node["columnId"], ctx, [...path, "columnId"], "filter");
  const operator = node["operator"];
  if (typeof operator !== "string") throw new QueryError("invalid-request", [...path, "operator"]);
  if (!isBuiltInOperatorId(operator)) return parseCustom(column, operator, node["value"], path, ctx);
  return compile(column, operator, { ...shape(operator, node["value"], path, ctx), matchCase: node["matchCase"] === true }, path, ctx);
}

function parseCustom(column: PlanColumn, id: string, value: unknown, path: Path, ctx: Ctx): Predicate {
  const operator = column.operators.get(id);
  if (!operator) throw new QueryError("unknown-operator", [...path, "operator"]);
  const valuePath = [...path, "value"];
  if (operator.input === "none") return leaf(column, { k: "custom", id, value: undefined });
  if (operator.input === "single") {
    if (typeof value !== "string") throw new QueryError("invalid-value", valuePath);
    charge(ctx, value, valuePath);
    return leaf(column, { k: "custom", id, value });
  }
  if (operator.input === "range") {
    if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => typeof entry !== "string")) throw new QueryError("invalid-value", valuePath);
    (value as string[]).forEach((entry, index) => charge(ctx, entry, [...valuePath, index]));
    return leaf(column, { k: "custom", id, value: [value[0], value[1]] });
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new QueryError("invalid-value", valuePath);
  return leaf(column, { k: "custom", id, value: takeList(value, valuePath, ctx) });
}

const blank = (column: PlanColumn, negate: boolean): Predicate => leaf(column, { k: "blank", negate });
const TEXT_ONLY = new Set(["contains", "notContains", "startsWith", "endsWith"]);
const ORDERING = new Set(["gt", "gte", "lt", "lte", "isBetween"]);

function compile(column: PlanColumn, op: string, shaped: Shaped, path: Path, ctx: Ctx): Predicate {
  const { text, pair, list } = shaped;
  if (op === "empty") return blank(column, false);
  if (op === "notEmpty") return blank(column, true);
  if (op === "equals" && text === "") return blank(column, false);
  if (op === "notEquals" && text === "") return blank(column, true);
  if ((op === "contains" || op === "startsWith" || op === "endsWith") && text === "") return TRUE;
  if (op === "notContains" && text === "") return FALSE;
  if ((op === "gt" || op === "gte") && text === "") return FALSE;
  if ((op === "lt" || op === "lte") && text === "") return blank(column, true);
  if (op === "isBetween" && pair[0] === "" && pair[1] === "") return blank(column, true);
  if (op === "isAnyOf" && list.length === 0) return FALSE;
  if (op === "isNoneOf" && list.length === 0) return TRUE;

  const { kind } = column;
  const bad = (kind === "number" || kind === "date" || kind === "checkbox") && TEXT_ONLY.has(op);
  const badOrdering = (kind === "checkbox" || kind === "select" || column.native !== undefined) && ORDERING.has(op);
  if (bad || badOrdering) throw new QueryError("operator-not-allowed", [...path, "operator"]);

  if (kind === "number") return compileNumber(column, op, shaped, path, ctx);
  if (kind === "date") return compileDate(column, op, shaped, ctx);
  if (kind === "checkbox") return compileCheckbox(column, op, shaped);
  return compileText(column, op, shaped);
}

function inTest(column: PlanColumn, op: string, values: Operand[], hasBlank: boolean, caseSensitive: boolean): Predicate {
  const negate = op === "isNoneOf";
  if (values.length === 0) {
    if (hasBlank) return blank(column, negate);
    return negate ? TRUE : FALSE;
  }
  return leaf(column, { k: "in", values, negate, blank: hasBlank, caseSensitive });
}

function nativeText(column: PlanColumn, raw: string): string | null {
  if (column.native === "uuid") return parseUuid(raw);
  if (column.native === "enum") return column.choices?.find((choice) => choice.toLowerCase() === raw.toLowerCase()) ?? null;
  return raw;
}

function compileText(column: PlanColumn, op: string, { text, pair, list, matchCase }: Shaped): Predicate {
  const caseSensitive = column.caseSensitive || matchCase === true;
  if (op === "contains" || op === "notContains" || op === "startsWith" || op === "endsWith") {
    return leaf(column, { k: "text", mode: op === "notContains" ? "contains" : op, text, negate: op === "notContains", caseSensitive });
  }
  if (op === "equals" || op === "notEquals") {
    if (column.native === undefined) return leaf(column, { k: "text", mode: "equals", text, negate: op === "notEquals", caseSensitive });
    const value = nativeText(column, text);
    if (value === null) return op === "equals" ? FALSE : TRUE;
    return leaf(column, { k: op === "equals" ? "eq" : "ne", value: { kind: "text", v: value } });
  }
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") return leaf(column, { k: "cmp", op, value: { kind: "text", v: text } });
  if (op === "isBetween") {
    return leaf(column, { k: "range", lo: pair[0] === "" ? undefined : { kind: "text", v: pair[0] }, hi: pair[1] === "" ? undefined : { kind: "text", v: pair[1] }, hiExclusive: false });
  }
  const values = new Map<string, Operand>();
  let hasBlank = false;
  for (const entry of list) {
    if (entry === "") {
      hasBlank = true;
      continue;
    }
    const value = column.native === undefined ? entry : nativeText(column, entry);
    if (value === null) continue;
    const key = caseSensitive || column.native !== undefined ? value : value.toLowerCase();
    if (!values.has(key)) values.set(key, { kind: "text", v: value });
  }
  return inTest(column, op, [...values.values()], hasBlank, caseSensitive || column.native !== undefined);
}

function compileCheckbox(column: PlanColumn, op: string, { text, list }: Shaped): Predicate {
  if (op === "equals" || op === "notEquals") {
    const value = parseBoolean(text);
    if (value === null) return op === "equals" ? FALSE : TRUE;
    return leaf(column, { k: op === "equals" ? "eq" : "ne", value: { kind: "boolean", v: value } });
  }
  const values = new Set<boolean>();
  let hasBlank = false;
  for (const entry of list) {
    if (entry === "") hasBlank = true;
    else {
      const value = parseBoolean(entry);
      if (value !== null) values.add(value);
    }
  }
  return inTest(column, op, [...values].map((v) => ({ kind: "boolean", v })), hasBlank, true);
}

function numberText(raw: string, path: Path, ctx: Ctx): Decimal | null {
  const trimmed = raw.trim();
  if (trimmed.length > ctx.limits.maxNumberLength) throw new QueryError("invalid-value", path);
  return parseDecimal(trimmed);
}

/** The operand for an exact number test, or `null` when no stored value can match. */
function numberOperand(column: PlanColumn, value: Decimal): Operand | null {
  if (isIntType(column.numeric)) {
    if (!isInteger(value)) return null;
    const whole = floorDecimal(value);
    const [min, max] = INT_RANGE[column.numeric];
    return whole < min || whole > max ? null : { kind: "bigint", v: whole };
  }
  if (column.numeric === "float") return { kind: "number", v: String(clampFloat(decimalToString(value))) };
  return { kind: "number", v: decimalToString(value) };
}

function compileNumber(column: PlanColumn, op: string, { text, pair, list }: Shaped, path: Path, ctx: Ctx): Predicate {
  const valuePath = [...path, "value"];
  if (op === "equals" || op === "notEquals") {
    const parsed = numberText(text, valuePath, ctx);
    const operand = parsed ? numberOperand(column, parsed) : null;
    if (!operand) return op === "equals" ? FALSE : TRUE;
    return leaf(column, { k: op === "equals" ? "eq" : "ne", value: operand });
  }
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const parsed = numberText(text, valuePath, ctx);
    if (!parsed) return FALSE;
    return compileNumberCmp(column, op, parsed);
  }
  if (op === "isBetween") {
    const lo = pair[0] === "" ? undefined : numberText(pair[0], valuePath, ctx);
    const hi = pair[1] === "" ? undefined : numberText(pair[1], valuePath, ctx);
    if (lo === null || hi === null) return FALSE;
    return compileNumberRange(column, lo, hi);
  }
  const values = new Map<string, Operand>();
  let hasBlank = false;
  for (const entry of list) {
    if (entry === "") {
      hasBlank = true;
      continue;
    }
    const parsed = numberText(entry, valuePath, ctx);
    const operand = parsed ? numberOperand(column, parsed) : null;
    if (operand) values.set(String(operand.v), operand);
  }
  return inTest(column, op, [...values.values()], hasBlank, true);
}

function compileNumberCmp(column: PlanColumn, op: "gt" | "gte" | "lt" | "lte", value: Decimal): Predicate {
  if (!isIntType(column.numeric)) {
    const operand = numberOperand(column, value) ?? { kind: "number" as const, v: decimalToString(value) };
    return leaf(column, { k: "cmp", op, value: operand });
  }
  const [min, max] = INT_RANGE[column.numeric];
  const bound = op === "gt" || op === "lte" ? floorDecimal(value) : ceilDecimal(value);
  const everyRow = blank(column, true);
  const outcome: Record<typeof op, Predicate | null> = {
    gt: bound >= max ? FALSE : bound < min ? everyRow : null,
    gte: bound > max ? FALSE : bound <= min ? everyRow : null,
    lt: bound <= min ? FALSE : bound > max ? everyRow : null,
    lte: bound < min ? FALSE : bound >= max ? everyRow : null,
  };
  return outcome[op] ?? leaf(column, { k: "cmp", op, value: { kind: "bigint", v: bound } });
}

function compileNumberRange(column: PlanColumn, lo: Decimal | undefined, hi: Decimal | undefined): Predicate {
  const toOperand = (value: Decimal): Operand => numberOperand(column, value) ?? { kind: "number", v: decimalToString(value) };
  if (!isIntType(column.numeric)) {
    return leaf(column, { k: "range", lo: lo && toOperand(lo), hi: hi && toOperand(hi), hiExclusive: false });
  }
  const [min, max] = INT_RANGE[column.numeric];
  let low: Operand | undefined;
  let high: Operand | undefined;
  if (lo) {
    const bound = ceilDecimal(lo);
    if (bound > max) return FALSE;
    if (bound > min) low = { kind: "bigint", v: bound };
  }
  if (hi) {
    const bound = floorDecimal(hi);
    if (bound < min) return FALSE;
    if (bound < max) high = { kind: "bigint", v: bound };
  }
  if (!low && !high) return blank(column, true);
  return leaf(column, { k: "range", lo: low, hi: high, hiExclusive: false });
}

type DateBound = { day: string } | { instant: string };

function dateBound(column: PlanColumn, raw: string): DateBound | null {
  const trimmed = raw.trim();
  const day = parseDate(trimmed);
  if (day) return { day };
  if (!column.time) return null;
  const instant = parseInstant(trimmed);
  return instant ? { instant } : null;
}

function compileDate(column: PlanColumn, op: string, { text, pair, list }: Shaped, ctx: Ctx): Predicate {
  const tz = ctx.timeZone;
  const instantOf = (v: string): Operand => ({ kind: "instant", v });
  const dayStart = (day: string): Operand => instantOf(startOfLocalDay(day, tz));
  const plain = (bound: DateBound): Operand => ("day" in bound ? { kind: "date", v: bound.day } : instantOf(bound.instant));
  const dayIncluded = (day: string): Predicate => leaf(column, { k: "range", lo: dayStart(day), hi: dayStart(nextDay(day)), hiExclusive: true });
  const dayExcluded = (day: string): Predicate =>
    combine("or", [leaf(column, { k: "cmp", op: "lt", value: dayStart(day) }), leaf(column, { k: "cmp", op: "gte", value: dayStart(nextDay(day)) })]);

  if (op === "equals" || op === "notEquals") {
    const bound = dateBound(column, text);
    if (!bound) return op === "equals" ? FALSE : TRUE;
    if (column.time && "day" in bound) return op === "equals" ? dayIncluded(bound.day) : combine("or", [blank(column, false), dayExcluded(bound.day)]);
    return leaf(column, { k: op === "equals" ? "eq" : "ne", value: plain(bound) });
  }
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    const bound = dateBound(column, text);
    if (!bound) return FALSE;
    if (column.time && "day" in bound) {
      const edge = op === "gt" || op === "lte" ? dayStart(nextDay(bound.day)) : dayStart(bound.day);
      return leaf(column, { k: "cmp", op: op === "gt" || op === "gte" ? "gte" : "lt", value: edge });
    }
    return leaf(column, { k: "cmp", op, value: plain(bound) });
  }
  if (op === "isBetween") {
    const lo = pair[0] === "" ? undefined : dateBound(column, pair[0]);
    const hi = pair[1] === "" ? undefined : dateBound(column, pair[1]);
    if (lo === null || hi === null) return FALSE;
    const dayWise = column.time && ((lo && "day" in lo) || (hi && "day" in hi));
    if (dayWise) {
      const low = lo ? ("day" in lo ? dayStart(lo.day) : instantOf(lo.instant)) : undefined;
      const high = hi ? ("day" in hi ? dayStart(nextDay(hi.day)) : instantOf(hi.instant)) : undefined;
      return leaf(column, { k: "range", lo: low, hi: high, hiExclusive: true });
    }
    return leaf(column, { k: "range", lo: lo && plain(lo), hi: hi && plain(hi), hiExclusive: false });
  }
  const days: string[] = [];
  const exact = new Map<string, Operand>();
  let hasBlank = false;
  for (const entry of list) {
    if (entry === "") {
      hasBlank = true;
      continue;
    }
    const bound = dateBound(column, entry);
    if (!bound) continue;
    if (column.time && "day" in bound) days.push(bound.day);
    else exact.set(JSON.stringify(plain(bound)), plain(bound));
  }
  if (!column.time) return inTest(column, op, [...exact.values()], hasBlank, true);
  const uniqueDays = [...new Set(days)];
  const included = [...uniqueDays.map(dayIncluded), ...(exact.size > 0 ? [leaf(column, { k: "in", values: [...exact.values()], negate: false, blank: false, caseSensitive: true })] : [])];
  if (op === "isAnyOf") return included.length === 0 && !hasBlank ? FALSE : combine("or", [...included, ...(hasBlank ? [blank(column, false)] : [])]);
  const excluded = [...uniqueDays.map(dayExcluded), ...(exact.size > 0 ? [leaf(column, { k: "in", values: [...exact.values()], negate: true, blank: false, caseSensitive: true })] : [])];
  if (excluded.length === 0) return hasBlank ? blank(column, true) : TRUE;
  return hasBlank ? combine("and", [blank(column, true), ...excluded]) : combine("or", [blank(column, false), combine("and", excluded)]);
}

function parseSearch(value: unknown, ctx: Ctx): Predicate {
  if (value === undefined || value === null) return TRUE;
  if (typeof value !== "string") throw new QueryError("invalid-request", ["spec", "searchText"]);
  if (value.length > ctx.limits.maxSearchLength) throw new QueryError("invalid-value", ["spec", "searchText"]);
  const phrase = value.trim();
  if (phrase === "") return TRUE;
  const searched = ctx.map.visible.filter((column) => column.searchable);
  if (searched.length === 0) return TRUE;
  const number = parseDecimal(phrase);
  const items: Predicate[] = [];
  for (const column of searched) {
    if (column.kind === "number") {
      const operand = number ? numberOperand(column, number) : null;
      if (operand) items.push(leaf(column, { k: "eq", value: operand }));
    } else items.push(leaf(column, { k: "text", mode: "contains", text: phrase, negate: false, caseSensitive: false }));
  }
  return combine("or", items);
}
