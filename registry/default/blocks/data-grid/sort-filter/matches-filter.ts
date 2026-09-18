import type { FilterOperator, FilterSpec } from "../types";
import { defaultCompareText } from "./default-compare-text";

function parseNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isNaN(n) ? null : n;
}

/** Compares `text` against `bound` numerically when both parse as numbers, else via `defaultCompareText`. */
function compareTextTo(text: string, bound: string): number {
  const a = parseNumber(text);
  const b = parseNumber(bound);
  if (a !== null && b !== null) return a - b;
  return defaultCompareText(text, bound);
}

/**
 * Evaluates a single {@link FilterSpec} against a cell's text value.
 * `gt`/`gte`/`lt`/`lte` compare numerically when both sides parse as
 * numbers, else fall back to `defaultCompareText`; blank cell text never
 * satisfies these comparisons. `empty`/`notEmpty` ignore `filter.value`.
 * `isBetween` is inclusive on both ends; an empty bound (`""`) leaves that
 * side open (e.g. `["", "10"]` means "<= 10"). `isAnyOf` matches when the cell
 * text equals any entry of its `string[]`, compared case-insensitively like `equals`.
 *
 * This is the correctness reference (re-parses `filter.value` on every call) — {@link createFilterMatcher}
 * is the same semantics with the bound(s) parsed once, for a hot per-row loop over many rows.
 */
export function matchesFilter(text: string, filter: FilterSpec): boolean {
  const op: FilterOperator = filter.operator;
  if (op === "empty") return text === "";
  if (op === "notEmpty") return text !== "";

  if (op === "isAnyOf") {
    // an empty choice list matches nothing, so a half-built filter row hides every row rather than being a no-op
    const choices = Array.isArray(filter.value) ? filter.value : [];
    const textLower = text.toLowerCase();
    return choices.some((choice) => choice.toLowerCase() === textLower);
  }

  if (op === "isBetween") {
    // Excel/AG Grid semantics: blank cells never satisfy a comparison filter.
    if (text === "") return false;
    const [min = "", max = ""] = Array.isArray(filter.value) ? filter.value : ["", ""];
    if (min !== "" && compareTextTo(text, min) < 0) return false;
    if (max !== "" && compareTextTo(text, max) > 0) return false;
    return true;
  }

  const value = typeof filter.value === "string" ? filter.value : "";
  const textLower = text.toLowerCase();
  const valueLower = value.toLowerCase();

  switch (op) {
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
      const cmp = compareTextTo(text, value);
      if (op === "gt") return cmp > 0;
      if (op === "gte") return cmp >= 0;
      if (op === "lt") return cmp < 0;
      return cmp <= 0;
    }
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

/** A bound pre-parsed once (outside the per-row loop) plus its original text for the string fallback path. */
type ParsedBound = { raw: string; num: number | null };

function parseBound(raw: string): ParsedBound {
  return { raw, num: parseNumber(raw) };
}

/** Compares `text` against a {@link ParsedBound}: numeric if `text` also parses, else falls back to `defaultCompareText`. */
function compareTextToParsedBound(text: string, bound: ParsedBound): number {
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
export function createFilterMatcher(filter: FilterSpec): (text: string) => boolean {
  const op: FilterOperator = filter.operator;
  if (op === "empty") return (text) => text === "";
  if (op === "notEmpty") return (text) => text !== "";

  if (op === "isAnyOf") {
    const choices = (Array.isArray(filter.value) ? filter.value : []).map((choice) => choice.toLowerCase());
    const set = new Set(choices);
    return (text) => set.has(text.toLowerCase());
  }

  if (op === "isBetween") {
    const [minRaw = "", maxRaw = ""] = Array.isArray(filter.value) ? filter.value : ["", ""];
    const min = minRaw !== "" ? parseBound(minRaw) : null;
    const max = maxRaw !== "" ? parseBound(maxRaw) : null;
    return (text) => {
      if (text === "") return false;
      if (min && compareTextToParsedBound(text, min) < 0) return false;
      if (max && compareTextToParsedBound(text, max) > 0) return false;
      return true;
    };
  }

  const value = typeof filter.value === "string" ? filter.value : "";

  switch (op) {
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
        const cmp = compareTextToParsedBound(text, bound);
        if (op === "gt") return cmp > 0;
        if (op === "gte") return cmp >= 0;
        if (op === "lt") return cmp < 0;
        return cmp <= 0;
      };
    }
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}
