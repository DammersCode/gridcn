import { QueryError } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type Operand, type PlanColumn, type Predicate, type Test, likePattern } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";
import { quote } from "./quote";

/** One PostgREST filter on a physical column; `v` is text, as PostgREST reads every value. */
export type FilterLeaf =
  | { c: string; op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like" | "ilike"; v: string }
  | { c: string; op: "in"; v: string[] }
  | { c: string; op: "is" };
/** A predicate in PostgREST's operators, which the URL and the grid function read alike. PostgREST `not` is plain SQL `NOT`. */
export type FilterNode = { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode } | FilterLeaf;
/** `true` and `false` fold away inside groups, so they only stand at the root. */
export type Filter = boolean | FilterNode;

export const isTextual = (column: PlanColumn): boolean => column.kind === "text" || column.kind === "select";

function join(key: "and" | "or", items: readonly Filter[]): Filter {
  const neutral = key === "and";
  const out: FilterNode[] = [];
  for (const item of items) {
    if (typeof item === "boolean") {
      if (item !== neutral) return item;
      continue;
    }
    if (Object.hasOwn(item, key)) out.push(...(item as Record<typeof key, FilterNode[]>)[key]);
    else out.push(item);
  }
  if (out.length === 0) return neutral;
  if (out.length === 1) return out[0]!;
  return key === "and" ? { and: out } : { or: out };
}

export const and = (items: readonly Filter[]): Filter => join("and", items);
export const or = (items: readonly Filter[]): Filter => join("or", items);
const not = (item: Filter): Filter => (typeof item === "boolean" ? !item : Object.hasOwn(item, "not") ? (item as { not: FilterNode }).not : { not: item });

/** The operand as PostgREST text: integers and decimals as digits, an epoch instant as its number. */
export function operandText(column: PlanColumn, operand: Operand): string {
  switch (operand.kind) {
    case "text":
    case "date":
    case "number":
      return operand.v;
    case "boolean":
      return String(operand.v);
    case "bigint":
      return operand.v.toString();
    case "instant":
      if (column.storage === "epoch-ms") return String(Date.parse(operand.v));
      if (column.storage === "epoch-s") return String(Date.parse(operand.v) / 1000);
      return operand.v;
  }
}

/**
 * The walker from the core's predicate to PostgREST filters. Only the primary key is known to hold no NULL, so every
 * other column gets the NULL branches the core's semantics need.
 */
export function renderFilter(p: Predicate): Filter {
  return node(p, false);
}

const isNull = (column: PlanColumn): Filter => (column.primaryKey ? false : { c: column.field, op: "is" });
const notNull = (column: PlanColumn): Filter => not(isNull(column));

/** The filter, false on NULL rows when `twoValued`: PostgREST's `not` is SQL `NOT`, which drops a NULL result. */
const twoValuedLeaf = (column: PlanColumn, filter: Filter, twoValued: boolean): Filter => (twoValued ? and([filter, notNull(column)]) : filter);

const value = (column: PlanColumn, operand: Operand): string => operandText(column, operand);

/** A one-element list is an `eq`: PostgREST reads the list `("")` as the empty list. */
const list = (column: PlanColumn, values: readonly string[]): FilterLeaf => (values.length === 1 ? { c: column.field, op: "eq", v: values[0]! } : { c: column.field, op: "in", v: [...values] });

/** `equals` with case is `eq`; every other text test is a LIKE pattern with backslash escapes. */
export function textLeaf(column: PlanColumn, mode: "contains" | "startsWith" | "endsWith" | "equals", text: string, caseSensitive: boolean): FilterLeaf {
  if (mode === "equals" && caseSensitive) return { c: column.field, op: "eq", v: text };
  // PostgREST turns every `*` of a LIKE value into `%`, with no escape for it.
  if (text.includes("*")) throw new QueryError("unsupported-value", [column.id]);
  return { c: column.field, op: caseSensitive ? "like" : "ilike", v: likePattern(mode, text, "\\") };
}

const foldsEmptyText = (column: PlanColumn): boolean => isTextual(column) && !column.keepBlankText && column.native === undefined;
const foldsCase = (column: PlanColumn): boolean => isTextual(column) && column.native === undefined;

function blank(column: PlanColumn, negate: boolean, twoValued: boolean): Filter {
  if (!foldsEmptyText(column)) return negate ? notNull(column) : isNull(column);
  return negate ? twoValuedLeaf(column, { c: column.field, op: "neq", v: "" }, twoValued) : or([isNull(column), { c: column.field, op: "eq", v: "" }]);
}

const guarded = (column: PlanColumn, filter: Filter): Filter => (foldsEmptyText(column) ? and([filter, { c: column.field, op: "neq", v: "" }]) : filter);

function inList(column: PlanColumn, t: Extract<Test, { k: "in" }>, twoValued: boolean): Filter {
  const values = t.values.map((operand) => value(column, operand));
  // A native enum or uuid value is already canonical, and PostgREST has no ILIKE on those types.
  const folded = !t.caseSensitive && foldsCase(column);
  const member = (two: boolean): Filter => (folded ? or(values.map((text) => twoValuedLeaf(column, textLeaf(column, "equals", text, false), two))) : twoValuedLeaf(column, list(column, values), two));
  if (!t.negate) return t.blank ? or([member(twoValued), blank(column, false, twoValued)]) : member(twoValued);
  const outside = folded ? not(member(true)) : not(list(column, values));
  return t.blank ? and([outside, blank(column, true, twoValued)]) : or([isNull(column), outside]);
}

function leafNode(column: PlanColumn, t: Test, twoValued: boolean): Filter {
  const c = column.field;
  switch (t.k) {
    case "eq":
    case "exact":
      return twoValuedLeaf(column, { c, op: "eq", v: value(column, t.value) }, twoValued);
    case "ne":
      return or([isNull(column), { c, op: "neq", v: value(column, t.value) }]);
    case "blank":
      return blank(column, t.negate, twoValued);
    case "text": {
      const filter = textLeaf(column, t.mode, t.text, t.caseSensitive);
      return t.negate ? or([not(filter), isNull(column)]) : twoValuedLeaf(column, filter, twoValued);
    }
    case "cmp":
      return twoValuedLeaf(column, guarded(column, { c, op: t.op, v: value(column, t.value) }), twoValued);
    case "range": {
      const parts: Filter[] = [];
      if (t.lo) parts.push({ c, op: "gte", v: value(column, t.lo) });
      if (t.hi) parts.push({ c, op: t.hiExclusive ? "lt" : "lte", v: value(column, t.hi) });
      return twoValuedLeaf(column, guarded(column, and(parts)), twoValued);
    }
    case "in":
      return inList(column, t, twoValued);
    case "ids": {
      const ids = list(column, t.values.map((operand) => value(column, operand)));
      return t.negate ? not(ids) : ids;
    }
    case "key":
      // No blank guard and no folding: the comparison follows ORDER BY.
      if (t.op === "null" || !t.value) return isNull(column);
      return twoValuedLeaf(column, { c, op: t.op, v: value(column, t.value) }, twoValued);
    case "custom":
      throw new QueryError("unsupported", [column.id]);
  }
}

function node(p: Predicate, twoValued: boolean): Filter {
  switch (p.t) {
    case "true":
      return true;
    case "false":
      return false;
    case "leaf":
      return leafNode(p.column, p.test, twoValued);
    case "not":
      return not(node(p.item, true));
    default:
      return (p.t === "and" ? and : or)(p.items.map((item) => node(item, twoValued)));
  }
}

function leafText(leaf: FilterLeaf): string {
  if (leaf.op === "is") return "is.null";
  if (leaf.op === "in") return `in.(${leaf.v.map(quote).join(",")})`;
  return `${leaf.op}.${quote(leaf.v)}`;
}

const isLeaf = (item: FilterNode): item is FilterLeaf => Object.hasOwn(item, "c");

function nodeText(item: FilterNode): string {
  if (isLeaf(item)) return `${item.c}.${leafText(item)}`;
  if ("and" in item) return `and(${item.and.map(nodeText).join(",")})`;
  if ("or" in item) return `or(${item.or.map(nodeText).join(",")})`;
  const inner = item.not;
  if (isLeaf(inner)) return `${inner.c}.not.${leafText(inner)}`;
  return "not" in inner ? `not.and(${nodeText(inner)})` : `not.${nodeText(inner)}`;
}

/** The logic tree of `.or()`; `anchor` is a column for the constants, which PostgREST has no literal for. */
export function treeText(filter: Filter, anchor: string): string {
  if (filter === true) return `or(${anchor}.is.null,${anchor}.not.is.null)`;
  if (filter === false) return `and(${anchor}.is.null,${anchor}.not.is.null)`;
  return nodeText(filter);
}
