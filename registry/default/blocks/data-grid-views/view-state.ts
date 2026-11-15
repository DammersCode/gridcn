import type { ColumnLayout, BuiltInFilterOperator, FilterNode, FilterOperator, FilterOperatorInput, FilterSpec, SearchOptions, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_FILTER_GROUP_DEPTH, countFilterSpecs, isFilterGroup, pruneFilterSpecs } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export const MAX_VIEWS = 50;
/** Largest stored document, in characters; a save over it is refused so the next load can read it. */
export const MAX_DOCUMENT_LENGTH = 1_000_000;
export const MAX_VIEW_NAME_LENGTH = 80;
/** Largest view file `parseViewFile` reads, in characters. */
export const MAX_VIEW_FILE_LENGTH = 100_000;
const MAX_SORTS = 16;
const MAX_FILTERS = 64;
const MAX_FILTER_GROUPS = 16;
const MAX_LIST_ENTRIES = 1000;
const MAX_TEXT_LENGTH = 1000;
const MAX_SEARCH_LENGTH = 500;
const MAX_LAYOUT_ENTRIES = 1000;
const MAX_COLUMN_WIDTH = 10_000;
const MAX_VIEW_ID_LENGTH = 64;
const FILE_FORMAT = "gridcn-view";

/** The grid state a saved view restores. */
export type DataGridViewState = {
  sorts: SortSpec[];
  filters: FilterNode[];
  searchText: string;
  searchOptions: Required<SearchOptions>;
  columnLayout: ColumnLayout;
};

export type DataGridView = { id: string; name: string; state: DataGridViewState };

/** What a storage adapter persists. */
export type DataGridViewsDocument = { version: 1; views: DataGridView[]; defaultViewId: string | null };

/** The live columns a view is checked against; `undefined` checks structure and limits only, so any column id passes. */
export type ViewColumns = ReadonlyMap<string, { sortable?: boolean; filterable?: boolean; operators?: ReadonlyMap<string, FilterOperatorInput> }>;

export type ViewFileResult = { ok: true; name: string; state: DataGridViewState; dropped: number } | { ok: false; reason: "too-large" | "invalid" };

const OPERATORS = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "empty",
  "notEmpty",
  "gt",
  "gte",
  "lt",
  "lte",
  "isBetween",
  "isAnyOf",
  "isNoneOf",
] as const satisfies readonly BuiltInFilterOperator[];

/** Fails to compile when a built-in operator is missing from `OPERATORS`, which would drop saved filters silently. */
const operatorsAreExhaustive: Exclude<BuiltInFilterOperator, (typeof OPERATORS)[number]> extends never ? true : never = true;
void operatorsAreExhaustive;

const FILTER_OPERATOR_IDS: ReadonlySet<string> = new Set(OPERATORS);

export function emptyViewState(): DataGridViewState {
  return { sorts: [], filters: [], searchText: "", searchOptions: { matchCase: false, wholeCell: false }, columnLayout: { widths: {}, order: [], pins: {}, hidden: [] } };
}

export function emptyViewsDocument(): DataGridViewsDocument {
  return { version: 1, defaultViewId: null, views: [] };
}

function stripFilterIds(nodes: readonly FilterNode[], depth: number): FilterNode[] {
  const out: FilterNode[] = [];
  for (const node of nodes) {
    if (isFilterGroup(node)) {
      if (depth < MAX_FILTER_GROUP_DEPTH) out.push({ join: node.join, filters: stripFilterIds(node.filters, depth + 1) });
    } else {
      const { filterId: _filterId, ...spec } = node;
      out.push(spec);
    }
  }
  return out;
}

/** Copies grid state into a view state without the transient `filterId`s. */
export function captureViewState(source: DataGridViewState): DataGridViewState {
  const { widths, order, pins, hidden } = source.columnLayout;
  return {
    sorts: source.sorts.map((s) => ({ columnId: s.columnId, direction: s.direction })),
    filters: stripFilterIds(source.filters, 0),
    searchText: source.searchText,
    searchOptions: { matchCase: source.searchOptions.matchCase, wholeCell: source.searchOptions.wholeCell },
    columnLayout: { widths: { ...widths }, order: [...order], pins: { ...pins }, hidden: [...hidden] },
  };
}

function withoutUnusedValues(nodes: readonly FilterNode[]): FilterNode[] {
  return nodes.map((node) => {
    if (isFilterGroup(node)) return { join: node.join, filters: withoutUnusedValues(node.filters) };
    return node.operator === "empty" || node.operator === "notEmpty" ? { columnId: node.columnId, operator: node.operator } : node;
  });
}

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export type ViewStatePart = "sorts" | "filters" | "search" | "layout";

