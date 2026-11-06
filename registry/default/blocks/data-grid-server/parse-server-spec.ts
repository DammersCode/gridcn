import type { FilterGroup, FilterNode, FilterOperator, FilterOperatorInput, FilterSpec, ServerSpec, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_FILTER_GROUP_DEPTH, filterOperatorInput, isBuiltInOperator } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** What a request may do with one column. Every field is optional. */
export type ServerSpecColumnRules = {
  /** `false` rejects a sort on the column. Default `true`. */
  sortable?: boolean;
  /** `false` rejects a filter on the column. Default `true`. */
  filterable?: boolean;
  /** Allowed operators. Default: every built-in operator and every custom operator in `customOperators`. */
  operators?: readonly FilterOperator[];
  /** Custom operators the column accepts, with the value shape of each. */
  customOperators?: Readonly<Record<string, FilterOperatorInput>>;
};

/** Bounds that apply to the whole request. Every field is optional. */
export type ServerSpecLimits = {
  /** Most sort entries. Default 8. */
  maxSorts?: number;
  /** Most filter rows in the tree. Default 64. */
  maxFilters?: number;
  /** Most filter groups in the tree. Default 16. */
  maxGroups?: number;
  /** Longest text of one filter value, one list entry, or one range bound. Default 1000. */
  maxValueLength?: number;
  /** Most entries of an `isAnyOf` or `isNoneOf` list. Default 1000. */
  maxListLength?: number;
  /** Longest `searchText`. Default 200. */
  maxSearchLength?: number;
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

const DEFAULT_LIMITS = { maxSorts: 8, maxFilters: 64, maxGroups: 16, maxValueLength: 1000, maxListLength: 1000, maxSearchLength: 200 } satisfies Required<ServerSpecLimits>;

type Budget = { filters: number; groups: number };

type Raw = { sorts?: unknown; filters?: unknown; searchText?: unknown; columnId?: unknown; direction?: unknown; join?: unknown; operator?: unknown; value?: unknown };

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
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ServerSpecLimits)[]) {
    const wanted = options.limits?.[key];
    if (wanted !== undefined && Number.isFinite(wanted) && wanted >= 0) limits[key] = wanted;
  }
  const rules = columnRules(options.columns);
  if (!isRecord(input)) throw new ServerSpecError("spec", "must be an object");
  return {
    sorts: parseSorts(input.sorts, rules, limits),
    filters: parseFilters(input.filters, rules, limits),
    searchText: parseSearch(input.searchText, limits),
  };
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
  return { join: node.join, filters: parseNodes(node.filters, `${path}.filters`, depth, rules, limits, budget) };
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
  return value === undefined ? { columnId, operator } : { columnId, operator, value };
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
