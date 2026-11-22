import type { ColumnLayout, ColumnPin, BuiltInFilterOperator, FilterNode, FilterOperator, FilterOperatorInput, FilterSpec, SearchOptions, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_FILTER_GROUP_DEPTH, MAX_PIVOT_COLUMNS, MAX_SPEC_SEARCH_LENGTH, MAX_GROUP_LEVELS, MAX_SPEC_SORTS, countFilterSpecs, isFilterGroup, pruneFilterSpecs } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export const MAX_VIEWS = 50;
/** Largest stored document, in characters; a save over it is refused so the next load can read it. */
export const MAX_DOCUMENT_LENGTH = 1_000_000;
export const MAX_VIEW_NAME_LENGTH = 80;
/** Largest view file `parseViewFile` reads, in characters. */
export const MAX_VIEW_FILE_LENGTH = 100_000;
const MAX_SORTS = MAX_SPEC_SORTS;
const LIMIT_PARTS = ["sorts", "filters", "search", "layout"] as const;
const MAX_FILTERS = 64;
const MAX_FILTER_GROUPS = 16;
const MAX_LIST_ENTRIES = 1000;
const MAX_TEXT_LENGTH = 1000;
const MAX_LAYOUT_ENTRIES = 1000;
const MAX_COLUMN_WIDTH = 10_000;
const MAX_VIEW_ID_LENGTH = 64;
const MAX_GENERATED_ID_LENGTH = 2048;
const GENERATED_ID_PREFIX = "__pivot:";
const FILE_FORMAT = "gridcn-view";

/** The grid state a saved view restores. `groupBy` holds the group columns, outermost first; which groups are open is not saved. */
export type DataGridViewState = {
  sorts: SortSpec[];
  groupBy: string[];
  filters: FilterNode[];
  /** How the top-level `filters` combine. A capture stores it only as `"or"`; absent means `"and"`. */
  filterJoin?: "and" | "or";
  searchText: string;
  searchOptions: Required<SearchOptions>;
  columnLayout: ColumnLayout;
  /** The pivot column, or `null` for no pivot. It needs `groupBy` and is never a `groupBy` column. A view without the field leaves the pivot as it is. */
  pivotColumnId?: string | null;
  /** Widths of generated columns by id, at most 200. A width waits until its column is in the held set. Present only with `pivotColumnId`. */
  pivotWidths?: Record<string, number>;
};

export type DataGridView = { id: string; name: string; state: DataGridViewState };

/** What a storage adapter persists. */
export type DataGridViewsDocument = { version: 1; views: DataGridView[]; defaultViewId: string | null };

/** The live columns a view is checked against; `undefined` checks structure and limits only, so any column id passes. */
export type ViewColumns = ReadonlyMap<string, { sortable?: boolean; filterable?: boolean; groupable?: boolean; operators?: ReadonlyMap<string, FilterOperatorInput>; choices?: () => ReadonlySet<string> | undefined }>;

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
  return { sorts: [], groupBy: [], filters: [], searchText: "", searchOptions: { matchCase: false, wholeCell: false }, columnLayout: { widths: {}, order: [], pins: {}, hidden: [] } };
}

export function emptyViewsDocument(): DataGridViewsDocument {
  return { version: 1, defaultViewId: null, views: [] };
}

