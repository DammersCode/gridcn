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
  | { k: "custom"; id: string; value: unknown };

export type Predicate =
  | { t: "true" }
  | { t: "false" }
  | { t: "and" | "or"; items: readonly Predicate[] }
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
};
export type ValuesPlan = { kind: "values"; where: Predicate; column: PlanColumn; query: string };
export type AggregatesPlan = { kind: "aggregates"; where: Predicate; columns: readonly { column: PlanColumn; reducer: AggregateReducer }[] };
export type QueryPlan = RowsPlan | ValuesPlan | AggregatesPlan;
export type QueryRequestKind = QueryPlan["kind"];

export const TRUE: Predicate = Object.freeze({ t: "true" });
export const FALSE: Predicate = Object.freeze({ t: "false" });

export function leaf(column: PlanColumn, test: Test): Predicate {
  return { t: "leaf", column, test };
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
