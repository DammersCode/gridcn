import type { FilterNode, FilterOperator, FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { isFilterGroup } from "@/registry/default/blocks/data-grid/data-grid-sdk";

export const MAX_SET_FILTER_ENTRIES = 1000;

type SetOperator = "isAnyOf" | "isNoneOf";

export type SetFilterPlan =
  | { status: "unchanged" }
  | { status: "blocked"; reason: "none-checked" | "too-many" }
  | { status: "apply"; filters: FilterNode[] };

export type SetFilterPlanInput = {
  /** Only the top-level set rows of `columnId` are the header filter's; set rows inside a group belong to the filter menu. */
  filters: readonly FilterNode[];
  columnId: string;
  keys: readonly string[];
  /** Original text per key, written into the filter values; a key without an entry is written as is. */
  texts?: ReadonlyMap<string, string>;
  checked: ReadonlySet<string>;
  allowed: readonly FilterOperator[];
  /** The column's `filter.matchCase`: keys and filter values compare with letter case. Default `false`. */
  matchCase?: boolean;
};

/** The set-filter key of a text: the text itself under `matchCase`, else its lowercase form. */
export const setFilterKey = (text: string, matchCase = false): string => (matchCase ? text : text.toLowerCase());

const isSetFilterOf = (node: FilterNode, columnId: string): node is FilterSpec =>
  !isFilterGroup(node) && node.columnId === columnId && (node.operator === "isAnyOf" || node.operator === "isNoneOf");

const listOf = (filter: FilterSpec): string[] => (Array.isArray(filter.value) ? (filter.value as string[]) : []);

export function checkedKeysFromFilters(filters: readonly FilterNode[], columnId: string, keys: readonly string[], matchCase = false): Set<string> {
  const entries = filters.filter((f): f is FilterSpec => isSetFilterOf(f, columnId)).map((f) => ({ operator: f.operator, values: new Set(listOf(f).map((v) => setFilterKey(v, matchCase))) }));
  const checked = new Set<string>();
  for (const key of keys) {
    if (entries.every((e) => (e.operator === "isAnyOf") === e.values.has(key))) checked.add(key);
  }
  return checked;
}

function chooseOperator(checkedCount: number, uncheckedCount: number, allowed: readonly FilterOperator[], existing: SetOperator | undefined): SetOperator {
  const canAny = allowed.includes("isAnyOf");
  const canNone = allowed.includes("isNoneOf");
  if (!canNone) return "isAnyOf";
  if (!canAny) return "isNoneOf";
  if (checkedCount !== uncheckedCount) return checkedCount < uncheckedCount ? "isAnyOf" : "isNoneOf";
  return existing ?? "isAnyOf";
}

const sameList = (a: readonly string[], b: readonly string[], matchCase: boolean) => {
  const left = new Set(a.map((v) => setFilterKey(v, matchCase)));
  const right = new Set(b.map((v) => setFilterKey(v, matchCase)));
  return left.size === right.size && [...left].every((v) => right.has(v));
};

const outsideValues = (entries: readonly FilterSpec[], known: ReadonlySet<string>, matchCase: boolean): string[] =>
  entries.flatMap(listOf).filter((v) => !known.has(setFilterKey(v, matchCase)));

/** The entry that keeps hiding values outside the list when every listed value is checked, or none. */
function keepOutsideValues(existing: readonly FilterSpec[], columnId: string, keys: readonly string[], known: ReadonlySet<string>, matchCase: boolean): FilterSpec | undefined {
  const anyOutside = outsideValues(existing.filter((f) => f.operator === "isAnyOf"), known, matchCase);
  if (anyOutside.length > 0) return { columnId, operator: "isAnyOf", value: [...keys, ...anyOutside] };
  const noneOutside = outsideValues(existing.filter((f) => f.operator === "isNoneOf"), known, matchCase);
  return noneOutside.length > 0 ? { columnId, operator: "isNoneOf", value: noneOutside } : undefined;
}

/** Replaces the column's set entries with `entry` at the first one's position (or appends it); `undefined` removes them. */
function placeSetEntry(filters: readonly FilterNode[], existing: readonly FilterSpec[], entry: FilterSpec | undefined, matchCase: boolean): SetFilterPlan {
  if (!entry) return existing.length === 0 ? { status: "unchanged" } : { status: "apply", filters: filters.filter((f) => !existing.includes(f as FilterSpec)) };
  if (existing.length === 1 && existing[0]!.operator === entry.operator && sameList(listOf(existing[0]!), entry.value as string[], matchCase)) return { status: "unchanged" };

  const next: FilterNode[] = [];
  let placed = false;
  for (const filter of filters) {
    if (!existing.includes(filter as FilterSpec)) next.push(filter);
    else if (!placed) {
      next.push(entry);
      placed = true;
    }
  }
  if (!placed) next.push(entry);
  return { status: "apply", filters: next };
}

/**
 * Plans the `setFilters` write for one column's set filter: replaces every `isAnyOf`/`isNoneOf`
 * entry of the column with the shorter of the checked and unchecked lists, using only operators
 * the column allows, and keeps every other filter.
 */
export function planSetFilter(input: SetFilterPlanInput): SetFilterPlan {
  const { filters, columnId, keys, checked, allowed, matchCase = false } = input;
  const textOf = (key: string) => input.texts?.get(key) ?? key;
  const existing = filters.filter((f): f is FilterSpec => isSetFilterOf(f, columnId));
  const checkedKeys = keys.filter((key) => checked.has(key));
  const uncheckedKeys = keys.filter((key) => !checked.has(key));

  if (checkedKeys.length === 0) return { status: "blocked", reason: "none-checked" };

  const known = new Set(keys);
  let entry: FilterSpec | undefined;
  if (uncheckedKeys.length === 0) {
    entry = keepOutsideValues(existing, columnId, keys.map(textOf), known, matchCase);
    if (entry && entry.value!.length > MAX_SET_FILTER_ENTRIES) return { status: "blocked", reason: "too-many" };
  } else {
    const operator = chooseOperator(checkedKeys.length, uncheckedKeys.length, allowed, existing[0]?.operator as SetOperator | undefined);
    const outside = existing.length === 1 && existing[0]!.operator === operator ? outsideValues(existing, known, matchCase) : [];
    const value = [...(operator === "isAnyOf" ? checkedKeys : uncheckedKeys).map(textOf), ...outside];
    if (value.length > MAX_SET_FILTER_ENTRIES) return { status: "blocked", reason: "too-many" };
    entry = { columnId, operator, value };
  }

  return placeSetEntry(filters, existing, entry, matchCase);
}

export type ServerSetFilterPlanInput = {
  filters: readonly FilterNode[];
  columnId: string;
  /** Every value a server list showed so far, by key to original text; the full value set is unknown. */
  known: ReadonlyMap<string, string>;
  checked: ReadonlySet<string>;
  allowed: readonly FilterOperator[];
  matchCase?: boolean;
};

/**
 * Plans the write for a set filter over a server value list. The list may be partial, so the entry
 * lists the checked texts (`isAnyOf`), or the unchecked texts when the column already holds one
 * `isNoneOf` entry. Existing values the lists never showed stay.
 */
export function planServerSetFilter(input: ServerSetFilterPlanInput): SetFilterPlan {
  const { filters, columnId, known, checked, allowed, matchCase = false } = input;
  const existing = filters.filter((f): f is FilterSpec => isSetFilterOf(f, columnId));
  const operator: SetOperator = existing.length === 1 && existing[0]!.operator === "isNoneOf" && allowed.includes("isNoneOf") ? "isNoneOf" : "isAnyOf";
  const picked = [...known].filter(([key]) => checked.has(key) === (operator === "isAnyOf")).map(([, text]) => text);
  const outside = existing.length === 1 && existing[0]!.operator === operator ? outsideValues(existing, new Set(known.keys()), matchCase) : [];
  const value = [...picked, ...outside];
  if (value.length > MAX_SET_FILTER_ENTRIES) return { status: "blocked", reason: "too-many" };
  if (operator === "isAnyOf" && value.length === 0) return { status: "blocked", reason: "none-checked" };
  return placeSetEntry(filters, existing, value.length === 0 ? undefined : { columnId, operator, value }, matchCase);
}
