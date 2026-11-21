import type { FilterGroup, FilterNode, FilterOperator, FilterOperatorInput, FilterSpec, ServerSpec, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import type { GroupKey, GroupPathSegment, ServerAggregate } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_FILTER_GROUP_DEPTH, MAX_SPEC_SEARCH_LENGTH, MAX_SPEC_SORTS, filterOperatorInput, isBuiltInOperator } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** What a request may do with one column. Every field is optional. */
export type ServerSpecColumnRules = {
  /** `false` rejects a sort on the column. Default `true`. */
  sortable?: boolean;
  /** `false` rejects a filter on the column. Default `true`. */
  filterable?: boolean;
  /** Allowed operators. Default: every built-in operator. A custom operator in `customOperators` is allowed whether or not this list names it. */
  operators?: readonly FilterOperator[];
  /** Custom operators the column accepts, with the value shape of each. */
  customOperators?: Readonly<Record<string, FilterOperatorInput>>;
  /** `false` rejects `groupBy` and `pivot` on the column. Default `true`. */
  groupable?: boolean;
  /** `false` rejects an aggregate on the column. Default `true`. */
  aggregatable?: boolean;
};

/** Bounds that apply to the whole request. Every field is optional; a negative or non-finite value keeps the default. Groups nest at most 2 levels deep. */
export type ServerSpecLimits = {
  /** Most sort entries. Default 64. */
  maxSorts?: number;
  /** Most filter rows in the tree. Default 64. */
  maxFilters?: number;
  /** Most filter groups in the tree. Default 16. */
  maxGroups?: number;
  /** Longest text of one filter value, one list entry, or one range bound. Default 1000. */
  maxValueLength?: number;
  /** Most entries of an `isAnyOf` or `isNoneOf` list. Default 1000. */
  maxListLength?: number;
  /** Longest `searchText`. Default 500. */
  maxSearchLength?: number;
  /** Most `groupBy` columns. Default 4. */
  maxGroupLevels?: number;
  /** Longest group key of a group path. Default 1024. */
  maxGroupKeyLength?: number;
  /** Most `aggregates` entries. Default 32. */
  maxGroupAggregates?: number;
};

export type ParseServerSpecOptions = {
  /** The columns a request may name: a list of ids (no extra rules), or a map from id to its rules. */
  columns: readonly string[] | Readonly<Record<string, ServerSpecColumnRules>>;
  limits?: ServerSpecLimits;
};

/** Thrown by {@link parseServerSpec}. `path` names the offending part of the request, such as `filters[2].value`. */
export class ServerSpecError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ServerSpecError";
    this.path = path;
  }
}

const DEFAULT_LIMITS = { maxSorts: MAX_SPEC_SORTS, maxFilters: 64, maxGroups: 16, maxValueLength: 1000, maxListLength: 1000, maxSearchLength: MAX_SPEC_SEARCH_LENGTH, maxGroupLevels: 4, maxGroupKeyLength: 1024, maxGroupAggregates: 32 } satisfies Required<ServerSpecLimits>;

type Budget = { filters: number; groups: number };

type Raw = { sorts?: unknown; filters?: unknown; filterJoin?: unknown; not?: unknown; searchText?: unknown; groupBy?: unknown; aggregates?: unknown; pivot?: unknown; columnId?: unknown; direction?: unknown; join?: unknown; operator?: unknown; value?: unknown; matchCase?: unknown };

const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Turns an untrusted request body into a bounded, typed {@link ServerSpec}, or throws {@link ServerSpecError}. It checks the
 * shape, the column ids, the operators, the value shapes, and the size of the tree, and drops every key it does not know.
 * It does not build a query: map the result to your query layer.
 *
 * @example
 * const spec = parseServerSpec(body.spec, { columns: ["name", "status", "age"] });
 */
export function parseServerSpec(input: unknown, options: ParseServerSpecOptions): ServerSpec {
  const limits = limitsOf(options);
  const rules = columnRules(options.columns);
  if (!isRecord(input)) throw new ServerSpecError("spec", "must be an object");
  const spec: ServerSpec = {
    sorts: parseSorts(input.sorts, rules, limits),
    filters: parseFilters(input.filters, rules, limits),
    searchText: parseSearch(input.searchText, limits),
  };
  const filterJoin = parseFilterJoin(input.filterJoin);
  const groupBy = parseGroupBy(input.groupBy, rules, limits);
  const aggregates = parseAggregates(input.aggregates, groupBy.length > 0, rules, limits);
  const pivot = parsePivot(input.pivot, groupBy, aggregates.length > 0, rules);
  return { ...spec, ...(filterJoin === "or" ? { filterJoin } : null), ...(groupBy.length > 0 ? { groupBy } : null), ...(aggregates.length > 0 ? { aggregates } : null), ...(pivot ? { pivot } : null) };
}

