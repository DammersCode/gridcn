import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import { QueryError } from "./errors";
import { type QueryLimits, type ResolvedLimits, resolveLimits } from "./limits";
import { decimalToString, isIntType, parseDecimal } from "./operands";
import { readCell } from "./parse-import-rows";
import { parseQuery } from "./parse-query";
import { FALSE, type Operand, type RowsPlan, combine, leaf } from "./plan";

/** The body cap of a selection request: 100,000 uuids and a spec. */
export const SELECTION_MAX_BODY_BYTES = 8 * 1024 * 1024;

export type SelectionInclude = "ids" | "rows";
export type ParsedSelection = { plan: RowsPlan; include?: SelectionInclude };
export type ParseSelectionOptions = {
  columns: ColumnMap;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
};

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
// Grouping keys never change which rows match, so only these spec fields reach the parser.
const SPEC_FIELDS = ["sorts", "filters", "filterJoin", "searchText"] as const;
// An exponent form is dropped: `parseDecimal` of `1e9999` builds a 10,000-digit power of ten.
const PLAIN_DECIMAL = /^-?\d+(?:\.\d+)?$/;

function keyOperand(key: PlanColumn, id: string, limits: ResolvedLimits): Operand | null {
  if (key.kind === "number" && (id.length > limits.maxNumberLength || !PLAIN_DECIMAL.test(id.trim()))) return null;
  const cell = readCell(key, id, limits, []);
  if (!cell.ok || cell.value === null) return null;
  if (key.kind !== "number") return { kind: "text", v: cell.value as string };
  const canonical = decimalToString(parseDecimal(id.trim())!);
  return isIntType(key.numeric) ? { kind: "bigint", v: BigInt(canonical) } : { kind: "number", v: canonical };
}

/** The parsed keys of one id list; the count, each id, and the total id text are bounded before any id is parsed. */
function keyOperands(key: PlanColumn, list: unknown, limits: ResolvedLimits, path: (string | number)[]): Operand[] {
  if (!Array.isArray(list)) throw new QueryError("invalid-request", path);
  if (list.length > limits.maxExcludedIds) throw new QueryError("limit-exceeded", path);
  let chars = 0;
  for (let index = 0; index < list.length; index++) {
    const id: unknown = list[index];
    if (typeof id !== "string") throw new QueryError("invalid-request", [...path, index]);
    if (id.length > limits.maxValueLength) throw new QueryError("limit-exceeded", [...path, index]);
    chars += id.length;
  }
  if (chars > SELECTION_MAX_BODY_BYTES) throw new QueryError("limit-exceeded", path);
  const out: Operand[] = [];
  for (const id of list as string[]) {
    const operand = keyOperand(key, id, limits);
    if (operand) out.push(operand);
  }
  return out;
}

function specFields(spec: unknown): Raw {
  if (spec === undefined || spec === null) return {};
  if (!isRecord(spec)) throw new QueryError("invalid-request", ["selection", "spec"]);
  return Object.fromEntries(SPEC_FIELDS.filter((name) => Object.hasOwn(spec, name)).map((name) => [name, spec[name]]));
}

/**
 * Reads `{ selection, include?, start?, end? }`, where `selection` is the grid's `DataGridSelectedRows`, into a counted
 * rows plan. `ids` mode matches its ids; `allMatching` matches the spec's filters and search minus `excludedIds`, ordered
 * by the spec's sorts. An id the key cannot parse is dropped. `start` defaults to 0 and `end` to `start + maxPageSize`.
 * Throws `unsupported` without one number or text `primaryKey`.
 */
export function parseSelection(input: unknown, options: ParseSelectionOptions): ParsedSelection {
  const limits = resolveLimits(options.limits);
  const key = [...mapOf(options.columns).byId.values()].find((column) => column.primaryKey);
  if (!key || (key.kind !== "number" && key.kind !== "text" && key.kind !== "select")) throw new QueryError("unsupported", ["selection"]);
  if (!isRecord(input)) throw new QueryError("invalid-request", []);
  const { selection, include } = input;
  if (!isRecord(selection)) throw new QueryError("invalid-request", ["selection"]);
  if (include !== undefined && include !== "ids" && include !== "rows") throw new QueryError("invalid-request", ["include"]);
  const mode = selection["mode"];
  if (mode !== "ids" && mode !== "allMatching") throw new QueryError("invalid-request", ["selection", "mode"]);
  const listName = mode === "ids" ? "ids" : "excludedIds";
  const values = keyOperands(key, selection[listName], limits, ["selection", listName]);
  const spec = mode === "allMatching" ? specFields(selection["spec"]) : {};
  const start = input["start"] ?? 0;
  const end = input["end"] ?? (typeof start === "number" ? start + limits.maxPageSize : undefined);
  let parsed: RowsPlan;
  try {
    parsed = parseQuery({ spec, start, end }, { columns: options.columns, request: "rows", limits: options.limits, timeZone: options.timeZone });
  } catch (error) {
    if (error instanceof QueryError && error.path[0] === "spec") throw new QueryError(error.code, ["selection", ...error.path]);
    throw error;
  }
  const idTest = values.length === 0 ? undefined : leaf(key, { k: "ids", values, negate: mode === "allMatching" });
  const where = mode === "ids" ? (idTest ?? FALSE) : combine("and", [parsed.where, ...(idTest ? [idTest] : [])]);
  return { plan: { ...parsed, where, runCount: true }, ...(include === undefined ? {} : { include }) };
}
