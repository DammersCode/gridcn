import type { ColumnLayout, FilterNode, FilterOperator, FilterSpec, SearchOptions, SortSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_FILTER_GROUP_DEPTH, isFilterGroup } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export const MAX_VIEWS = 50;
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
const MAX_COLUMN_ID_LENGTH = 200;
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

/** The live columns a view is checked against; `undefined` accepts every id (structure only). */
export type ViewColumns = ReadonlyMap<string, { sortable?: boolean; filterable?: boolean }>;

export type ViewFileResult = { ok: true; name: string; state: DataGridViewState; dropped: number } | { ok: false; reason: "too-large" | "invalid" };

const FILTER_OPERATORS: ReadonlySet<string> = new Set([
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
] satisfies FilterOperator[]);

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

function sortKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** A string that is equal for two states that restore the same view. */
export function viewStateKey(state: DataGridViewState): string {
  const captured = captureViewState(state);
  captured.columnLayout.hidden.sort();
  return JSON.stringify(captured, sortKeys);
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

function acceptsColumnId(id: unknown, columns: ViewColumns | undefined): id is string {
  if (typeof id !== "string" || id === "" || id.length > MAX_COLUMN_ID_LENGTH || id === "__proto__") return false;
  return columns === undefined || columns.has(id);
}

function sanitizeSorts(raw: unknown, columns: ViewColumns | undefined, tally: { dropped: number }): SortSpec[] {
  if (!Array.isArray(raw)) return [];
  const sorts: SortSpec[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_LIST_ENTRIES)) {
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

function sanitizeFilterValue(operator: string, raw: unknown): { ok: true; value: FilterSpec["value"] } | { ok: false } {
  const text = (v: unknown): v is string => typeof v === "string" && v.length <= MAX_TEXT_LENGTH;
  if (operator === "empty" || operator === "notEmpty") return { ok: true, value: undefined };
  if (operator === "isBetween") return Array.isArray(raw) && raw.length === 2 && text(raw[0]) && text(raw[1]) ? { ok: true, value: [raw[0], raw[1]] } : { ok: false };
  if (operator === "isAnyOf" || operator === "isNoneOf") {
    if (!Array.isArray(raw) || !raw.every(text)) return { ok: false };
    // a truncated exclusion list would match more rows than the view meant
    if (raw.length > MAX_LIST_ENTRIES) return operator === "isNoneOf" ? { ok: false } : { ok: true, value: raw.slice(0, MAX_LIST_ENTRIES) };
    return { ok: true, value: [...raw] };
  }
  return text(raw) ? { ok: true, value: raw } : { ok: false };
}

function sanitizeFilterNodes(raw: unknown, depth: number, columns: ViewColumns | undefined, budget: FilterBudget, tally: { dropped: number }): FilterNode[] {
  if (!Array.isArray(raw)) return [];
  const out: FilterNode[] = [];
  for (const item of raw.slice(0, MAX_FILTERS * 4)) {
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
    const value = typeof operator === "string" && FILTER_OPERATORS.has(operator) ? sanitizeFilterValue(operator, entry.value) : ({ ok: false } as const);
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

function sanitizeIdList(raw: unknown, columns: ViewColumns | undefined, tally: { dropped: number }): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const id of raw.slice(0, MAX_LAYOUT_ENTRIES)) {
    if (acceptsColumnId(id, columns) && !seen.has(id)) seen.add(id);
    else tally.dropped++;
  }
  return [...seen];
}

function sanitizeLayout(raw: unknown, columns: ViewColumns | undefined, tally: { dropped: number }): ColumnLayout {
  const layout = asRecord<RawLayout>(raw) ?? {};
  const widths: [string, number][] = [];
  const pins: [string, "left" | "right"][] = [];
  const widthEntries = Object.entries(asRecord<Record<string, unknown>>(layout.widths) ?? {}).slice(0, MAX_LAYOUT_ENTRIES);
  for (const [id, width] of widthEntries) {
    if (acceptsColumnId(id, columns) && typeof width === "number" && Number.isFinite(width) && width > 0 && width <= MAX_COLUMN_WIDTH) widths.push([id, width]);
    else tally.dropped++;
  }
  const pinEntries = Object.entries(asRecord<Record<string, unknown>>(layout.pins) ?? {}).slice(0, MAX_LAYOUT_ENTRIES);
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
 * bounded. `dropped` counts every rejected entry so the caller can tell the user.
 */
export function sanitizeViewState(raw: unknown, columns: ViewColumns | undefined): { state: DataGridViewState; dropped: number } {
  const source = asRecord<RawState>(raw);
  if (!source) return { state: emptyViewState(), dropped: 0 };
  const tally = { dropped: 0 };
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

/** Reads a stored document; anything unreadable becomes an empty document. Column ids are not checked here: a view keeps the columns that return later. */
export function parseViewDocument(raw: unknown): DataGridViewsDocument {
  const source = asRecord<RawDocument>(raw);
  if (!source || source.version !== 1 || !Array.isArray(source.views)) return emptyViewsDocument();
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
    views.push({ id, name, state: sanitizeViewState(entry?.state, undefined).state });
  }
  const defaultViewId = typeof source.defaultViewId === "string" && ids.has(source.defaultViewId) ? source.defaultViewId : null;
  return { version: 1, defaultViewId, views };
}

/** The text `exportView` returns and `importView` reads. */
export function serializeViewFile(view: Pick<DataGridView, "name" | "state">): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, name: view.name, state: view.state }, null, 2);
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
  const { state, dropped } = sanitizeViewState(file.state, columns);
  return { ok: true, name: cleanViewName(file.name), state, dropped };
}
