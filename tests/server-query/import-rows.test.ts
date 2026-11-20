// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defineColumnMap, IMPORT_REFUSAL_MESSAGES, parseImportRows, QueryError } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", required: true, maxLength: 10 },
  tag: { type: "select", choices: ["red", "green"] },
  qty: { type: "number", numeric: "int4" },
  score: { type: "number", numeric: "float" },
  price: { type: "number", numeric: "decimal", scale: 2 },
  active: { type: "checkbox" },
  born: { type: "date" },
  seen: { type: "date", time: true },
  ref: { type: "text", native: "uuid" },
  tenantId: { type: "number", numeric: "int4", serverOnly: true },
});

const parse = (rows: unknown, limits?: Parameters<typeof parseImportRows>[1]["limits"]) => parseImportRows({ rows }, { columns, limits });
const refusal = (rows: unknown) => parse(rows).rejected;
const errorOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error as QueryError;
  }
  return undefined;
};

describe("parseImportRows bounds", () => {
  it("refuses a body that is not { rows: [] }", () => {
    for (const body of [null, "x", [], {}, { rows: {} }, { rows: "x" }]) {
      expect(errorOf(() => parseImportRows(body, { columns }))?.code).toBe("invalid-request");
    }
  });

  it("refuses a row that is not an object", () => {
    for (const row of [null, 3, "x", []]) expect(errorOf(() => parse([row]))?.code).toBe("invalid-request");
  });

  it("accepts 10,000 rows and refuses 10,001 before reading a value", () => {
    const row = { name: "a" };
    expect(parse(Array.from({ length: 10_000 }, () => row)).rows).toHaveLength(10_000);
    const error = errorOf(() => parse(Array.from({ length: 10_001 }, () => ({ name: Number.POSITIVE_INFINITY }))));
    expect(error).toMatchObject({ code: "limit-exceeded", path: ["rows"] });
  });

  it("takes maxImportRows from the limits", () => {
    expect(errorOf(() => parse([{ name: "a" }, { name: "b" }], { maxImportRows: 1 }))?.code).toBe("limit-exceeded");
  });

  it("refuses an unknown key and a serverOnly key without echoing the value", () => {
    expect(errorOf(() => parse([{ name: "a", nope: 1 }]))).toMatchObject({ code: "unknown-column", path: ["rows", 0, "nope"] });
    expect(errorOf(() => parse([{ name: "a" }, { name: "a", tenantId: 1 }]))).toMatchObject({ code: "unknown-column", path: ["rows", 1, "tenantId"] });
    expect(errorOf(() => parse([JSON.parse('{"__proto__": {"x": 1}, "name": "a"}')]))?.code).toBe("unknown-column");
  });

  it("refuses text over maxValueLength and number text over maxNumberLength", () => {
    expect(errorOf(() => parse([{ ref: "x".repeat(1001) }]))?.code).toBe("limit-exceeded");
    expect(errorOf(() => parse([{ name: "a", qty: "1".repeat(41) }]))?.code).toBe("limit-exceeded");
    expect(errorOf(() => parse([{ name: "a", born: "2".repeat(2000) }]))?.code).toBe("limit-exceeded");
  });
});

