import { QueryError } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { type Operand, type OrderTerm, type PlanColumn, type Predicate, type Test, escapeLike } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query-sdk";

/** A Prisma `where` input of the model. */
export type PrismaWhere = Record<string, unknown>;
/** A Prisma `orderBy` input of the model. */
export type PrismaOrderBy = Record<string, unknown>[];
/** The `provider` of the Prisma schema's datasource. */
export type PrismaProvider = "postgresql" | "sqlite";

/** A rendered predicate: `true` and `false` stay constants until the root, so no `{}` lands inside an `OR`. */
export type PrismaNode = boolean | PrismaWhere;

// Prisma 7.10.1 bounds the bound values of one statement by the driver adapter's `maxBindValues`, else by these provider defaults.
const BIND_BUDGET: Readonly<Record<PrismaProvider, number>> = { postgresql: 32_766, sqlite: 999 };
// The LIMIT and OFFSET (or Prisma's own extra values) of a statement.
const RESERVED_BINDS = 2;
const LIKE_MODES = new Set<string>(["contains", "startsWith", "endsWith"]);

/** Sets an own data property, so a key such as `__proto__` stays a plain key. */
export function own<T extends object>(target: T, key: string, value: unknown): T {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  return target;
}

export const field = (column: PlanColumn, filter: unknown): PrismaWhere => own({}, column.field, filter);
export const isTextual = (column: PlanColumn): boolean => column.kind === "text" || column.kind === "select";
/** Whether a stored `''` counts as blank in a group key or a set value, as the SQL renderers fold it into NULL. */
export const foldsEmptyText = (column: PlanColumn): boolean => isTextual(column) && column.native === undefined;
export const unsupported = (column: PlanColumn): QueryError => new QueryError("unsupported", [column.id]);

// A Prisma Boolean filter has no `in` or `notIn`.
const hasNoList = (column: PlanColumn): boolean => column.kind === "checkbox";

/** The rows whose field is one of `values`: `in`, or an OR of `equals` on a Boolean field. */
export function oneOf(column: PlanColumn, values: readonly unknown[], leaf: (filter: Record<string, unknown>) => PrismaNode = (filter) => field(column, filter)): PrismaNode {
  return hasNoList(column) ? or(values.map((v) => leaf({ equals: v }))) : leaf({ in: values });
}

/** Folds the constants and flattens nested groups of the same join; no group comes out empty. */
function join(key: "AND" | "OR", items: readonly PrismaNode[]): PrismaNode {
  const neutral = key === "AND";
  const out: PrismaWhere[] = [];
  for (const item of items) {
    if (typeof item === "boolean") {
      if (item !== neutral) return item;
      continue;
    }
    const keys = Object.keys(item);
    if (keys.length === 1 && keys[0] === key && Array.isArray(item[key])) out.push(...(item[key] as PrismaWhere[]));
    else out.push(item);
  }
  return out.length === 0 ? neutral : out.length === 1 ? out[0]! : own({}, key, out);
}

export const and = (items: readonly PrismaNode[]): PrismaNode => join("AND", items);
export const or = (items: readonly PrismaNode[]): PrismaNode => join("OR", items);

const not = (item: PrismaNode): PrismaNode => (typeof item === "boolean" ? !item : { NOT: item });

export const toWhere = (node: PrismaNode): PrismaWhere => (node === true ? {} : node === false ? { OR: [] } : node);