/** The part of a view state that a view limit cuts. */
export type OverLimitPart = ViewStatePart;

/** One string per part of a state; equal strings mean the part restores the same grid. */
export function viewPartKeys(state: DataGridViewState): Record<ViewStatePart, string> {
  // lossless except for the one thing storage drops: the unused `value` of `empty` and `notEmpty`
  const captured = captureViewState(state);
  captured.filters = withoutUnusedValues(captured.filters);
  captured.columnLayout.hidden.sort();
  return {
    sorts: JSON.stringify(captured.sorts),
    filters: JSON.stringify(captured.filters, sortKeys),
    search: JSON.stringify([captured.searchText, captured.searchOptions]),
    layout: JSON.stringify(captured.columnLayout, sortKeys),
  };
}

/** A string that is equal for two states that restore the same view. */
export function viewStateKey(state: DataGridViewState): string {
  return Object.values(viewPartKeys(state)).join("|");
}

/** The part of `state` that a view limit would cut or drop, or `false` when none. A column the grid lacks is not a limit. Layout covers a width over 10,000 px and a list over 1,000 entries. */
export function overLimitPart(state: DataGridViewState): OverLimitPart | false {
  const kept = viewPartKeys(sanitizeViewState(state).state);
  const wanted = viewPartKeys(state);
  return (Object.keys(wanted) as ViewStatePart[]).find((part) => kept[part] !== wanted[part]) ?? false;
}

/** The state in the form that reloads unchanged, or `null` when a view limit would cut or drop part of it. */
export function savableViewState(state: DataGridViewState): DataGridViewState | null {
  const clean = sanitizeViewState(state).state;
  return viewStateKey(clean) === viewStateKey(state) ? clean : null;
}

type RawSort = { columnId?: unknown; direction?: unknown };
type RawFilter = { columnId?: unknown; operator?: unknown; value?: unknown; join?: unknown; filters?: unknown };
type RawLayout = { widths?: unknown; order?: unknown; pins?: unknown; hidden?: unknown };
type RawState = { sorts?: unknown; filters?: unknown; searchText?: unknown; searchOptions?: unknown; columnLayout?: unknown };
type RawSearchOptions = { matchCase?: unknown; wholeCell?: unknown };
type RawView = { id?: unknown; name?: unknown; state?: unknown };
type RawDocument = { version?: unknown; views?: unknown; defaultViewId?: unknown };
type RawFile = { format?: unknown; version?: unknown; name?: unknown; state?: unknown };

/** Narrows untrusted JSON to a plain object whose fields are all `unknown`. */
function asRecord<T extends object>(value: unknown): T | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as T) : undefined;
}

/** Counts the entries beyond `cap` as dropped, then returns the first `cap`. */
function boundedEntries<T>(entries: readonly T[], cap: number, tally: Tally): readonly T[] {
  if (entries.length > cap) tally.dropped += entries.length - cap;
  return entries.slice(0, cap);
}

type Tally = { dropped: number };

/** An id passes when it is a usable key and, given a column set, names a live column. */
function acceptsColumnId(id: unknown, columns: ViewColumns | undefined): id is string {
  if (typeof id !== "string" || id === "" || id === "__proto__") return false;
  return columns ? columns.has(id) : true;
}

function sanitizeSorts(raw: unknown, columns: ViewColumns | undefined, tally: Tally): SortSpec[] {
  if (!Array.isArray(raw)) return [];
  const sorts: SortSpec[] = [];
  const seen = new Set<string>();
  for (const item of boundedEntries(raw, MAX_LIST_ENTRIES, tally)) {
    const entry = asRecord<RawSort>(item);
    const columnId = entry?.columnId;
    const direction = entry?.direction;
    if (!acceptsColumnId(columnId, columns) || columns?.get(columnId)?.sortable === false || (direction !== "asc" && direction !== "desc") || seen.has(columnId) || sorts.length >= MAX_SORTS) {
      tally.dropped++;
      continue;
    }
    seen.add(columnId);
    sorts.push({ columnId, direction });
  }
  return sorts;
}

type FilterBudget = { leaves: number; groups: number };

