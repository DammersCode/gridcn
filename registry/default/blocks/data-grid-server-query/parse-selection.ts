import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import type { AdapterCapabilities } from "./create-grid-query";
import { QueryError } from "./errors";
import { type QueryLimits, type ResolvedLimits, resolveLimits } from "./limits";
import { parseQuery } from "./parse-query";
import { FALSE, type Operand, type RowsPlan, combine, leaf } from "./plan";
import { keyOperand } from "./validate-change";

/** The body cap of a selection request under `limits`: a quoted uuid and a comma per id, plus a spec at twice the string budget. */
export function selectionBodyBytes(limits: ResolvedLimits): number {
  return limits.maxSelectionIds * 40 + 2 * limits.maxTreeStringBytes;
}

export type SelectionInclude = "ids" | "rows";
export type ParsedSelection = { plan: RowsPlan; include?: SelectionInclude };
export type ParseSelectionOptions = {
  columns: ColumnMap;
  limits?: QueryLimits;
  /** IANA zone or fixed offset of day filters on `time` columns. Default `"UTC"`. */
  timeZone?: string;
  /** The executor's capabilities: an id list past `maxBoundIds`, or a test the adapter cannot run, is refused here. */
  capabilities?: AdapterCapabilities;
};

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
// Grouping keys never change which rows match, so only these spec fields reach the parser.
const SPEC_FIELDS = ["sorts", "filters", "filterJoin", "searchText"] as const;
/**
 * The parsed keys of one id list; the count is bounded before any id is read. An id no key can hold (a draft or stale id)
 * is dropped. An id the layer declines (a length or digit limit) is dropped from the selected ids and refused in the excluded ids,
 * where dropping it would put a row the key may hold back into the selection.
 */
function keyOperands(key: PlanColumn, list: unknown, limits: ResolvedLimits, path: (string | number)[], excluded: boolean): Operand[] {
  if (!Array.isArray(list)) throw new QueryError("invalid-request", path);
  if (list.length > limits.maxSelectionIds) throw new QueryError("limit-exceeded", path);
  const out: Operand[] = [];
  for (let index = 0; index < list.length; index++) {
    const id: unknown = list[index];
    if (typeof id !== "string") throw new QueryError("invalid-request", [...path, index]);
    const operand = keyOperand(key, id, limits);
    if (typeof operand !== "string") out.push(operand);
    else if (excluded && operand === "declined") throw new QueryError("invalid-value", [...path, index]);
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
 * by the spec's sorts. An id no key can hold is dropped; an `excludedIds` entry the layer declines (over a length limit, or a decimal such as `1e9999` with more digits than `maxNumberLength`) is `invalid-value`. `start` defaults to 0 and `end` to `start + maxPageSize`.
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
  const values = keyOperands(key, selection[listName], limits, ["selection", listName], mode === "allMatching");
  const { capabilities } = options;
  if (values.length > (capabilities?.maxBoundIds ?? Infinity)) throw new QueryError("limit-exceeded", ["selection", listName]);
  // An excluded uuid stays excluded in any case only through a folded comparison.
  if (mode === "allMatching" && values.length > 0 && key.native === "uuid" && capabilities?.caseInsensitiveText === "like-only") throw new QueryError("unsupported", ["selection", listName]);
  const spec = mode === "allMatching" ? specFields(selection["spec"]) : {};
  const start = input["start"] ?? 0;
  const end = input["end"] ?? (typeof start === "number" ? start + limits.maxPageSize : undefined);
  let parsed: RowsPlan;
  try {
    parsed = parseQuery({ spec, start, end }, { columns: options.columns, request: "rows", limits: options.limits, timeZone: options.timeZone, capabilities });
  } catch (error) {
    if (error instanceof QueryError && error.path[0] === "spec") throw new QueryError(error.code, ["selection", ...error.path]);
    throw error;
  }
  const idTest = values.length === 0 ? undefined : leaf(key, { k: "ids", values, negate: mode === "allMatching" });
  const where = mode === "ids" ? (idTest ?? FALSE) : combine("and", [parsed.where, ...(idTest ? [idTest] : [])]);
  return { plan: { ...parsed, where, runCount: true }, ...(include === undefined ? {} : { include }) };
}