const isPlainObject = (value: object): boolean => {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** The bound values of an input; throws on `undefined`, which Prisma drops silently, and on `{}` inside `OR`, which matches nothing. */
export function boundValues(node: unknown, inOr = false): number {
  if (node === undefined) throw new Error("gridcn Prisma adapter: an undefined value would drop a filter");
  if (node === null) return 0;
  if (typeof node !== "object" || !(Array.isArray(node) || isPlainObject(node))) return 1;
  if (Array.isArray(node)) return node.reduce((sum: number, item: unknown) => sum + boundValues(item, inOr), 0);
  const keys = Object.keys(node);
  if (inOr && keys.length === 0) throw new Error("gridcn Prisma adapter: an empty filter inside OR would match nothing");
  let count = 0;
  for (const key of keys) {
    const value = (node as Record<string, unknown>)[key];
    if (key === "mode" && typeof value === "string") continue;
    count += boundValues(value, key === "OR");
  }
  return count;
}

/** The longest id list a statement of `provider` binds next to the take and skip reserve. */
export const maxBoundIds = (provider: PrismaProvider): number => BIND_BUDGET[provider] - RESERVED_BINDS;

/** Refuses a statement whose `where` binds more values than the provider takes: Prisma splits a plain `in` beyond it and merges wrong results. */
export function assertBindBudget(where: unknown, provider: PrismaProvider, reserved = RESERVED_BINDS): void {
  if (boundValues(where) + reserved > BIND_BUDGET[provider]) throw new QueryError("limit-exceeded", []);
}

/** The operand as the Prisma field type takes it: `BigInt` for int8, text for decimals, `Date` for native dates. */
export function nativeValue(column: PlanColumn, operand: Operand): unknown {
  switch (operand.kind) {
    case "text":
    case "boolean":
      return operand.v;
    case "bigint":
      return column.numeric === "int8" ? operand.v : column.numeric === "decimal" ? operand.v.toString() : Number(operand.v);
    case "number":
      return column.numeric === "decimal" ? operand.v : Number(operand.v);
    case "date":
      return column.storage === "native" ? new Date(`${operand.v}T00:00:00.000Z`) : operand.v;
    case "instant":
      if (column.storage === "epoch-ms") return Date.parse(operand.v);
      if (column.storage === "epoch-s") {
        const ms = Date.parse(operand.v);
        // Prisma truncates a fraction bound to an Int field, so `gte 1.5` would match 1.
        if (ms % 1000 !== 0) throw new QueryError("unsupported-value", [column.id]);
        return ms / 1000;
      }
      return column.storage === "iso-text" ? operand.v : new Date(operand.v);
  }
}

/** A validated write value as the Prisma field type takes it: integers as numbers or `BigInt`, dates as `Date`. */
export function writeValue(column: PlanColumn, value: unknown): unknown {
  if (value === null) return null;
  if (column.kind === "number" && column.numeric !== "float" && column.numeric !== "decimal") return nativeValue(column, { kind: "bigint", v: BigInt(value as number | string) });
  if (column.kind === "date" && typeof value === "string") return nativeValue(column, { kind: column.time ? "instant" : "date", v: value });
  return value;
}

/** `nullableIds`: the columns whose field the schema declares with `?`; Prisma refuses `null` filters and `nulls` on the others. */
export function createPrismaRenderer(provider: PrismaProvider, nullableIds: ReadonlySet<string>) {
  const pg = provider === "postgresql";
  const isNullable = (column: PlanColumn): boolean => nullableIds.has(column.id);
  const escape = (text: string): string => escapeLike(text, "\\");
  const value = (column: PlanColumn, operand: Operand): unknown => nativeValue(column, operand);
  const isNull = (column: PlanColumn): PrismaNode => (isNullable(column) ? field(column, null) : false);

  /** The leaf, false on NULL rows when `twoValued`: under `NOT`, Prisma's three-valued logic drops the NULL rows otherwise. */
  function fieldLeaf(column: PlanColumn, filter: Record<string, unknown>, twoValued: boolean): PrismaWhere {
    if (!twoValued || !isNullable(column)) return field(column, filter);
    return "not" in filter ? { AND: [field(column, filter), field(column, { not: null })] } : field(column, { ...filter, not: null });
  }

  /** The field filter of a text test. On PostgreSQL every LIKE leaf and an insensitive `equals` (ILIKE) escape `%`, `_`, and `\`. */
  function textFilter(column: PlanColumn, mode: "contains" | "startsWith" | "endsWith" | "equals", text: string, caseSensitive: boolean): Record<string, unknown> {
    const like = LIKE_MODES.has(mode);
    // The core refuses these from the capabilities; the throws keep a missed path from matching wrong rows.
    if (like && column.native !== undefined) throw unsupported(column);
    if (!pg) {
      // SQLite: LIKE is ASCII case-insensitive with no ESCAPE clause, `=` is case-sensitive, and `mode` is an unknown argument.
      if (like === caseSensitive) throw unsupported(column);
      if (like && /[%_]/.test(text)) throw new QueryError("unsupported-value", [column.id]);
      return own({}, mode, text);
    }
    if (mode === "equals" && caseSensitive) return { equals: text };
    return caseSensitive ? own({}, mode, escape(text)) : own({ mode: "insensitive" }, mode, escape(text));
  }

  /** NULL, and on text that folds it `''`; `negate` is the rows with a non-blank value. */
  function blank(column: PlanColumn, negate: boolean, twoValued: boolean, emptyIsBlank = isTextual(column) && !column.keepBlankText && column.native === undefined): PrismaNode {
    if (!emptyIsBlank) return negate ? (isNullable(column) ? field(column, { not: null }) : true) : isNull(column);
    return negate ? fieldLeaf(column, { not: "" }, twoValued) : or([isNull(column), field(column, { equals: "" })]);
  }

  const guarded = (column: PlanColumn, filter: Record<string, unknown>): Record<string, unknown> =>
    isTextual(column) && !column.keepBlankText && column.native === undefined ? { ...filter, not: "" } : filter;

  function inList(column: PlanColumn, t: Extract<Test, { k: "in" }>, twoValued: boolean): PrismaNode {
    const values = t.values.map((operand) => value(column, operand));
    const folded = !t.caseSensitive && isTextual(column);
    if (folded && !pg) throw unsupported(column);
    // Insensitive `in` with `mode` is unverified on Prisma 7, so a folded list is an OR of the verified ILIKE equals.
    const member = (two: boolean): PrismaNode =>
      folded ? or(values.map((text) => fieldLeaf(column, { equals: escape(String(text)), mode: "insensitive" }, two))) : oneOf(column, values, (filter) => fieldLeaf(column, filter, two));
    if (!t.negate) return t.blank ? or([member(twoValued), blank(column, false, twoValued)]) : member(twoValued);
    const outside = folded ? not(member(true)) : hasNoList(column) ? and(values.map((v) => field(column, { not: v }))) : field(column, { notIn: values });
    return t.blank ? and([outside, blank(column, true, twoValued)]) : or([isNull(column), outside]);
  }

  function leafNode(column: PlanColumn, t: Test, twoValued: boolean): PrismaNode {
    switch (t.k) {
      case "eq":
      case "exact":
        return fieldLeaf(column, { equals: value(column, t.value) }, twoValued);
      case "ne":
        return or([isNull(column), field(column, { not: value(column, t.value) })]);
      case "blank":
        return blank(column, t.negate, twoValued);
      case "text": {
        const filter = textFilter(column, t.mode, t.text, t.caseSensitive);
        return t.negate ? or([isNull(column), { NOT: field(column, filter) }]) : fieldLeaf(column, filter, twoValued);
      }
      case "cmp":
        return fieldLeaf(column, guarded(column, own({}, t.op, value(column, t.value))), twoValued);
      case "range": {
        const filter: Record<string, unknown> = {};
        if (t.lo) filter["gte"] = value(column, t.lo);
        if (t.hi) filter[t.hiExclusive ? "lt" : "lte"] = value(column, t.hi);
        return fieldLeaf(column, guarded(column, filter), twoValued);
      }
      case "in":
        return inList(column, t, twoValued);
      case "ids":
        // SQLite would need `lower(col)` to keep an excluded uuid in any case excluded.
        if (t.negate && !pg && column.native === "uuid") throw unsupported(column);
        // `notIn`, never `NOT: { in }`: Prisma splits a plain `in` into chunks and merges wrong rows under NOT.
        return field(column, own({}, t.negate ? "notIn" : "in", t.values.map((operand) => value(column, operand))));
      case "key":
        // No `mode`: the comparison follows ORDER BY, which uses the column collation.
        if (t.op === "null" || !t.value) return isNull(column);
        // A Prisma Boolean filter has no `gt` or `lt`: past `false` ascending is `true`, past `true` is nothing.
        if (column.kind === "checkbox" && t.op !== "eq") return t.value.v === (t.op === "lt") ? fieldLeaf(column, { equals: !t.value.v }, twoValued) : false;
        return fieldLeaf(column, own({}, t.op === "eq" ? "equals" : t.op, value(column, t.value)), twoValued);
      case "custom":
        throw unsupported(column);
    }
  }

  function node(p: Predicate, twoValued = false): PrismaNode {
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

  const orderBy = (terms: readonly OrderTerm[]): PrismaOrderBy =>
    terms.map(({ column, direction }) => field(column, isNullable(column) ? { sort: direction, nulls: "last" } : direction));

  return { node, orderBy, blank, textFilter };
}
