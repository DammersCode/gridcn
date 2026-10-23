import type { FilterOperator, FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";

export const MAX_SET_FILTER_ENTRIES = 1000;

type SetOperator = "isAnyOf" | "isNoneOf";

export type SetFilterPlan =
  | { status: "unchanged" }
  | { status: "blocked"; reason: "none-checked" | "too-many" }
  | { status: "apply"; filters: FilterSpec[] };

export type SetFilterPlanInput = {
  filters: readonly FilterSpec[];
  columnId: string;
  keys: readonly string[];
  checked: ReadonlySet<string>;
  allowed: readonly FilterOperator[];
};

const isSetFilterOf = (filter: FilterSpec, columnId: string): boolean =>
  filter.columnId === columnId && (filter.operator === "isAnyOf" || filter.operator === "isNoneOf");

const listOf = (filter: FilterSpec): string[] => (Array.isArray(filter.value) ? (filter.value as string[]) : []);

export function checkedKeysFromFilters(filters: readonly FilterSpec[], columnId: string, keys: readonly string[]): Set<string> {
  const entries = filters.filter((f) => isSetFilterOf(f, columnId)).map((f) => ({ operator: f.operator, values: new Set(listOf(f).map((v) => v.toLowerCase())) }));
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

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v) => b.includes(v));

/**
 * Plans the `setFilters` write for one column's set filter: replaces every `isAnyOf`/`isNoneOf`
 * entry of the column with the shorter of the checked and unchecked lists, using only operators
 * the column allows, and keeps every other filter.
 */
export function planSetFilter(input: SetFilterPlanInput): SetFilterPlan {
  const { filters, columnId, keys, checked, allowed } = input;
  const existing = filters.filter((f) => isSetFilterOf(f, columnId));
  const checkedKeys = keys.filter((key) => checked.has(key));
  const uncheckedKeys = keys.filter((key) => !checked.has(key));

  if (checkedKeys.length === 0) return { status: "blocked", reason: "none-checked" };

  let entry: FilterSpec | undefined;
  if (uncheckedKeys.length > 0) {
    const operator = chooseOperator(checkedKeys.length, uncheckedKeys.length, allowed, existing[0]?.operator as SetOperator | undefined);
    const known = new Set(keys);
    const outside = existing.length === 1 && existing[0]!.operator === operator ? listOf(existing[0]!).filter((v) => !known.has(v)) : [];
    const value = [...(operator === "isAnyOf" ? checkedKeys : uncheckedKeys), ...outside];
    if (value.length > MAX_SET_FILTER_ENTRIES) return { status: "blocked", reason: "too-many" };
    entry = { columnId, operator, value };
  }

  if (!entry) return existing.length === 0 ? { status: "unchanged" } : { status: "apply", filters: filters.filter((f) => !existing.includes(f)) };
  if (existing.length === 1 && existing[0]!.operator === entry.operator && sameList(listOf(existing[0]!), entry.value as string[])) return { status: "unchanged" };

  const next: FilterSpec[] = [];
  let placed = false;
  for (const filter of filters) {
    if (!existing.includes(filter)) next.push(filter);
    else if (!placed) {
      next.push(entry);
      placed = true;
    }
  }
  if (!placed) next.push(entry);
  return { status: "apply", filters: next };
}
