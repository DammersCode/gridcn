import { describe, expect, it } from "vitest";
import type { SaveRejection } from "@/registry/default/blocks/data-grid/data-grid";
import { MAX_WRITE_REJECTIONS } from "@/registry/default/blocks/data-grid/store/write-ack";
import { type ColumnMap, type ColumnSpec, defineColumnMap, type WriteRefusal } from "./data-grid-server-query";
import { createGridQuery, mapOf, type Operand, type Predicate, type QueryExecutor } from "./data-grid-server-query-sdk";
import { combine, leaf } from "./plan";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", required: true, maxLength: 5 },
  qty: { type: "number", numeric: "int2" },
  price: { type: "number", numeric: "decimal", scale: 2 },
  status: { type: "select", choices: ["open", "done"] },
  orgId: { type: "number", numeric: "int4", field: "org_id" },
  tenant: { type: "number", numeric: "int4", serverOnly: true, required: true },
  secret: { type: "text", serverOnly: true, required: true },
  tenantAlias: { type: "number", numeric: "int4", field: "tenant" },
  idAlias: { type: "number", numeric: "int8", field: "id" },
});
const { byId } = mapOf(columns);
const keyWhere = (map: ColumnMap, id: string, value: Operand) => leaf(mapOf(map).byId.get(id)!, { k: "exact", value });

const executor = { where: (plan: { where: Predicate }) => plan.where } as unknown as QueryExecutor<Predicate, unknown>;
const scopedQuery = createGridQuery<Record<string, unknown>, { tenant: number; org: number }, Predicate>({
  columns,
  executor,
  rowScope: (context) => ({ tenant: context.tenant, orgId: context.org }),
});
const plainQuery = createGridQuery<Record<string, unknown>, never, Predicate>({ columns, executor });
const context = { context: { tenant: 7, org: 3 } };
const validate = (ops: unknown[]) => scopedQuery.validateChange({ ops, source: "edit" }, context);

const scope = [leaf(byId.get("tenant")!, { k: "exact", value: { kind: "bigint", v: 7n } }), leaf(byId.get("orgId")!, { k: "exact", value: { kind: "bigint", v: 3n } })];
const scopedWhere = (id: bigint) => combine("and", [leaf(byId.get("id")!, { k: "exact", value: { kind: "bigint", v: id } }), ...scope]);
const cell = (columnId: string, value: unknown) => ({ columnId, value, prev: null });