function stripFilterIds(nodes: readonly FilterNode[], depth: number): FilterNode[] {
  const out: FilterNode[] = [];
  for (const node of nodes) {
    if (isFilterGroup(node)) {
      if (depth < MAX_FILTER_GROUP_DEPTH) out.push({ join: node.join, ...(node.not === true ? { not: true } : null), filters: stripFilterIds(node.filters, depth + 1) });
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
    groupBy: [...source.groupBy],
    filters: stripFilterIds(source.filters, 0),
    ...(source.filterJoin === "or" ? { filterJoin: "or" as const } : null),
    searchText: source.searchText,
    searchOptions: { matchCase: source.searchOptions.matchCase, wholeCell: source.searchOptions.wholeCell },
    columnLayout: { widths: { ...widths }, order: [...order], pins: { ...pins }, hidden: [...hidden] },
    ...(source.pivotColumnId !== undefined ? { pivotColumnId: source.pivotColumnId } : null),
    ...(typeof source.pivotColumnId === "string" && source.pivotWidths && Object.keys(source.pivotWidths).length > 0 ? { pivotWidths: { ...source.pivotWidths } } : null),
  };
}

function withoutUnusedValues(nodes: readonly FilterNode[]): FilterNode[] {
  return nodes.map((node) => {
    if (isFilterGroup(node)) return { join: node.join, ...(node.not === true ? { not: true } : null), filters: withoutUnusedValues(node.filters) };
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
export function viewPartKeys(state: DataGridViewState): Record<ViewStatePart | "group" | "pivot" | "pivotWidths", string> {
  // lossless except for the one thing storage drops: the unused `value` of `empty` and `notEmpty`
  const captured = captureViewState(state);
  captured.filters = withoutUnusedValues(captured.filters);
  captured.columnLayout.hidden.sort();
  return {
    sorts: JSON.stringify(captured.sorts),
    group: JSON.stringify(captured.groupBy),
    filters: JSON.stringify(captured.filters, sortKeys) + (captured.filterJoin === "or" ? "|or" : ""),
    search: JSON.stringify([captured.searchText, captured.searchOptions]),
    layout: JSON.stringify(captured.columnLayout, sortKeys),
    pivot: captured.pivotColumnId ?? "",
    pivotWidths: JSON.stringify(captured.pivotWidths ?? {}, sortKeys),
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
  return LIMIT_PARTS.find((part) => kept[part] !== wanted[part]) ?? false;
}

/** The state in the form that reloads unchanged, or `null` when a view limit would cut or drop part of it. */
export function savableViewState(state: DataGridViewState): DataGridViewState | null {
  const clean = sanitizeViewState(state).state;
  return viewStateKey(clean) === viewStateKey(state) ? clean : null;
}

type RawSort = { columnId?: unknown; direction?: unknown };
type RawFilter = { columnId?: unknown; operator?: unknown; value?: unknown; join?: unknown; not?: unknown; filters?: unknown };
type RawLayout = { widths?: unknown; order?: unknown; pins?: unknown; hidden?: unknown };
type RawState = { sorts?: unknown; groupBy?: unknown; filters?: unknown; filterJoin?: unknown; searchText?: unknown; searchOptions?: unknown; columnLayout?: unknown; pivotColumnId?: unknown; pivotWidths?: unknown };
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
  if (typeof id !== "string" || id === "") return false;
  return columns ? columns.has(id) : true;
}

/** Ids of live groupable columns, once each, at most {@link MAX_GROUP_LEVELS}; a longer list is cut and counted. */
function sanitizeGroupBy(raw: unknown, columns: ViewColumns | undefined, tally: Tally): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const id of boundedEntries(raw, MAX_LIST_ENTRIES, tally)) {
    if (!acceptsColumnId(id, columns) || columns?.get(id)?.groupable === false || ids.includes(id) || ids.length >= MAX_GROUP_LEVELS) tally.dropped++;
    else ids.push(id);
  }
  return ids;
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
  if (raw === undefined) return { ok: true, value: undefined };
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

/** The blank entry and the list entries whose lowercased text `choices` holds; `null` when none of a non-empty list is left. */
function knownChoices(operator: unknown, value: FilterSpec["value"], readChoices: (() => ReadonlySet<string> | undefined) | undefined, tally: Tally): FilterSpec["value"] | null {
  if ((operator !== "isAnyOf" && operator !== "isNoneOf") || !Array.isArray(value)) return value;
  const choices = readChoices?.();
  if (!choices) return value;
  const kept = value.filter((entry) => entry === "" || choices.has(entry.toLowerCase()));
  tally.dropped += value.length - kept.length;
  return kept.length === 0 && value.length > 0 ? null : kept;
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
      const droppedBefore = tally.dropped;
      const children = sanitizeFilterNodes(entry.filters, depth + 1, columns, budget, tally);
      const negated = entry.not === true;
      // a negated group missing a term would match different rows, so it goes whole
      if (children.length === 0 || (negated && tally.dropped > droppedBefore)) tally.dropped++;
      else out.push(negated ? { join, not: true, filters: children } : { join, filters: children });
      continue;
    }
    const { columnId, operator } = entry;
    const value = sanitizeOperatorValue(operator, columnId, entry.value, columns, tally);
    if (!acceptsColumnId(columnId, columns) || columns?.get(columnId)?.filterable === false || !value.ok || budget.leaves >= MAX_FILTERS) {
      tally.dropped++;
      continue;
    }
    const known = knownChoices(operator, value.value, columns?.get(columnId)?.choices, tally);
    if (known === null) continue;
    budget.leaves++;
    const spec: FilterSpec = { columnId, operator: operator as FilterOperator };
    if (known !== undefined) spec.value = known;
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

const acceptsWidth = (width: unknown): width is number => typeof width === "number" && Number.isFinite(width) && width > 0 && width <= MAX_COLUMN_WIDTH;

function sanitizeLayout(raw: unknown, columns: ViewColumns | undefined, tally: Tally): ColumnLayout {
  const layout = asRecord<RawLayout>(raw) ?? {};
  const widths: [string, number][] = [];
  const pins: [string, ColumnPin][] = [];
  const widthEntries = boundedEntries(Object.entries(asRecord<Record<string, unknown>>(layout.widths) ?? {}), MAX_LAYOUT_ENTRIES, tally);
  for (const [id, width] of widthEntries) {
    if (acceptsColumnId(id, columns) && acceptsWidth(width)) widths.push([id, width]);
    else tally.dropped++;
  }
  const pinEntries = boundedEntries(Object.entries(asRecord<Record<string, unknown>>(layout.pins) ?? {}), MAX_LAYOUT_ENTRIES, tally);
  for (const [id, side] of pinEntries) {
    const pin = side === "start" || side === "left" ? "start" : side === "end" || side === "right" ? "end" : null;
    if (acceptsColumnId(id, columns) && pin) pins.push([id, pin]);
    else tally.dropped++;
  }
  return {
    widths: Object.fromEntries(widths),
    order: sanitizeIdList(layout.order, columns, tally),
    pins: Object.fromEntries(pins),
    hidden: sanitizeIdList(layout.hidden, columns, tally),
  };
}

/** The generated widths a view keeps: ids with the generated column prefix and at most 2,048 characters (the longest the grid builds), at most 200 entries. */
export function generatedWidthsOf(raw: unknown, tally: Tally = { dropped: 0 }): Record<string, number> {
  const kept: [string, number][] = [];
  for (const [id, width] of boundedEntries(Object.entries(asRecord<Record<string, unknown>>(raw) ?? {}), MAX_LAYOUT_ENTRIES, tally)) {
    if (kept.length < MAX_PIVOT_COLUMNS && id.startsWith(GENERATED_ID_PREFIX) && id.length <= MAX_GENERATED_ID_LENGTH && acceptsWidth(width)) kept.push([id, width]);
    else tally.dropped++;
  }
  return Object.fromEntries(kept);
}

/**
 * The pivot of a view and its widths. A pivot needs a groupable column outside a non-empty `groupBy`, and reads as `null`
 * without one; without `columns` any id passes. An absent field stays absent.
 */
function sanitizePivot(source: RawState, groupBy: readonly string[], columns: ViewColumns | undefined, tally: Tally): Pick<DataGridViewState, "pivotColumnId" | "pivotWidths"> {
  const id = source.pivotColumnId;
  const widths = generatedWidthsOf(source.pivotWidths, tally);
  const count = Object.keys(widths).length;
  if (id !== undefined && id !== null && acceptsColumnId(id, columns) && columns?.get(id)?.groupable !== false && groupBy.length > 0 && !groupBy.includes(id)) {
    return count > 0 ? { pivotColumnId: id, pivotWidths: widths } : { pivotColumnId: id };
  }
  tally.dropped += (id === undefined || id === null ? 0 : 1) + count;
  return id === undefined ? {} : { pivotColumnId: null };
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
  const groupBy = sanitizeGroupBy(source.groupBy, columns, tally);
  return {
    state: {
      sorts: sanitizeSorts(source.sorts, columns, tally),
      groupBy,
      filters: sanitizeFilterNodes(source.filters, 0, columns, { leaves: 0, groups: 0 }, tally),
      ...(source.filterJoin === "or" ? { filterJoin: "or" as const } : null),
      searchText: typeof source.searchText === "string" ? source.searchText.slice(0, MAX_SPEC_SEARCH_LENGTH) : "",
      searchOptions: { matchCase: options.matchCase === true, wholeCell: options.wholeCell === true },
      columnLayout: sanitizeLayout(source.columnLayout, columns, tally),
      ...sanitizePivot(source, groupBy, columns, tally),
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
  const groupBy = sanitized.state.groupBy.filter((id) => !hidden.has(id));
  const filters = pruneFilterSpecs(sanitized.state.filters, (spec) => !hidden.has(spec.columnId), true);
  const { pivotColumnId, pivotWidths, ...rest } = sanitized.state;
  // a shared file applies no spec on a column it hides, so its pivot drops like its sorts, groups, and filters
  const dropsPivot = typeof pivotColumnId === "string" && (hidden.has(pivotColumnId) || groupBy.length === 0);
  const pivotDropped = dropsPivot ? 1 + Object.keys(pivotWidths ?? {}).length : 0;
  const dropped = sanitized.dropped + (sanitized.state.sorts.length - sorts.length) + (sanitized.state.groupBy.length - groupBy.length) + (countFilterSpecs(sanitized.state.filters) - countFilterSpecs(filters)) + pivotDropped;
  const pivot = pivotColumnId === undefined ? null : dropsPivot ? { pivotColumnId: null } : { pivotColumnId, ...(pivotWidths ? { pivotWidths } : null) };
  return { ok: true, name: cleanViewName(file.name), state: { ...rest, sorts, groupBy, filters, ...pivot }, dropped };
}