describe("parseImportRows values", () => {
  it("passes valid rows through with canonical values", () => {
    const answer = parse([{ id: 7, name: "Ann", tag: "red", qty: "12", score: 1.5, price: "3.10", active: "true", born: "2024-02-29", seen: "2024-01-01 10:00:00+01:00", ref: "ABCDEF01-2345-6789-ABCD-EF0123456789" }]);
    expect(answer.rejected).toEqual([]);
    expect(answer.rows).toEqual([
      { id: 7, name: "Ann", tag: "red", qty: "12", score: 1.5, price: "3.1", active: true, born: "2024-02-29", seen: "2024-01-01T09:00:00.000Z", ref: "abcdef01-2345-6789-abcd-ef0123456789" },
    ]);
  });

  it("turns blank values into null", () => {
    expect(parse([{ name: "a", tag: "", qty: null, born: undefined }]).rows).toEqual([{ name: "a", tag: null, qty: null, born: null }]);
  });

  it("keeps a row with a refused cell out of rows and names the cell", () => {
    const answer = parse([{ name: "ok" }, { name: "x", qty: "abc" }, { name: "ok2" }]);
    expect(answer.rows).toEqual([{ name: "ok" }, { name: "ok2" }]);
    expect(answer.rejected).toEqual([{ rowIndex: 1, columnId: "qty", code: "not-a-number", message: "Not a number" }]);
  });

  it.each([
    ["a fractional int", { qty: 1.5 }],
    ["an int over int4", { qty: 2 ** 31 }],
    ["an int text over int4", { qty: "2147483648" }],
    ["NaN text", { score: "NaN" }],
    ["a non-finite number", { score: Infinity }],
    ["too many decimals", { price: "1.005" }],
    ["a choice outside the list", { tag: "blue" }],
    ["a number for text", { name: 5 }],
    ["text over the column maxLength", { name: "12345678901" }],
    ["a bad date", { born: "2024-02-30" }],
    ["a date for an instant", { seen: "2024-01-01" }],
    ["an instant without an offset", { seen: "2024-01-01T10:00:00" }],
    ["a bad checkbox", { active: "maybe" }],
    ["a bad uuid", { ref: "not-a-uuid" }],
    ["an object", { qty: {} }],
  ])("refuses %s", (_name, cells) => {
    const answer = parse([{ name: "a", ...cells }]);
    expect(answer.rows).toEqual([]);
    expect(answer.rejected).toHaveLength(1);
    expect(answer.rejected[0]).toMatchObject({ rowIndex: 0, columnId: Object.keys(cells)[0] });
  });

  it("refuses a required column that is blank or missing, but not a missing primary key", () => {
    expect(refusal([{ name: "" }])).toEqual([{ rowIndex: 0, columnId: "name", code: "required", message: "Required" }]);
    expect(refusal([{ qty: 1 }])).toEqual([{ rowIndex: 0, columnId: "name", code: "required", message: "Required" }]);
    expect(refusal([{ name: "a" }])).toEqual([]);
  });

  it("writes a mapped __proto__ column as a plain own key", () => {
    const protoKeyed = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, ["__proto__"]: { type: "text" } });
    const [row] = parseImportRows({ rows: [JSON.parse('{"__proto__": "x"}')] }, { columns: protoKeyed }).rows;
    expect(Object.hasOwn(row!, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(row!, "__proto__")?.value).toBe("x");
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });

  it("refuses a number that expands beyond maxNumberLength digits, and a raised limit accepts it", () => {
    const amounts = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, amount: { type: "number", numeric: "decimal" }, qty: { type: "number", numeric: "int4" }, score: { type: "number", numeric: "float" } });
    const read = (cells: Record<string, unknown>, limits?: { maxNumberLength: number }) => parseImportRows({ rows: [cells] }, { columns: amounts, limits });
    for (const amount of ["1e9999", "1e-9999", "1e40", "1e-41"]) expect(read({ amount }).rejected).toMatchObject([{ code: "out-of-range" }]);
    expect(read({ qty: "1e9999" }).rejected).toMatchObject([{ code: "out-of-range" }]);
    for (const qty of ["1e-50", "1e-9999"]) expect(read({ qty }).rejected).toMatchObject([{ code: "not-a-whole-number" }]);
    for (const price of ["1e-50", "1e-9999"]) expect(refusal([{ name: "a", price }])).toMatchObject([{ code: "too-many-decimals" }]);
    expect(read({ amount: `1.${"0".repeat(35)}e-9`, qty: `1.${"0".repeat(35)}e2`, score: "1e-300" }).rows).toEqual([{ amount: "0.000000001", qty: "100", score: 1e-300 }]);
    expect(read({ amount: "1e50" }, { maxNumberLength: 60 }).rows).toEqual([{ amount: `1${"0".repeat(50)}` }]);
  });

  it("answers in the shape checkImport reads", () => {
    const { rejected } = parse([{ name: "a", qty: "x" }]);
    expect(JSON.parse(JSON.stringify({ rejected }))).toEqual({ rejected: [{ rowIndex: 0, columnId: "qty", code: "not-a-number", message: "Not a number" }] });
  });
});

describe("refusal codes", () => {
  it("keys the English message by the code", () => {
    const { rejected } = parse([{ name: "a", qty: "x" }, { name: "" }]);
    expect(rejected.map((refusal) => refusal.code)).toEqual(["not-a-number", "required"]);
    for (const refusal of rejected) expect(refusal.message).toBe(IMPORT_REFUSAL_MESSAGES[refusal.code!]);
  });
});
