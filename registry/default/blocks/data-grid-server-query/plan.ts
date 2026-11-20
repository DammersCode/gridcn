import type { AggregateReducer, PlanColumn } from "./column-map";
import type { Operand } from "./operands";

export type { Operand } from "./operands";

/** One test of a column. `ne`, negated text and list tests, and `blank` negations include NULL rows as the client does. */
export type Test =
  | { k: "eq" | "ne"; value: Operand }
  | { k: "text"; mode: "contains" | "startsWith" | "endsWith" | "equals"; text: string; negate: boolean; caseSensitive: boolean }
  | { k: "cmp"; op: "gt" | "gte" | "lt" | "lte"; value: Operand }
  | { k: "range"; lo?: Operand; hi?: Operand; hiExclusive: boolean }
  | { k: "in"; values: readonly Operand[]; negate: boolean; blank: boolean; caseSensitive: boolean }
  | { k: "exact"; value: Operand }
  | { k: "blank"; negate: boolean }
  | { k: "custom"; id: string; value: unknown }
  /** Exact primary-key membership, the whole list bound as one parameter; a number or text key, never an empty list. */
  | { k: "ids"; values: readonly Operand[]; negate: boolean }
  /** A raw comparison in the database's sort order, with no blank guard: `gt`, `lt`, and `eq` carry `value`; `null` is `IS NULL`. */
  | { k: "key"; op: "gt" | "lt" | "eq" | "null"; value?: Operand };

export type Predicate =
  | { t: "true" }
  | { t: "false" }
  | { t: "and" | "or"; items: readonly Predicate[] }
  | { t: "not"; item: Predicate }
  | { t: "leaf"; column: PlanColumn; test: Test };

export type OrderTerm = { column: PlanColumn; direction: "asc" | "desc" };

export type RowsPlan = {
  kind: "rows";
  where: Predicate;
  /** A total order: the request's keys, then the tie-breaker. NULLs sort last. */
  orderBy: readonly OrderTerm[];
  rowRange: { start: number; end: number };
  runCount: boolean;
  projection: readonly PlanColumn[];
  /** Cursor pages: `selectRows` also reads each `time` key as exact text under `as`, an alias no column id takes. */
  keyText?: readonly { column: PlanColumn; as: string }[];
};
export type ValuesPlan = { kind: "values"; where: Predicate; column: PlanColumn; query: string };
export type AggregatesPlan = { kind: "aggregates"; where: Predicate; columns: readonly { column: PlanColumn; reducer: AggregateReducer }[] };
/** One page of the child groups of one level; `where` holds the filters, the search, and the path equalities. */
export type GroupsPlan = {
  kind: "groups";
  where: Predicate;
  level: PlanColumn;
  nextLevel?: PlanColumn;
  direction: "asc" | "desc";
  rowRange: { start: number; end: number };
  /** The top level also answers the row count of the whole result. */
  countRows: boolean;
  aggregates: readonly { column: PlanColumn; reducer: AggregateReducer }[];
  /**
   * The keys of `column` become generated columns, each with one cell per aggregate. The parsed plan holds no `keys`;
   * `selectGroups` gets them in key order, each with the `test` that keeps its rows. `omitted` counts the generated columns cut past the cap.
   */
  pivot?: { column: PlanColumn; direction: "asc" | "desc"; keys: readonly PivotKey[]; omitted: number };
};
/** One pivot key as the answer carries it, with the test that keeps its rows; `null` is the empty key. */
export type PivotKey = { key: string | number | boolean | null; test: Predicate };
export type QueryPlan = RowsPlan | ValuesPlan | AggregatesPlan | GroupsPlan;
/** `"rows"` reads a rows request and refuses a grouped one; `"page"` reads either and yields a `GroupsPlan` or a `RowsPlan`. */
export type QueryRequestKind = "rows" | "page" | "values" | "aggregates";
export type PlanOf<R extends QueryRequestKind> = R extends "page" ? RowsPlan | GroupsPlan : Extract<QueryPlan, { kind: R }>;

export const TRUE: Predicate = Object.freeze({ t: "true" });
export const FALSE: Predicate = Object.freeze({ t: "false" });

export function leaf(column: PlanColumn, test: Test): Predicate {
  return { t: "leaf", column, test };
}

/** The rows `item` does not match; a NULL result of `item` counts as no match. A constant folds. */
export function negate(item: Predicate): Predicate {
  if (item.t === "true") return FALSE;
  if (item.t === "false") return TRUE;
  return item.t === "not" ? item.item : { t: "not", item };
}

/** Flattens, drops `true` from an `and` and `false` from an `or`, and short-circuits the other way. No adapter sees an empty group. */
export function combine(join: "and" | "or", items: readonly Predicate[]): Predicate {
  const neutral = join === "and" ? "true" : "false";
  const absorbing = join === "and" ? "false" : "true";
  const out: Predicate[] = [];
  for (const item of items) {
    if (item.t === absorbing) return item;
    if (item.t === neutral) continue;
    if (item.t === join) out.push(...item.items);
    else out.push(item);
  }
  if (out.length === 0) return join === "and" ? TRUE : FALSE;
  return out.length === 1 ? out[0]! : { t: join, items: out };
}