describe("validateChange", () => {
  it("scopes an update by row id and rowScope and keeps the client's row id", () => {
    const result = validate([{ type: "update", rowId: "42", row: {}, prev: {}, cells: [cell("name", "Ada"), cell("qty", "12")] }]);
    expect(result).toEqual({ updates: [{ rowId: "42", values: { name: "Ada", qty: "12" }, where: scopedWhere(42n) }], inserts: [], deletes: [], moves: [], rejected: [] });
  });

  it("refuses each invalid cell", () => {
    const result = validate([
      {
        type: "update",
        rowId: "1",
        row: {},
        prev: {},
        cells: [cell("qty", 40_000), cell("price", "1.234"), cell("status", "x"), cell("name", "toolong"), cell("name", "x".repeat(5000)), cell("name", null), cell("qty", "1.5"), cell("status", "done")],
      },
    ]);
    // `status: "x"` refuses the column, so the later valid `status` entry is not written either.
    expect(result.updates).toEqual([]);
    expect(result.rejected.map((refusal) => [refusal.columnId, refusal.code])).toEqual([
      ["qty", "out-of-range"],
      ["price", "too-many-decimals"],
      ["status", "not-a-choice"],
      ["name", "too-long"],
      ["name", "too-long"],
      ["name", "required"],
      ["qty", "not-a-whole-number"],
    ]);
    expect(result.rejected[0]).toEqual({ rowId: "1", columnId: "qty", code: "out-of-range", message: "Out of range" });
  });

  it("refuses the key and the visible scope column as not-writable", () => {
    const result = validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("id", 2), cell("orgId", 9), cell("name", "Bo")] }]);
    expect(result.updates).toEqual([{ rowId: "1", values: { name: "Bo" }, where: scopedWhere(1n) }]);
    expect(result.rejected).toEqual([
      { rowId: "1", columnId: "id", code: "not-writable", message: "Not writable" },
      { rowId: "1", columnId: "orgId", code: "not-writable", message: "Not writable" },
    ]);
  });

  it("skips unmapped and serverOnly keys alike, a serverOnly scope column included", () => {
    const run = (key: string) => validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell(key, "Bo"), cell("name", "Bo")] }]);
    expect(run("secret")).toEqual(run("nope"));
    expect(run("tenant")).toEqual(run("nope"));
    expect(run("nope").rejected).toEqual([]);
    const insert = (key: string) => validate([{ type: "insert", rowId: "tmp", row: { name: "Bo", [key]: "x".repeat(5000) }, index: 0 }]);
    expect(insert("secret")).toEqual(insert("nope"));
  });

  it("writes the keys of a whole-row update that differ from prev, and skips the row's key", () => {
    const result = validate([{ type: "update", rowId: "5", row: { id: 6, name: "B", qty: 1, nope: 2 }, prev: { id: 5, name: "A", qty: 1, nope: 1 } }]);
    expect(result.updates).toEqual([{ rowId: "5", values: { name: "B" }, where: scopedWhere(5n) }]);
    expect(result.rejected).toEqual([]);
  });

  it("refuses a changed scope column in a whole-row update", () => {
    const result = validate([{ type: "update", rowId: "5", row: { orgId: 4, name: "A" }, prev: { orgId: 3, name: "A" } }]);
    expect(result.updates).toEqual([]);
    expect(result.rejected).toEqual([{ rowId: "5", columnId: "orgId", code: "not-writable", message: "Not writable" }]);
  });

  it("drops an update whose every cell is refused", () => {
    expect(validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("qty", "x")] }]).updates).toEqual([]);
  });

  it("keys values by the physical field", () => {
    const result = plainQuery.validateChange({ ops: [{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("orgId", 9)] }] });
    expect(result.updates).toEqual([{ rowId: "1", values: { org_id: 9 }, where: leaf(byId.get("id")!, { k: "exact", value: { kind: "bigint", v: 1n } }) }]);
  });

  it("writes an insert without the key, with the rowScope values", () => {
    const result = validate([{ type: "insert", rowId: "tmp-1", row: { id: 99, name: "Ada", orgId: 8, status: "open" }, index: 0 }]);
    expect(result.inserts).toEqual([{ rowId: "tmp-1", values: { name: "Ada", status: "open", tenant: 7, org_id: 3 } }]);
    expect(result.rejected).toEqual([]);
  });

  it("drops an insert with a refused cell or a missing required column", () => {
    const result = validate([
      { type: "insert", rowId: "a", row: { status: "open" }, index: 0 },
      { type: "insert", rowId: "b", row: { name: "Ada", qty: "x" }, index: 1 },
    ]);
    expect(result.inserts).toEqual([]);
    expect(result.rejected).toEqual([
      { rowId: "a", columnId: "name", code: "required", message: "Required" },
      { rowId: "b", columnId: "qty", code: "not-a-number", message: "Not a number" },
    ]);
  });

  it("scopes deletes and moves and keeps the neighbor ids", () => {
    const result = validate([
      { type: "delete", rowId: "3", row: {}, index: 0 },
      { type: "move", rowId: "4", row: {}, from: 0, to: 1, beforeRowId: "5", afterRowId: "3" },
      { type: "move", rowId: "6", row: {}, from: 1, to: 0 },
    ]);
    expect(result.deletes).toEqual([{ rowId: "3", where: scopedWhere(3n) }]);
    expect(result.moves).toEqual([
      { rowId: "4", beforeRowId: "5", beforeWhere: scopedWhere(5n), afterRowId: "3", afterWhere: scopedWhere(3n), where: scopedWhere(4n) },
      { rowId: "6", where: scopedWhere(6n) },
    ]);
  });

  it("refuses a move whose neighbor id the key cannot parse", () => {
    const result = validate([
      { type: "move", rowId: "4", row: {}, from: 0, to: 1, beforeRowId: "x" },
      { type: "move", rowId: "5", row: {}, from: 0, to: 1, afterRowId: "" },
    ]);
    expect(result.moves).toEqual([]);
    expect(result.rejected).toEqual([
      { rowId: "4", code: "not-an-id", message: "Not a valid id" },
      { rowId: "5", code: "not-an-id", message: "Not a valid id" },
    ]);
  });

  it("treats a column that aliases the field of the key or a scope column as fixed", () => {
    const update = validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("tenantAlias", 9), cell("idAlias", 2), cell("name", "Bo")] }]);
    expect(update.updates).toEqual([{ rowId: "1", values: { name: "Bo" }, where: scopedWhere(1n) }]);
    expect(update.rejected.map((refusal) => [refusal.columnId, refusal.code])).toEqual([
      ["tenantAlias", "not-writable"],
      ["idAlias", "not-writable"],
    ]);
    const insert = validate([{ type: "insert", rowId: "t", row: { name: "Ada", tenantAlias: 9, idAlias: 2 }, index: 0 }]);
    expect(insert.inserts).toEqual([{ rowId: "t", values: { name: "Ada", tenant: 7, org_id: 3 } }]);
  });

  it("parses a uuid key and a text key from the row id", () => {
    const uuidColumns = defineColumnMap({ id: { type: "text", native: "uuid", primaryKey: true }, name: { type: "text" } });
    const uuidQuery = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: uuidColumns, executor });
    const upper = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    const uuidResult = uuidQuery.validateChange({ ops: [{ type: "delete", rowId: upper }, { type: "delete", rowId: "nope" }] });
    // The id keeps its case, so it matches the stored form on a SQLite text column.
    expect(uuidResult.deletes).toEqual([{ rowId: upper, where: keyWhere(uuidColumns, "id", { kind: "text", v: upper }) }]);
    expect(uuidResult.rejected).toEqual([{ rowId: "nope", code: "not-an-id", message: "Not a valid id" }]);
    const textColumns = defineColumnMap({ code: { type: "text", primaryKey: true } });
    const textQuery = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: textColumns, executor });
    expect(textQuery.validateChange({ ops: [{ type: "delete", rowId: "abc" }] }).deletes).toEqual([{ rowId: "abc", where: keyWhere(textColumns, "code", { kind: "text", v: "abc" }) }]);
  });

  it("parses a decimal, a float, and a date key from the row id", () => {
    const keyed = (spec: ColumnSpec, rowId: string) => {
      const map = defineColumnMap({ k: spec });
      return { map, deletes: createGridQuery<Record<string, unknown>, never, Predicate>({ columns: map, executor }).validateChange({ ops: [{ type: "delete", rowId }] }).deletes };
    };
    const decimal = keyed({ type: "number", numeric: "decimal", primaryKey: true }, "1.50");
    expect(decimal.deletes).toEqual([{ rowId: "1.50", where: keyWhere(decimal.map, "k", { kind: "number", v: "1.5" }) }]);
    const float = keyed({ type: "number", numeric: "float", primaryKey: true }, "2.5e1");
    expect(float.deletes).toEqual([{ rowId: "2.5e1", where: keyWhere(float.map, "k", { kind: "number", v: "25" }) }]);
    const date = keyed({ type: "date", primaryKey: true }, "2024-02-29");
    expect(date.deletes).toEqual([{ rowId: "2024-02-29", where: keyWhere(date.map, "k", { kind: "date", v: "2024-02-29" }) }]);
  });

  it("compares a key and never validates it: a select key outside choices, a text key over maxLength, an empty text key", () => {
    const keyed = (spec: ColumnSpec, rowId: string) => {
      const map = defineColumnMap({ k: spec, name: { type: "text" } });
      const query = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: map, executor });
      return { map, change: query.validateChange({ ops: [{ type: "update", rowId, row: {}, prev: {}, cells: [cell("name", "x")] }] }) };
    };
    const select = keyed({ type: "select", choices: ["a"], primaryKey: true }, "legacy");
    expect(select.change.updates).toEqual([{ rowId: "legacy", values: { name: "x" }, where: keyWhere(select.map, "k", { kind: "text", v: "legacy" }) }]);
    const long = keyed({ type: "text", maxLength: 2, primaryKey: true }, "abcdef");
    expect(long.change.updates).toEqual([{ rowId: "abcdef", values: { name: "x" }, where: keyWhere(long.map, "k", { kind: "text", v: "abcdef" }) }]);
    const empty = keyed({ type: "text", primaryKey: true }, "");
    expect(empty.change.updates).toEqual([{ rowId: "", values: { name: "x" }, where: keyWhere(empty.map, "k", { kind: "text", v: "" }) }]);
    expect(keyed({ type: "text", primaryKey: true }, "a".repeat(1001)).change.rejected).toEqual([{ rowId: "a".repeat(1001), code: "not-an-id", message: "Not a valid id" }]);
    const scaled = keyed({ type: "number", numeric: "decimal", scale: 2, primaryKey: true }, "1.234");
    expect(scaled.change.updates).toEqual([{ rowId: "1.234", values: { name: "x" }, where: keyWhere(scaled.map, "k", { kind: "number", v: "1.234" }) }]);
  });

  it("refuses an over-long uuid, date, or checkbox key per operation, never the whole change", () => {
    const long = "1".repeat(1001);
    for (const spec of [{ type: "text", native: "uuid" }, { type: "date" }, { type: "checkbox" }] as const) {
      const query = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: defineColumnMap({ k: { ...spec, primaryKey: true } }), executor });
      expect(query.validateChange({ ops: [{ type: "delete", rowId: long }] }).rejected).toEqual([{ rowId: long, code: "not-an-id", message: "Not a valid id" }]);
    }
  });

  it("refuses a key whose exponent outgrows any stored number, and keeps a float key short", () => {
    const keyed = (spec: ColumnSpec, rowId: string) =>
      createGridQuery<Record<string, unknown>, never, Predicate>({ columns: defineColumnMap({ k: spec }), executor }).validateChange({ ops: [{ type: "delete", rowId }] });
    const decimal: ColumnSpec = { type: "number", numeric: "decimal", primaryKey: true };
    for (const rowId of ["1e9999", "1e-9999"]) expect(keyed(decimal, rowId).rejected).toEqual([{ rowId, code: "not-an-id", message: "Not a valid id" }]);
    const float = keyed({ type: "number", numeric: "float", primaryKey: true }, "1e-300");
    expect(float.deletes[0]?.where).toMatchObject({ t: "leaf", test: { value: { kind: "number", v: "1e-300" } } });
  });

  it("refuses a whole-row update with any refused value and keeps the valid cells of a cells update", () => {
    const whole = validate([{ type: "update", rowId: "1", row: { name: "Bo", qty: "x" }, prev: { name: "A", qty: 1 } }]);
    expect(whole.updates).toEqual([]);
    expect(whole.rejected).toEqual([{ rowId: "1", columnId: "qty", code: "not-a-number", message: "Not a number" }]);
    const cells = validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("name", "Bo"), cell("qty", "x")] }]);
    expect(cells.updates).toEqual([{ rowId: "1", values: { name: "Bo" }, where: scopedWhere(1n) }]);
  });

  it("writes no entry of a column that a repeated cells entry refuses, before or after the valid one", () => {
    const before = validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("qty", "2"), cell("qty", "x"), cell("name", "Bo")] }]);
    const after = validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("qty", "x"), cell("qty", "2"), cell("name", "Bo")] }]);
    for (const result of [before, after]) {
      expect(result.updates).toEqual([{ rowId: "1", values: { name: "Bo" }, where: scopedWhere(1n) }]);
      expect(result.rejected).toEqual([{ rowId: "1", columnId: "qty", code: "not-a-number", message: "Not a number" }]);
    }
  });

  it("writes the last entry between two column ids that share a field", () => {
    const map = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, name: { type: "text" }, label: { type: "text", field: "name" } });
    const query = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: map, executor });
    const result = query.validateChange({ ops: [{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("name", "a"), cell("label", "b"), cell("name", "c")] }] });
    expect(result.updates.map((update) => update.values)).toEqual([{ name: "c" }]);
  });

  it("checks date and checkbox cells", () => {
    const map = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, day: { type: "date" }, at: { type: "date", time: true }, done: { type: "checkbox" } });
    const query = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: map, executor });
    const result = query.validateChange({
      ops: [
        { type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("day", "2024-01-31"), cell("at", "2024-01-31T10:00:00Z"), cell("done", "TRUE")] },
        { type: "update", rowId: "2", row: {}, prev: {}, cells: [cell("day", "2024-02-30"), cell("done", 3)] },
      ],
    });
    expect(result.updates.map((update) => update.values)).toEqual([{ day: "2024-01-31", at: "2024-01-31T10:00:00.000Z", done: true }]);
    expect(result.rejected.map((refusal) => refusal.code)).toEqual(["not-a-date", "not-a-boolean"]);
  });

  it("writes the parsed rowScope values on insert", () => {
    const map = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, active: { type: "checkbox", serverOnly: true }, org: { type: "text", native: "uuid", serverOnly: true }, big: { type: "number", numeric: "int8", serverOnly: true } });
    const query = createGridQuery<Record<string, unknown>, { org: string }, Predicate>({ columns: map, executor, rowScope: (scopeContext) => ({ active: "TRUE", org: scopeContext.org, big: 9_007_199_254_740_993n }) });
    const upper = "0F8FAD5B-D9CB-469F-A165-70867728950E";
    expect(query.validateChange({ ops: [{ type: "insert", rowId: "t", row: {} }] }, { context: { org: upper } }).inserts).toEqual([{ rowId: "t", values: { active: true, org: upper.toLowerCase(), big: "9007199254740993" } }]);
  });

  it("keeps __proto__ and constructor as plain keys", () => {
    const map = defineColumnMap(JSON.parse('{"id":{"type":"text","primaryKey":true},"__proto__":{"type":"text"},"constructor":{"type":"text"}}') as Record<string, { type: "text" }>);
    const query = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: map, executor });
    const ops = JSON.parse('[{"type":"update","rowId":"__proto__","row":{},"prev":{},"cells":[{"columnId":"__proto__","value":"a"},{"columnId":"constructor","value":"b"}]},{"type":"insert","rowId":"constructor","row":{"__proto__":"c","constructor":"d","toString":"e"}}]') as unknown[];
    const result = query.validateChange({ ops });
    const [update] = result.updates;
    expect(Object.getPrototypeOf(update?.values)).toBe(Object.prototype);
    expect(Object.keys(update?.values ?? {})).toEqual(["__proto__", "constructor"]);
    expect(update?.where).toEqual(keyWhere(map, "id", { kind: "text", v: "__proto__" }));
    const [insert] = result.inserts;
    expect(Object.getPrototypeOf(insert?.values)).toBe(Object.prototype);
    expect(Object.entries(insert?.values ?? {})).toEqual([["__proto__", "c"], ["constructor", "d"]]);
    const plain = validate(JSON.parse('[{"type":"update","rowId":"1","row":{"__proto__":"x","constructor":"y"},"prev":{}}]') as unknown[]);
    expect(plain).toEqual({ updates: [], inserts: [], deletes: [], moves: [], rejected: [] });
  });

  it("refuses an int8 overflow or an over-long key or neighbor id per operation, and throws limit-exceeded on an over-long value", () => {
    for (const rowId of ["9223372036854775808", "1".repeat(41)]) expect(validate([{ type: "delete", rowId }]).rejected).toEqual([{ rowId, code: "not-an-id", message: "Not a valid id" }]);
    for (const neighbor of ["beforeRowId", "afterRowId"]) {
      expect(validate([{ type: "move", rowId: "1", [neighbor]: "1".repeat(1001) }]).rejected).toEqual([{ rowId: "1", code: "not-an-id", message: "Not a valid id" }]);
    }
    expect(() => validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("qty", "1".repeat(41))] }])).toThrow(expect.objectContaining({ code: "limit-exceeded" }));
  });

  it("skips a serverOnly number cell before any length check", () => {
    expect(validate([{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("tenant", "9".repeat(500)), cell("name", "Bo")] }]).rejected).toEqual([]);
  });

  it("throws limit-exceeded over the grid's rejection bound", () => {
    const refusing = (count: number) => Array.from({ length: count }, (_, index) => ({ type: "update", rowId: String(index + 1), row: {}, prev: {}, cells: [cell("qty", "x"), cell("price", "x")] }));
    expect(validate(refusing(MAX_WRITE_REJECTIONS / 2)).rejected).toHaveLength(MAX_WRITE_REJECTIONS);
    expect(() => validate([...refusing(MAX_WRITE_REJECTIONS / 2), { type: "delete", rowId: "x" }])).toThrow(expect.objectContaining({ code: "limit-exceeded", path: ["ops"] }));
  });

  it("counts each written row id without a refusal once against the bound, since each can still answer not-found", () => {
    const refusing = Array.from({ length: MAX_WRITE_REJECTIONS / 2 - 1 }, (_, index) => ({ type: "update", rowId: String(index + 1), row: {}, prev: {}, cells: [cell("qty", "x"), cell("price", "x")] }));
    const clean = (...rowIds: string[]) => rowIds.map((rowId) => ({ type: "delete", rowId }));
    expect(validate([...refusing, ...clean("90001", "90002"), { type: "move", rowId: "90001" }, ...clean("1")]).rejected).toHaveLength(MAX_WRITE_REJECTIONS - 2);
    expect(() => validate([...refusing, ...clean("90001", "90002", "90003")])).toThrow(expect.objectContaining({ code: "limit-exceeded", path: ["ops"] }));
  });

  it("refuses every column of a field when one column of the field is refused", () => {
    const map = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, name: { type: "text" }, label: { type: "text", field: "name", maxLength: 2 }, qty: { type: "number", numeric: "int4" } });
    const query = createGridQuery<Record<string, unknown>, never, Predicate>({ columns: map, executor });
    const result = query.validateChange({ ops: [{ type: "update", rowId: "1", row: {}, prev: {}, cells: [cell("name", "Bo"), cell("label", "long"), cell("qty", 2)] }] });
    expect(result.updates.map((update) => update.values)).toEqual([{ qty: 2 }]);
    expect(result.rejected).toEqual([
      { rowId: "1", columnId: "label", code: "too-long", message: "Too long" },
      { rowId: "1", columnId: "name", code: "too-long", message: "Too long" },
    ]);
  });

  it("refuses a row id the key cannot parse", () => {
    const result = validate([
      { type: "delete", rowId: "abc", row: {}, index: 0 },
      { type: "update", rowId: "", row: {}, prev: {}, cells: [cell("name", "Bo")] },
    ]);
    expect(result.deletes).toEqual([]);
    expect(result.updates).toEqual([]);
    expect(result.rejected).toEqual([
      { rowId: "abc", code: "not-an-id", message: "Not a valid id" },
      { rowId: "", code: "not-an-id", message: "Not a valid id" },
    ]);
  });

  it("without rowScope, scopes by the key only and lets the scope columns be written", () => {
    const result = plainQuery.validateChange({ ops: [{ type: "insert", rowId: "t", row: { name: "Ada", orgId: 8 }, index: 0 }] });
    expect(result.inserts).toEqual([{ rowId: "t", values: { name: "Ada", org_id: 8 } }]);
  });

  it("throws invalid-request on a malformed change", () => {
    const bad: unknown[] = [
      null,
      { ops: "x" },
      { ops: [null] },
      { ops: [{ type: "upsert", rowId: "1" }] },
      { ops: [{ type: "delete", rowId: 1 }] },
      { ops: [{ type: "update", rowId: "1", row: [], prev: {} }] },
      { ops: [{ type: "update", rowId: "1", row: {}, prev: {}, cells: {} }] },
      { ops: [{ type: "update", rowId: "1", row: {}, prev: {}, cells: [{ columnId: 1, value: 1 }] }] },
      { ops: [{ type: "insert", rowId: "1", row: null }] },
      { ops: [{ type: "move", rowId: "1", beforeRowId: 5 }] },
    ];
    for (const input of bad) expect(() => scopedQuery.validateChange(input, context)).toThrow(expect.objectContaining({ code: "invalid-request" }));
  });

  it("accepts 10,000 ops and throws limit-exceeded over maxChangeOps", () => {
    const deletes = (count: number) => Array.from({ length: count }, (_, index) => ({ type: "delete", rowId: String(index), row: {}, index }));
    expect(validate(deletes(10_000)).deletes).toHaveLength(10_000);
    expect(() => validate(deletes(10_001))).toThrow(expect.objectContaining({ code: "limit-exceeded" }));
    const tight = createGridQuery<Record<string, unknown>, never, Predicate>({ columns, executor, limits: { maxChangeOps: 2 } });
    expect(() => tight.validateChange({ ops: deletes(3) })).toThrow(expect.objectContaining({ code: "limit-exceeded" }));
  });

  it("throws unsupported on a map without a primaryKey", () => {
    const tieBreakerMap = defineColumnMap({ a: { type: "text" }, b: { type: "text" } }, { tieBreaker: ["a", "b"] });
    const query = createGridQuery({ columns: tieBreakerMap, executor });
    expect(() => query.validateChange({ ops: [] })).toThrow(expect.objectContaining({ code: "unsupported" }));
  });

  it("needs context when rowScope is set", () => {
    expect(() => (scopedQuery.validateChange as (input: unknown) => unknown)({ ops: [] })).toThrow("rowScope is set");
  });

  it("returns refusals that assign to SaveRejection", () => {
    const refusal: WriteRefusal = { rowId: "1", code: "not-writable", message: "Not writable" };
    const rejection: SaveRejection = refusal;
    expect(rejection.rowId).toBe("1");
  });
});
