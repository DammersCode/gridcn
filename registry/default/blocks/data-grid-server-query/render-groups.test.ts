import { describe, expect, it } from "vitest";
import { defineColumnMap, mapOf } from "./column-map";
import { parseQuery } from "./parse-query";
import { createSqlRenderer, type SqlAlgebra } from "./render-sql";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text" },
  tag: { type: "select" },
});

type Text = { sql: string; params: unknown[] };
const algebra = (dialect: "pg" | "sqlite"): SqlAlgebra<Text> => ({
  dialect,
  raw: (sql) => ({ sql, params: [] }),
  param: (value) => ({ sql: "?", params: [value] }),
  column: (column) => ({ sql: `"${column.field}"`, params: [] }),
  cat: (...parts) => ({ sql: parts.map((part) => part.sql).join(""), params: parts.flatMap((part) => part.params) }),
  native: () => ({ sql: "", params: [] }),
});

describe("group SQL", () => {
  const hostile = "'; drop table items; --";

  it.each(["pg", "sqlite"] as const)("binds a path key as a parameter on %s", (dialect) => {
    const renderer = createSqlRenderer(algebra(dialect), new Map());
    const plan = parseQuery({ spec: { groupBy: ["name", "tag"] }, groupPath: [{ columnId: "name", key: hostile }], start: 0, end: 5 }, { columns, request: "page" });
    const where = renderer.predicate(plan.where);
    expect(where.sql).not.toContain("drop");
    expect(where.params).toEqual([hostile]);
  });

  it("keys text by NULLIF and counts the empty key once", () => {
    const renderer = createSqlRenderer(algebra("sqlite"), new Map());
    const { name } = Object.fromEntries(mapOf(columns).byId);
    const key = renderer.groupKey(name!);
    expect(key.sql).toBe(`NULLIF("name", '')`);
    expect(renderer.keyCount(key).sql).toContain("COUNT(DISTINCT");
  });
});