function sanitizeFilterValue(operator: string, raw: unknown, tally: Tally): { ok: true; value: FilterSpec["value"] } | { ok: false } {
  const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT_LENGTH;
  if (operator === "empty" || operator === "notEmpty") return { ok: true, value: undefined };
  if (operator === "isBetween") return Array.isArray(raw) && raw.length === 2 && text(raw[0]) && text(raw[1]) ? { ok: true, value: [raw[0], raw[1]] } : { ok: false };
  if (operator === "isAnyOf" || operator === "isNoneOf") {
    if (!Array.isArray(raw) || !raw.every(text)) return { ok: false };
    // a truncated exclusion list would match more rows than the view meant
    if (raw.length > MAX_LIST_ENTRIES) {
      if (operator === "isNoneOf") return { ok: false };
      tally.dropped += raw.length - MAX_LIST_ENTRIES;
      return { ok: true, value: raw.slice(0, MAX_LIST_ENTRIES) };
    }
    return { ok: true, value: [...raw] };
  }
  return text(raw) ? { ok: true, value: raw } : { ok: false };
}

function sanitizeCustomValue(input: FilterOperatorInput | "any", raw: unknown): { ok: true; value: FilterSpec["value"] } | { ok: false } {
  const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT_LENGTH;
  if (input === "none") return { ok: true, value: undefined };
  if (input === "single") return text(raw) ? { ok: true, value: raw } : { ok: false };
  if (input === "range") return Array.isArray(raw) && raw.length === 2 && text(raw[0]) && text(raw[1]) ? { ok: true, value: [raw[0], raw[1]] } : { ok: false };
  if (input === "list" || Array.isArray(raw)) {
    if (!Array.isArray(raw) || !raw.every(text)) return { ok: false };
    if (raw.length > MAX_LIST_ENTRIES) return { ok: false };
    return { ok: true, value: [...raw] };
  }
  if (raw === undefined) return { ok: true, value: undefined };
  return text(raw) ? { ok: true, value: raw } : { ok: false };
}

function sanitizeOperatorValue(operator: unknown, columnId: unknown, raw: unknown, columns: ViewColumns | undefined, tally: Tally): { ok: true; value: FilterSpec["value"] } | { ok: false } {
  if (typeof operator !== "string") return { ok: false };
  if (FILTER_OPERATOR_IDS.has(operator)) return sanitizeFilterValue(operator, raw, tally);
  if (operator.length === 0) return { ok: false };
  // a live-grid snapshot has no column map; a column map accepts only operators the column registers
  if (!columns) return sanitizeCustomValue("any", raw);
  const input = typeof columnId === "string" ? columns.get(columnId)?.operators?.get(operator) : undefined;
  return input ? sanitizeCustomValue(input, raw) : { ok: false };
}

function sanitizeFilterNodes(raw: unknown, depth: number, columns: ViewColumns | undefined, budget: FilterBudget, tally: Tally): FilterNode[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterNode[] = [];
  for (const item of boundedEntries(raw, MAX_FILTERS * 4, tally)) {
    const entry = asRecord<RawFilter>(item);
    if (!entry) {
      tally.dropped++;
      continue;
    }
    if (Array.isArray(entry.filters)) {
      const join = entry.join;
      if ((join !== "and" && join !== "or") || depth >= MAX_FILTER_GROUP_DEPTH || budget.groups >= MAX_FILTER_GROUPS) {
        tally.dropped++;
        continue;
      }
      budget.groups++;
      const children = sanitizeFilterNodes(entry.filters, depth + 1, columns, budget, tally);
      if (children.length === 0) tally.dropped++;
      else out.push({ join, filters: children });
      continue;
    }
    const { columnId, operator } = entry;
    const value = sanitizeOperatorValue(operator, columnId, entry.value, columns, tally);
    if (!acceptsColumnId(columnId, columns) || columns?.get(columnId)?.filterable === false || !value.ok || budget.leaves >= MAX_FILTERS) {
      tally.dropped++;
      continue;
    }
    budget.leaves++;
    const spec: FilterSpec = { columnId, operator: operator as FilterOperator };
    if (value.value !== undefined) spec.value = value.value;
    out.push(spec);
  }
  return out;
}

function sanitizeIdList(raw: unknown, columns: ViewColumns | undefined, tally: Tally): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const id of boundedEntries(raw, MAX_LAYOUT_ENTRIES, tally)) {
    if (acceptsColumnId(id, columns) && !seen.has(id)) seen.add(id);
    else tally.dropped++;
  }
  return [...seen];
}

