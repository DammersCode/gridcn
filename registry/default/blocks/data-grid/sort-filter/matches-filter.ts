import type { BuiltInFilterOperator, FilterSpec } from "../types";
import { defaultCompareText } from "./default-compare-text";

function parseNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isNaN(n) ? null : n;
}

/** How a filter orders and evaluates text beyond the built-in rules; both come from the column. */
export type FilterMatcherOptions = {
  /** Orders cell text against a bound for `gt`, `gte`, `lt`, `lte`, `isBetween`; a throw or NaN falls back to the default order. */
  compare?: (text: string, bound: string) => number;
  /** Evaluates an operator that is not built in. */
  custom?: (text: string, filter: FilterSpec) => boolean;
};

const BUILT_IN_OPERATORS: ReadonlySet<string> = new Set<BuiltInFilterOperator>([
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
]);

/** Whether `operator` is one of the built-in operators. */
export function isBuiltInOperator(operator: string): boolean {
  return BUILT_IN_OPERATORS.has(operator);
}

/** The column comparator's order, or `undefined` when it throws or returns NaN. */
function customOrder(compare: FilterMatcherOptions["compare"], text: string, bound: string): number | undefined {
  if (!compare) return undefined;
  try {
    const order = compare(text, bound);
    return Number.isNaN(order) ? undefined : order;
  } catch {
    return undefined;
  }
}

/** A custom operator's test: a throw fails the row; without an evaluator every row passes. */
function customOperatorTest(filter: FilterSpec, custom: FilterMatcherOptions["custom"]): (text: string) => boolean {
  if (!custom) return () => true;
  return (text) => {
    try {
      return custom(text, filter);
    } catch {
      return false;
    }
  };
}

/** Compares `text` against `bound` numerically when both parse as numbers, else via `defaultCompareText`. */
function compareTextTo(text: string, bound: string, compare?: FilterMatcherOptions["compare"]): number {
  const custom = customOrder(compare, text, bound);
  if (custom !== undefined) return custom;
  const a = parseNumber(text);
  const b = parseNumber(bound);
  if (a !== null && b !== null) return a - b;
  return defaultCompareText(text, bound);
}

/** The string entries of a list filter; a controlled `filterState` can carry other JSON values. */
function stringChoices(filter: FilterSpec): string[] {
  return Array.isArray(filter.value) ? filter.value.filter((choice): choice is string => typeof choice === "string") : [];
}

/**
 * Evaluates a single {@link FilterSpec} against a cell's text value.
 * `gt`/`gte`/`lt`/`lte` compare numerically when both sides parse as
 * numbers, else fall back to `defaultCompareText`; blank cell text never
 * satisfies these comparisons. `empty`/`notEmpty` ignore `filter.value`.
 * `isBetween` is inclusive on both ends; an empty bound (`""`) leaves that
 * side open (e.g. `["", "10"]` means "<= 10"). `isAnyOf` matches when the cell
 * text equals any entry of its `string[]`, compared case-insensitively like `equals`;
 * `isNoneOf` is the complement (an empty list matches every row).
 *
 * This is the correctness reference (re-parses `filter.value` on every call) — {@link createFilterMatcher}
 * is the same semantics with the bound(s) parsed once, for a hot per-row loop over many rows.
 */
export function matchesFilter(text: string, filter: FilterSpec, options: FilterMatcherOptions = {}): boolean {
  const op = filter.operator;
  if (!BUILT_IN_OPERATORS.has(op)) return customOperatorTest(filter, options.custom)(text);
  if (op === "empty") return text === "";
  if (op === "notEmpty") return text !== "";

  if (op === "isAnyOf") {
    // an empty choice list matches nothing, so a half-built filter row hides every row rather than being a no-op
    const textLower = text.toLowerCase();
    return stringChoices(filter).some((choice) => choice.toLowerCase() === textLower);
  }

  if (op === "isNoneOf") {
    const textLower = text.toLowerCase();
    return !stringChoices(filter).some((choice) => choice.toLowerCase() === textLower);
  }

  if (op === "isBetween") {
    // Excel/AG Grid semantics: blank cells never satisfy a comparison filter.
    if (text === "") return false;
    const [min = "", max = ""] = Array.isArray(filter.value) ? filter.value : ["", ""];
    if (min !== "" && compareTextTo(text, min, options.compare) < 0) return false;
    if (max !== "" && compareTextTo(text, max, options.compare) > 0) return false;
    return true;
  }

  const value = typeof filter.value === "string" ? filter.value : "";
  const textLower = text.toLowerCase();
  const valueLower = value.toLowerCase();

  switch (op as BuiltInFilterOperator) {
    case "contains":
      return textLower.includes(valueLower);
    case "notContains":
      return !textLower.includes(valueLower);
    case "equals":
      return textLower === valueLower;
    case "notEquals":
      return textLower !== valueLower;
    case "startsWith":
      return textLower.startsWith(valueLower);
    case "endsWith":
      return textLower.endsWith(valueLower);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // Excel/AG Grid semantics: blank cells never satisfy a comparison filter.
      if (text === "") return false;
      const cmp = compareTextTo(text, value, options.compare);
      if (op === "gt") return cmp > 0;
      if (op === "gte") return cmp >= 0;
      if (op === "lt") return cmp < 0;
      return cmp <= 0;
    }
    default:
      return true;
  }
}