/**
 * Reads the `groupPath` and `childKind` of a grouped request against its parsed `spec`, or throws {@link ServerSpecError}. The path follows
 * `spec.groupBy` in order and is not longer; the kind is `"groups"` while the path is shorter than `groupBy`, else `"rows"`.
 * A spec without `groupBy` accepts an empty path only.
 *
 * @example
 * const { groupPath, childKind } = parseGroupPath(body, spec);
 */
export function parseGroupPath(input: unknown, spec: ServerSpec, options: { limits?: ServerSpecLimits } = {}): { groupPath: GroupPathSegment[]; childKind: "groups" | "rows" } {
  const groupBy = spec.groupBy ?? [];
  const limits = limitsOf(options);
  const body = isRecord(input) ? (input as { groupPath?: unknown; childKind?: unknown }) : {};
  const rawPath = body.groupPath ?? [];
  if (!Array.isArray(rawPath)) throw new ServerSpecError("groupPath", "must be an array");
  if (rawPath.length > groupBy.length) throw new ServerSpecError("groupPath", "is longer than groupBy");
  const groupPath = rawPath.map((segment: unknown, index): GroupPathSegment => {
    const path = `groupPath[${index}]`;
    if (!isRecord(segment)) throw new ServerSpecError(path, "must be an object");
    const raw = segment as { columnId?: unknown; key?: unknown };
    if (raw.columnId !== groupBy[index]) throw new ServerSpecError(`${path}.columnId`, "must follow groupBy in order");
    return { columnId: groupBy[index]!, key: groupKey(raw.key, `${path}.key`, limits) };
  });
  const childKind = groupPath.length < groupBy.length ? "groups" : "rows";
  if (body.childKind !== undefined && body.childKind !== childKind) throw new ServerSpecError("childKind", `must be "${childKind}" for a path of ${groupPath.length} of ${groupBy.length} levels`);
  return { groupPath, childKind };
}

function parseFilterJoin(value: unknown): "and" | "or" {
  if (value === undefined || value === "and" || value === "or") return value ?? "and";
  throw new ServerSpecError("filterJoin", 'must be "and" or "or"');
}

function limitsOf(options: { limits?: ServerSpecLimits }): Required<ServerSpecLimits> {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ServerSpecLimits)[]) {
    const wanted = options.limits?.[key];
    if (wanted !== undefined && Number.isFinite(wanted) && wanted >= 0) limits[key] = wanted;
  }
  return limits;
}

function groupKey(value: unknown, path: string, limits: Required<ServerSpecLimits>): GroupKey {
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value !== "string") throw new ServerSpecError(path, "must be a string, a finite number, a boolean, or null");
  if (value.length > limits.maxGroupKeyLength) throw new ServerSpecError(path, `is longer than ${limits.maxGroupKeyLength}`);
  return value;
}

function parseGroupBy(value: unknown, rules: ReadonlyMap<string, ServerSpecColumnRules>, limits: Required<ServerSpecLimits>): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ServerSpecError("groupBy", "must be an array");
  if (value.length > limits.maxGroupLevels) throw new ServerSpecError("groupBy", `holds more than ${limits.maxGroupLevels} columns`);
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const path = `groupBy[${index}]`;
    const columnId = knownColumn(entry, rules, path);
    if (rules.get(columnId)!.groupable === false) throw new ServerSpecError(path, `"${columnId}" cannot be grouped`);
    if (seen.has(columnId)) throw new ServerSpecError(path, `repeats "${columnId}"`);
    seen.add(columnId);
    return columnId;
  });
}

const REDUCERS: readonly string[] = ["sum", "avg", "min", "max", "count"];

