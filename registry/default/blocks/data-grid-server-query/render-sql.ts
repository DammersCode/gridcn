import type { PlanColumn } from "./column-map";
import { LIKE_ESCAPE, escapeLike } from "./like";
import type { Operand, OrderTerm, Predicate, Test, ValuesPlan } from "./plan";

/**
 * The few SQL pieces an ORM supplies, so one renderer holds every semantic decision. `raw` takes text from the closed tables
 * in this file only; `param` binds a value; `column` is a qualified identifier from the column map.
 */
export type SqlAlgebra<S> = {
  dialect: "pg" | "sqlite";
  raw(text: string): S;
  param(value: unknown): S;
  column(column: PlanColumn): S;
  /** Concatenates fragments with no separator. */
  cat(...parts: S[]): S;
  /** Wraps a fragment a `customOperators` handler returned in the ORM's own type. */
  native(value: unknown): S;
};

export type CustomHandler = (ctx: { column: PlanColumn; value: unknown }) => unknown;

const CMP_SQL = new Map<string, string>([["gt", " > "], ["gte", " >= "], ["lt", " < "], ["lte", " <= "]]);

const isTextual = (column: PlanColumn): boolean => column.kind === "text" || column.kind === "select";

export function createSqlRenderer<S>(a: SqlAlgebra<S>, customHandlers: ReadonlyMap<string, CustomHandler>) {
  const { raw, param, cat, column: ref } = a;
  const pg = a.dialect === "pg";
  const escapeClause = raw(` ESCAPE '${LIKE_ESCAPE}'`);

  const join = (parts: S[], separator: string): S => cat(...parts.flatMap((part, index) => (index === 0 ? [part] : [raw(separator), part])));
  const group = (inner: S): S => cat(raw("("), inner, raw(")"));
  const subject = (column: PlanColumn): S => (pg && column.native ? cat(ref(column), raw("::text")) : ref(column));

  function operand(value: Operand, column: PlanColumn): S {
    switch (value.kind) {
      case "text":
      case "date":
        return param(value.v);
      case "boolean":
        return param(pg ? value.v : value.v ? 1 : 0);
      case "bigint":
        return param(column.numeric === "int8" ? (pg ? value.v.toString() : value.v) : Number(value.v));
      case "number":
        if (column.numeric === "float" || !pg) return param(Number(value.v));
        return cat(param(value.v), raw("::numeric"));
      case "instant":
        if (column.storage === "epoch-ms") return param(Date.parse(value.v));
        if (column.storage === "epoch-s") return param(Date.parse(value.v) / 1000);
        if (column.storage === "iso-text" || !pg) return param(value.v);
        return cat(param(value.v), raw("::timestamptz"));
    }
  }

  function blank(column: PlanColumn, negate: boolean): S {
    const col = ref(column);
    if (!isTextual(column) || column.keepBlankText || column.native) return cat(col, raw(negate ? " IS NOT NULL" : " IS NULL"));
    return negate ? group(cat(col, raw(" IS NOT NULL AND "), col, raw(" <> ''"))) : group(cat(col, raw(" IS NULL OR "), col, raw(" = ''")));
  }

  /** `expr LIKE pattern ESCAPE '!'` for contains/startsWith/endsWith/equals in the case policy of the column. */
  function like(expr: S, mode: "contains" | "startsWith" | "endsWith" | "equals", text: string, caseSensitive: boolean): S {
    if (mode === "equals") {
      if (caseSensitive) return cat(expr, raw(" = "), param(text));
      return pg ? cat(raw("lower("), expr, raw(") = lower("), param(text), raw(")")) : cat(expr, raw(" = "), param(text), raw(" COLLATE NOCASE"));
    }
    if (caseSensitive && !pg) {
      if (mode === "contains") return cat(raw("instr("), expr, raw(", "), param(text), raw(") > 0"));
      if (mode === "startsWith") return cat(raw("substr("), expr, raw(", 1, length("), param(text), raw(")) = "), param(text));
      return cat(raw("substr("), expr, raw(", -length("), param(text), raw(")) = "), param(text));
    }
    const escaped = escapeLike(text, LIKE_ESCAPE);
    const pattern = mode === "contains" ? `%${escaped}%` : mode === "startsWith" ? `${escaped}%` : `%${escaped}`;
    return cat(expr, raw(pg && !caseSensitive ? " ILIKE " : " LIKE "), param(pattern), escapeClause);
  }

  const withBlankGuard = (column: PlanColumn, body: S): S =>
    isTextual(column) && !column.keepBlankText && !column.native ? group(cat(body, raw(" AND "), ref(column), raw(" <> ''"))) : body;

  function inList(column: PlanColumn, test: Extract<Test, { k: "in" }>): S {
    const col = ref(column);
    const folded = !test.caseSensitive && isTextual(column);
    const lhs = folded ? cat(raw("lower("), subject(column), raw(")")) : subject(column);
    const list = group(join(test.values.map((value) => (folded ? cat(raw("lower("), operand(value, column), raw(")")) : operand(value, column))), ", "));
    const member = cat(lhs, raw(" IN "), list);
    if (!test.negate) return test.blank ? group(cat(member, raw(" OR "), blank(column, false))) : member;
    if (test.blank) return group(cat(lhs, raw(" NOT IN "), list, raw(" AND "), blank(column, true)));
    return group(cat(col, raw(" IS NULL OR "), lhs, raw(" NOT IN "), list));
  }

  function test(column: PlanColumn, t: Test): S {
    const col = ref(column);
    switch (t.k) {
      case "eq":
      case "exact":
        return cat(col, raw(" = "), operand(t.value, column));
      case "ne":
        return group(cat(col, raw(" <> "), operand(t.value, column), raw(" OR "), col, raw(" IS NULL")));
      case "blank":
        return blank(column, t.negate);
      case "text": {
        const body = like(subject(column), t.mode, t.text, t.caseSensitive);
        return t.negate ? group(cat(col, raw(" IS NULL OR NOT ("), body, raw(")"))) : body;
      }
      case "cmp":
        return withBlankGuard(column, cat(col, raw(CMP_SQL.get(t.op)!), operand(t.value, column)));
      case "range": {
        const parts: S[] = [];
        if (t.lo) parts.push(cat(col, raw(" >= "), operand(t.lo, column)));
        if (t.hi) parts.push(cat(col, raw(t.hiExclusive ? " < " : " <= "), operand(t.hi, column)));
        const body = parts.length === 1 ? parts[0]! : group(join(parts, " AND "));
        return withBlankGuard(column, body);
      }
      case "in":
        return inList(column, t);
      case "custom": {
        const handler = customHandlers.get(t.id);
        if (!handler) throw new Error(`customOperators: no handler for "${t.id}"`);
        return a.native(handler({ column, value: t.value }));
      }
    }
  }

  function predicate(p: Predicate): S {
    switch (p.t) {
      case "true":
        return raw("1 = 1");
      case "false":
        return raw("1 = 0");
      case "leaf":
        return test(p.column, p.test);
      case "not":
        return group(cat(group(predicate(p.item)), raw(" IS NOT TRUE")));
      default:
        return group(join(p.items.map(predicate), p.t === "and" ? " AND " : " OR "));
    }
  }

  function orderBy(terms: readonly OrderTerm[]): S {
    return join(terms.map((term) => cat(ref(term.column), raw(term.direction === "asc" ? " ASC NULLS LAST" : " DESC NULLS LAST"))), ", ");
  }

  /** The text form the set filter searches and a value query matches. */
  function textForm(column: PlanColumn, timeZone?: string): S {
    const col = ref(column);
    if (column.kind === "checkbox") return pg ? cat(col, raw("::text")) : cat(raw("CASE "), col, raw(" WHEN 1 THEN 'true' WHEN 0 THEN 'false' END"));
    if (column.kind === "date" && column.time) return dayKey(column, timeZone);
    if (column.kind === "text" || column.kind === "select") return subject(column);
    return cat(raw("CAST("), col, raw(" AS text)"));
  }

  /** The group key of a set value: the local day for instants, the value elsewhere. */
  function dayKey(column: PlanColumn, timeZone = "UTC"): S {
    const col = ref(column);
    if (pg) {
      if (column.storage !== "native") throw new Error("Set values on a time column need native timestamps on PostgreSQL");
      if (/^[+-]/.test(timeZone)) throw new Error("Set values on PostgreSQL need an IANA time zone, not a fixed offset");
      if (!/^[A-Za-z0-9_+\-/:]+$/.test(timeZone)) throw new Error("timeZone holds characters a zone name never has");
      return cat(raw("("), col, raw(` AT TIME ZONE '${timeZone}')::date::text`));
    }
    if (column.storage === "epoch-ms") return cat(raw("date("), col, raw(" / 1000, 'unixepoch')"));
    if (column.storage === "epoch-s") return cat(raw("date("), col, raw(", 'unixepoch')"));
    return cat(raw("date("), col, raw(")"));
  }

  function valueKey(column: PlanColumn, timeZone?: string): { key: S; value: S } {
    if (column.kind === "date" && column.time) {
      const day = dayKey(column, timeZone);
      return { key: day, value: day };
    }
    if (isTextual(column)) {
      const coalesced = cat(raw("COALESCE("), subject(column), raw(", '')"));
      if (column.caseSensitive) return { key: coalesced, value: coalesced };
      return { key: cat(raw("lower("), coalesced, raw(")")), value: cat(raw("MIN("), coalesced, raw(")")) };
    }
    return { key: ref(column), value: ref(column) };
  }

  function aggregate(column: PlanColumn, reducer: string): S {
    const col = ref(column);
    const nonBlank = isTextual(column) && !column.keepBlankText ? cat(raw("NULLIF("), subject(column), raw(", '')")) : col;
    switch (reducer) {
      case "sum":
        return cat(raw("SUM("), col, raw(")"));
      case "avg":
        return cat(raw("AVG("), col, raw(")"));
      case "min":
        return cat(raw("MIN("), nonBlank, raw(")"));
      case "max":
        return cat(raw("MAX("), nonBlank, raw(")"));
      default:
        return cat(raw("COUNT("), nonBlank, raw(")"));
    }
  }

  /** The group key of a column: the stored value, with `''` folded into NULL for text. A time column keeps the full instant. */
  function groupKey(column: PlanColumn): S {
    return isTextual(column) ? cat(raw("NULLIF("), subject(column), raw(", '')")) : ref(column);
  }

  /** Number of groups of a key over the matched rows: distinct keys, the empty key counted once. */
  function keyCount(key: S): S {
    return cat(raw("COUNT(DISTINCT "), key, raw(") + COALESCE(MAX(CASE WHEN "), key, raw(" IS NULL THEN 1 ELSE 0 END), 0)"));
  }

  /** The filter of a set-values request: the plan's filter plus the value query as an escaped substring match. */
  function valuesFilter(plan: ValuesPlan, timeZone?: string): S {
    const where = predicate(plan.where);
    if (plan.query === "") return where;
    return group(cat(where, raw(" AND "), like(textForm(plan.column, timeZone), "contains", plan.query, false)));
  }

  return { predicate, orderBy, textForm, valueKey, aggregate, like, valuesFilter, groupKey, keyCount };
}