/** A bound pre-parsed once (outside the per-row loop) plus its original text for the string fallback path. */
type ParsedBound = { raw: string; num: number | null };

function parseBound(raw: string): ParsedBound {
  return { raw, num: parseNumber(raw) };
}

/** Compares `text` against a {@link ParsedBound}: numeric if `text` also parses, else falls back to `defaultCompareText`. */
function compareTextToParsedBound(text: string, bound: ParsedBound, compare?: FilterMatcherOptions["compare"]): number {
  const custom = customOrder(compare, text, bound.raw);
  if (custom !== undefined) return custom;
  if (bound.num !== null) {
    const a = parseNumber(text);
    if (a !== null) return a - bound.num;
  }
  return defaultCompareText(text, bound.raw);
}

/**
 * Builds a per-row matcher for `filter` with any numeric bound(s) in `filter.value` parsed exactly
 * once, instead of on every {@link matchesFilter} call — `gt`/`gte`/`lt`/`lte`/`isBetween` bounds are
 * the same string across every row of a `buildViewIndex` pass, so re-parsing them per row (as a
 * direct `matchesFilter` call in a `.filter()` predicate does) is O(n) redundant work. Same
 * semantics as `matchesFilter`, verified by build-view-index's own tests; kept in sync manually
 * since duplicating a switch this small behind a shared abstraction would obscure both.
 */
export function createFilterMatcher(filter: FilterSpec, options: FilterMatcherOptions = {}): (text: string) => boolean {
  const op = filter.operator;
  if (!BUILT_IN_OPERATORS.has(op)) return customOperatorTest(filter, options.custom);
  const { compare } = options;
  if (op === "empty") return (text) => text === "";
  if (op === "notEmpty") return (text) => text !== "";

  if (op === "isAnyOf") {
    const set = new Set(stringChoices(filter).map((choice) => choice.toLowerCase()));
    return (text) => set.has(text.toLowerCase());
  }

  if (op === "isNoneOf") {
    const set = new Set(stringChoices(filter).map((choice) => choice.toLowerCase()));
    return (text) => !set.has(text.toLowerCase());
  }

  if (op === "isBetween") {
    const [minRaw = "", maxRaw = ""] = Array.isArray(filter.value) ? filter.value : ["", ""];
    const min = minRaw !== "" ? parseBound(minRaw) : null;
    const max = maxRaw !== "" ? parseBound(maxRaw) : null;
    return (text) => {
      if (text === "") return false;
      if (min && compareTextToParsedBound(text, min, compare) < 0) return false;
      if (max && compareTextToParsedBound(text, max, compare) > 0) return false;
      return true;
    };
  }

  const value = typeof filter.value === "string" ? filter.value : "";

  switch (op as BuiltInFilterOperator) {
    case "contains": {
      const needle = value.toLowerCase();
      return (text) => text.toLowerCase().includes(needle);
    }
    case "notContains": {
      const needle = value.toLowerCase();
      return (text) => !text.toLowerCase().includes(needle);
    }
    case "equals": {
      const needle = value.toLowerCase();
      return (text) => text.toLowerCase() === needle;
    }
    case "notEquals": {
      const needle = value.toLowerCase();
      return (text) => text.toLowerCase() !== needle;
    }
    case "startsWith": {
      const needle = value.toLowerCase();
      return (text) => text.toLowerCase().startsWith(needle);
    }
    case "endsWith": {
      const needle = value.toLowerCase();
      return (text) => text.toLowerCase().endsWith(needle);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const bound = parseBound(value);
      return (text) => {
        if (text === "") return false;
        const cmp = compareTextToParsedBound(text, bound, compare);
        if (op === "gt") return cmp > 0;
        if (op === "gte") return cmp >= 0;
        if (op === "lt") return cmp < 0;
        return cmp <= 0;
      };
    }
    default:
      return () => true;
  }
}

/**
 * A matcher over raw numbers for `gt`/`gte`/`lt`/`lte`/`isBetween`, or `null` when the filter has a bound that does not
 * parse as a number. For a non-NaN number it returns what {@link createFilterMatcher} returns for `String(value)`,
 * minus the number-to-text-to-number round trip.
 */
export function createNumberMatcher(filter: FilterSpec): ((value: number) => boolean) | null {
  const op = filter.operator;
  if (op === "isBetween") {
    const [minRaw = "", maxRaw = ""] = Array.isArray(filter.value) ? filter.value : ["", ""];
    const min = minRaw !== "" ? parseNumber(minRaw) : null;
    const max = maxRaw !== "" ? parseNumber(maxRaw) : null;
    if ((minRaw !== "" && min === null) || (maxRaw !== "" && max === null)) return null;
    return (value) => !(min !== null && value - min < 0) && !(max !== null && value - max > 0);
  }
  if (op !== "gt" && op !== "gte" && op !== "lt" && op !== "lte") return null;
  const bound = parseNumber(typeof filter.value === "string" ? filter.value : "");
  if (bound === null) return null;
  if (op === "gt") return (value) => value - bound > 0;
  if (op === "gte") return (value) => value - bound >= 0;
  if (op === "lt") return (value) => value - bound < 0;
  return (value) => value - bound <= 0;
}