function parseAggregates(value: unknown, grouped: boolean, rules: ReadonlyMap<string, ServerSpecColumnRules>, limits: Required<ServerSpecLimits>): ServerAggregate[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ServerSpecError("aggregates", "must be an array");
  if (value.length === 0) return [];
  if (!grouped) throw new ServerSpecError("aggregates", "needs groupBy");
  if (value.length > limits.maxGroupAggregates) throw new ServerSpecError("aggregates", `holds more than ${limits.maxGroupAggregates} entries`);
  const seen = new Set<string>();
  return value.map((entry: unknown, index) => {
    const path = `aggregates[${index}]`;
    if (!isRecord(entry)) throw new ServerSpecError(path, "must be an object");
    const raw = entry as { columnId?: unknown; reducer?: unknown };
    const columnId = knownColumn(raw.columnId, rules, `${path}.columnId`);
    if (rules.get(columnId)!.aggregatable === false) throw new ServerSpecError(`${path}.columnId`, `"${columnId}" cannot be aggregated`);
    if (seen.has(columnId)) throw new ServerSpecError(`${path}.columnId`, `repeats "${columnId}"`);
    seen.add(columnId);
    if (typeof raw.reducer !== "string" || !REDUCERS.includes(raw.reducer)) throw new ServerSpecError(`${path}.reducer`, `must be one of ${REDUCERS.join(", ")}`);
    return { columnId, reducer: raw.reducer as ServerAggregate["reducer"] };
  });
}

function parsePivot(value: unknown, groupBy: readonly string[], aggregated: boolean, rules: ReadonlyMap<string, ServerSpecColumnRules>): ServerSpec["pivot"] {
  const empty = Array.isArray(value) ? value.length === 0 : isRecord(value) && Object.keys(value).length === 0;
  if (value === undefined || value === null || empty) return undefined;
  if (!isRecord(value)) throw new ServerSpecError("pivot", "must be an object");
  if (groupBy.length === 0 || !aggregated) throw new ServerSpecError("pivot", "needs groupBy and aggregates");
  const columnIds = (value as { columnIds?: unknown }).columnIds;
  if (!Array.isArray(columnIds) || columnIds.length !== 1) throw new ServerSpecError("pivot.columnIds", "must hold exactly 1 column id");
  const columnId = knownColumn(columnIds[0], rules, "pivot.columnIds[0]");
  if (rules.get(columnId)!.groupable === false) throw new ServerSpecError("pivot.columnIds[0]", `"${columnId}" cannot be pivoted`);
  if (groupBy.includes(columnId)) throw new ServerSpecError("pivot.columnIds[0]", `"${columnId}" is in groupBy`);
  return { columnIds: [columnId] };
}

function columnRules(columns: ParseServerSpecOptions["columns"]): ReadonlyMap<string, ServerSpecColumnRules> {
  if (Array.isArray(columns)) return new Map((columns as readonly string[]).map((id) => [id, {}]));
  return new Map(Object.entries(columns as Readonly<Record<string, ServerSpecColumnRules>>));
}

function parseSearch(value: unknown, limits: Required<ServerSpecLimits>): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new ServerSpecError("searchText", "must be a string");
  if (value.length > limits.maxSearchLength) throw new ServerSpecError("searchText", `is longer than ${limits.maxSearchLength}`);
  return value;
}

function parseSorts(value: unknown, rules: ReadonlyMap<string, ServerSpecColumnRules>, limits: Required<ServerSpecLimits>): SortSpec[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ServerSpecError("sorts", "must be an array");
  if (value.length > limits.maxSorts) throw new ServerSpecError("sorts", `holds more than ${limits.maxSorts} entries`);
  return value.map((entry: unknown, index) => {
    const path = `sorts[${index}]`;
    if (!isRecord(entry)) throw new ServerSpecError(path, "must be an object");
    const columnId = knownColumn(entry.columnId, rules, `${path}.columnId`);
    if (rules.get(columnId)!.sortable === false) throw new ServerSpecError(`${path}.columnId`, `"${columnId}" cannot be sorted`);
    if (entry.direction !== "asc" && entry.direction !== "desc") throw new ServerSpecError(`${path}.direction`, 'must be "asc" or "desc"');
    return { columnId, direction: entry.direction };
  });
}

function knownColumn(value: unknown, rules: ReadonlyMap<string, ServerSpecColumnRules>, path: string): string {
  if (typeof value !== "string" || !rules.has(value)) throw new ServerSpecError(path, "names an unknown column");
  return value;
}