function sanitizeLayout(raw: unknown, columns: ViewColumns | undefined, tally: Tally): ColumnLayout {
  const layout = asRecord<RawLayout>(raw) ?? {};
  const widths: [string, number][] = [];
  const pins: [string, "left" | "right"][] = [];
  const widthEntries = boundedEntries(Object.entries(asRecord<Record<string, unknown>>(layout.widths) ?? {}), MAX_LAYOUT_ENTRIES, tally);
  for (const [id, width] of widthEntries) {
    if (acceptsColumnId(id, columns) && typeof width === "number" && Number.isFinite(width) && width > 0 && width <= MAX_COLUMN_WIDTH) widths.push([id, width]);
    else tally.dropped++;
  }
  const pinEntries = boundedEntries(Object.entries(asRecord<Record<string, unknown>>(layout.pins) ?? {}), MAX_LAYOUT_ENTRIES, tally);
  for (const [id, side] of pinEntries) {
    if (acceptsColumnId(id, columns) && (side === "left" || side === "right")) pins.push([id, side]);
    else tally.dropped++;
  }
  return {
    widths: Object.fromEntries(widths),
    order: sanitizeIdList(layout.order, columns, tally),
    pins: Object.fromEntries(pins),
    hidden: sanitizeIdList(layout.hidden, columns, tally),
  };
}

/**
 * Checks untrusted view state: unknown shapes, operators, and columns drop, lists and strings are
 * bounded. `dropped` counts every rejected or cut entry so the caller can tell the user; text cut to its limit is not counted.
 */
export function sanitizeViewState(raw: unknown, columns?: ViewColumns): { state: DataGridViewState; dropped: number } {
  const source = asRecord<RawState>(raw);
  if (!source) return { state: emptyViewState(), dropped: 0 };
  const tally: Tally = { dropped: 0 };
  const options = asRecord<RawSearchOptions>(source.searchOptions) ?? {};
  return {
    state: {
      sorts: sanitizeSorts(source.sorts, columns, tally),
      filters: sanitizeFilterNodes(source.filters, 0, columns, { leaves: 0, groups: 0 }, tally),
      searchText: typeof source.searchText === "string" ? source.searchText.slice(0, MAX_SEARCH_LENGTH) : "",
      searchOptions: { matchCase: options.matchCase === true, wholeCell: options.wholeCell === true },
      columnLayout: sanitizeLayout(source.columnLayout, columns, tally),
    },
    dropped: tally.dropped,
  };
}

export function cleanViewName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_VIEW_NAME_LENGTH) : "";
}

/** Reads a stored document, or `null` when `raw` is not a version 1 document. A view keeps the columns that return later, so ids are not checked against the live columns. */
export function parseViewDocument(raw: unknown): DataGridViewsDocument | null {
  const source = asRecord<RawDocument>(raw);
  if (!source || source.version !== 1 || !Array.isArray(source.views)) return null;
  const views: DataGridView[] = [];
  const ids = new Set<string>();
  for (const item of source.views.slice(0, MAX_VIEWS * 2)) {
    if (views.length >= MAX_VIEWS) break;
    const entry = asRecord<RawView>(item);
    const id = entry?.id;
    if (typeof id !== "string" || id === "" || id.length > MAX_VIEW_ID_LENGTH || ids.has(id)) continue;
    const name = cleanViewName(entry?.name);
    if (name === "") continue;
    ids.add(id);
    views.push({ id, name, state: sanitizeViewState(entry?.state).state });
  }
  const defaultViewId = typeof source.defaultViewId === "string" && ids.has(source.defaultViewId) ? source.defaultViewId : null;
  return { version: 1, defaultViewId, views };
}

/** The text `exportView` returns and `importView` reads. */
export function serializeViewFile(view: Pick<DataGridView, "name" | "state">): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, name: view.name, state: view.state });
}

export function parseViewFile(text: string, columns: ViewColumns): ViewFileResult {
  if (text.length > MAX_VIEW_FILE_LENGTH) return { ok: false, reason: "too-large" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const file = asRecord<RawFile>(raw);
  if (!file || file.format !== FILE_FORMAT || file.version !== 1 || !asRecord(file.state)) return { ok: false, reason: "invalid" };
  const sanitized = sanitizeViewState(file.state, columns);
  const hidden = new Set(sanitized.state.columnLayout.hidden);
  const sorts = sanitized.state.sorts.filter((s) => !hidden.has(s.columnId));
  const filters = pruneFilterSpecs(sanitized.state.filters, (spec) => !hidden.has(spec.columnId));
  const dropped = sanitized.dropped + (sanitized.state.sorts.length - sorts.length) + (countFilterSpecs(sanitized.state.filters) - countFilterSpecs(filters));
  return { ok: true, name: cleanViewName(file.name), state: { ...sanitized.state, sorts, filters }, dropped };
}
