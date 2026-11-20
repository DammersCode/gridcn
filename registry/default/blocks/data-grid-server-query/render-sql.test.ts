// @vitest-environment node
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineColumnMap, mapOf } from "./column-map";
import type { Operand, Predicate } from "./plan";
import { createSqlRenderer, type SqlAlgebra } from "./render-sql";

type Text = { sql: string; params: unknown[] };
const algebra = (dialect: "pg" | "sqlite"): SqlAlgebra<Text> => ({
  dialect,
  raw: (sql) => ({ sql, params: [] }),
  param: (value) => ({ sql: "?", params: [value] }),
  column: (column) => ({ sql: `"${column.field}"`, params: [] }),
  cat: (...parts) => ({ sql: parts.map((part) => part.sql).join(""), params: parts.flatMap((part) => part.params) }),
  native: () => ({ sql: "", params: [] }),
});

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  small: { type: "number", numeric: "int2" },
  ratio: { type: "number", numeric: "float" },
  price: { type: "number", numeric: "decimal" },
  code: { type: "text" },
  uid: { type: "text", native: "uuid" },
  kind: { type: "select", native: "enum", choices: ["a", "b"] },
});
const column = (id: string) => mapOf(columns).byId.get(id)!;
const ids = (id: string, values: Operand[], negate = false): Predicate => ({ t: "leaf", column: column(id), test: { k: "ids", values, negate } });
const big = (v: string): Operand => ({ kind: "bigint", v: BigInt(v) });

describe("ids test SQL", () => {
  const pg = createSqlRenderer(algebra("pg"), new Map());
  const sqlite = createSqlRenderer(algebra("sqlite"), new Map());

  it("binds the whole list as one array parameter on PostgreSQL, cast to the key type", () => {
    expect(pg.predicate(ids("id", [big("1"), big("9223372036854775807")]))).toEqual({ sql: `"id" = ANY(?::int8[])`, params: [["1", "9223372036854775807"]] });
    expect(pg.predicate(ids("small", [big("2")])).sql).toBe(`"small" = ANY(?::int2[])`);
    expect(pg.predicate(ids("ratio", [{ kind: "number", v: "0.5" }])).sql).toBe(`"ratio" = ANY(?::float8[])`);
    expect(pg.predicate(ids("price", [{ kind: "number", v: "1.25" }]))).toEqual({ sql: `"price" = ANY(?::numeric[])`, params: [["1.25"]] });
    expect(pg.predicate(ids("code", [{ kind: "text", v: "x" }])).sql).toBe(`"code" = ANY(?::text[])`);
    expect(pg.predicate(ids("uid", [{ kind: "text", v: "x" }])).sql).toBe(`"uid" = ANY(?::uuid[])`);
    expect(pg.predicate(ids("kind", [{ kind: "text", v: "a" }])).sql).toBe(`"kind"::text = ANY(?::text[])`);
    expect(pg.predicate(ids("id", [big("1")], true)).sql).toBe(`NOT ("id" = ANY(?::int8[]))`);
  });

  it("binds the whole list as one JSON text on SQLite, int8 digit for digit", () => {
    expect(sqlite.predicate(ids("id", [big("1"), big("9223372036854775807")]))).toEqual({ sql: `"id" IN (SELECT value FROM json_each(?))`, params: ["[1,9223372036854775807]"] });
    expect(sqlite.predicate(ids("code", [{ kind: "text", v: `a"\\b` }, { kind: "text", v: "__proto__" }])).params).toEqual([`["a\\"\\\\b","__proto__"]`]);
    expect(sqlite.predicate(ids("id", [big("1")], true)).sql).toBe(`"id" NOT IN (SELECT value FROM json_each(?))`);
  });
});

// Above both engines' bind-parameter limits, so a list that expands into one parameter per id fails.
const MANY = 70_000;
const toPg = (sql: string): string => {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
};

const UID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ROWS = [
  [1, "a", "1.25", UID, "a"],
  [2, "__proto__", "2", null, "b"],
  [3, "constructor", null, null, null],
  [BigInt("9223372036854775807"), "max", null, null, null],
] as const;

describe("ids test on the engines", () => {
  const sqliteDb = new Database(":memory:");
  const pgDb = new PGlite();
  beforeAll(async () => {
    sqliteDb.exec(`CREATE TABLE items ("id" integer PRIMARY KEY, "code" text NOT NULL, "price" text, "uid" text, "kind" text)`);
    const insert = sqliteDb.prepare(`INSERT INTO items VALUES (?, ?, ?, ?, ?)`);
    for (const [id, code, price, uid, kind] of ROWS) insert.run(id, code, price, uid, kind);
    await pgDb.exec(`CREATE TYPE kind_t AS ENUM ('a', 'b'); CREATE TABLE items ("id" int8 PRIMARY KEY, "code" text NOT NULL, "price" numeric, "uid" uuid, "kind" kind_t)`);
    for (const [id, code, price, uid, kind] of ROWS) await pgDb.query(`INSERT INTO items VALUES ($1, $2, $3, $4, $5)`, [id.toString(), code, price, uid, kind]);
  });
  afterAll(async () => {
    sqliteDb.close();
    await pgDb.close();
  });

  const cases: { name: string; where: Predicate; expected: string[] }[] = [
    { name: "int8 ids with the max key", where: ids("id", [big("2"), big("9223372036854775807"), ...Array.from({ length: MANY }, (_, i) => big(String(1000 + i)))]), expected: ["__proto__", "max"] },
    { name: "excluded int8 ids", where: ids("id", [big("1"), big("9223372036854775807")], true), expected: ["__proto__", "constructor"] },
    { name: "text ids", where: { t: "leaf", column: column("code"), test: { k: "ids", values: [{ kind: "text", v: "__proto__" }, { kind: "text", v: "constructor" }], negate: false } }, expected: ["__proto__", "constructor"] },
    { name: "decimal ids", where: ids("price", [{ kind: "number", v: "1.25" }, { kind: "number", v: "2" }]), expected: ["a", "__proto__"] },
    { name: "uuid ids", where: ids("uid", [{ kind: "text", v: UID }]), expected: ["a"] },
    { name: "native enum ids", where: ids("kind", [{ kind: "text", v: "b" }]), expected: ["__proto__"] },
  ];

  it.each(cases)("SQLite: $name", ({ where, expected }) => {
    const { sql, params } = createSqlRenderer(algebra("sqlite"), new Map()).predicate(where);
    expect(params).toHaveLength(1);
    const rows = sqliteDb.prepare(`SELECT "code" FROM items WHERE ${sql} ORDER BY "id"`).all(...params) as { code: string }[];
    expect(rows.map((row) => row.code)).toEqual(expected);
  });

  it.each(cases)("PGlite: $name", async ({ where, expected }) => {
    const { sql, params } = createSqlRenderer(algebra("pg"), new Map()).predicate(where);
    expect(params).toHaveLength(1);
    const { rows } = await pgDb.query<{ code: string }>(`SELECT "code" FROM items WHERE ${toPg(sql)} ORDER BY "id"`, params);
    expect(rows.map((row) => row.code)).toEqual(expected);
  });
});