function parseFilters(value: unknown, rules: ReadonlyMap<string, ServerSpecColumnRules>, limits: Required<ServerSpecLimits>): FilterNode[] {
  if (value === undefined || value === null) return [];
  const budget: Budget = { filters: 0, groups: 0 };
  return parseNodes(value, "filters", 0, rules, limits, budget);
}

function parseNodes(value: unknown, path: string, depth: number, rules: ReadonlyMap<string, ServerSpecColumnRules>, limits: Required<ServerSpecLimits>, budget: Budget): FilterNode[] {
  if (!Array.isArray(value)) throw new ServerSpecError(path, "must be an array");
  return value.map((node: unknown, index) => {
    const nodePath = `${path}[${index}]`;
    if (!isRecord(node)) throw new ServerSpecError(nodePath, "must be an object");
    if (Object.hasOwn(node, "filters")) return parseGroup(node, nodePath, depth + 1, rules, limits, budget);
    return parseRow(node, nodePath, rules, limits, budget);
  });
}

function parseGroup(node: Raw, path: string, depth: number, rules: ReadonlyMap<string, ServerSpecColumnRules>, limits: Required<ServerSpecLimits>, budget: Budget): FilterGroup {
  if (depth > MAX_FILTER_GROUP_DEPTH) throw new ServerSpecError(path, `nests groups deeper than ${MAX_FILTER_GROUP_DEPTH}`);
  budget.groups += 1;
  if (budget.groups > limits.maxGroups) throw new ServerSpecError(path, `holds more than ${limits.maxGroups} groups`);
  if (node.join !== "and" && node.join !== "or") throw new ServerSpecError(`${path}.join`, 'must be "and" or "or"');
  if (node.not !== undefined && typeof node.not !== "boolean") throw new ServerSpecError(`${path}.not`, "must be a boolean");
  const filters = parseNodes(node.filters, `${path}.filters`, depth, rules, limits, budget);
  return node.not === true ? { join: node.join, not: true, filters } : { join: node.join, filters };
}

function parseRow(node: Raw, path: string, rules: ReadonlyMap<string, ServerSpecColumnRules>, limits: Required<ServerSpecLimits>, budget: Budget): FilterSpec {
  budget.filters += 1;
  if (budget.filters > limits.maxFilters) throw new ServerSpecError(path, `holds more than ${limits.maxFilters} filters`);
  const columnId = knownColumn(node.columnId, rules, `${path}.columnId`);
  const column = rules.get(columnId)!;
  if (column.filterable === false) throw new ServerSpecError(`${path}.columnId`, `"${columnId}" cannot be filtered`);
  if (typeof node.operator !== "string") throw new ServerSpecError(`${path}.operator`, "must be a string");
  const operator = node.operator;
  const custom = column.customOperators && Object.hasOwn(column.customOperators, operator) ? column.customOperators[operator] : undefined;
  const allowed = column.operators ? column.operators.includes(operator) || custom !== undefined : isBuiltInOperator(operator) || custom !== undefined;
  if (!allowed) throw new ServerSpecError(`${path}.operator`, `"${operator.slice(0, 40)}" is not allowed on "${columnId.slice(0, 40)}"`);
  const input = custom ?? filterOperatorInput(operator);
  const value = parseValue(node.value, input, `${path}.value`, limits);
  const row: FilterSpec = value === undefined ? { columnId, operator } : { columnId, operator, value };
  return node.matchCase === true ? { ...row, matchCase: true } : row;
}

function text(value: unknown, path: string, limits: Required<ServerSpecLimits>): string {
  if (typeof value !== "string") throw new ServerSpecError(path, "must be a string");
  if (value.length > limits.maxValueLength) throw new ServerSpecError(path, `is longer than ${limits.maxValueLength}`);
  return value;
}

function parseValue(value: unknown, input: FilterOperatorInput, path: string, limits: Required<ServerSpecLimits>): FilterSpec["value"] {
  if (input === "none") return undefined;
  if (input === "single") return text(value, path, limits);
  if (!Array.isArray(value)) throw new ServerSpecError(path, "must be an array");
  if (input === "range") {
    if (value.length !== 2) throw new ServerSpecError(path, "must hold two bounds");
    return [text(value[0], `${path}[0]`, limits), text(value[1], `${path}[1]`, limits)];
  }
  if (value.length > limits.maxListLength) throw new ServerSpecError(path, `holds more than ${limits.maxListLength} entries`);
  return value.map((entry: unknown, index) => text(entry, `${path}[${index}]`, limits));
}
