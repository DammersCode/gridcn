// @vitest-environment node
import { describe, expect, it } from "vitest";
import { operatorsForColumnType } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_FILTER_GROUP_DEPTH } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { defineColumnMap } from "./column-map";
import { assertCustomOperatorHandlers, createGridQuery, type GroupsAnswer, type QueryExecutor, type RowsAnswer } from "./create-grid-query";
import { defaultOperatorsFor, describeFilterOperators } from "./describe-filter-operators";
import { QueryError } from "./errors";
import { handleGridRequest } from "./handle-grid-request";
import { escapeLike, likePattern } from "./like";
import { MAX_FILTER_DEPTH } from "./parse-query";
import type { GroupsPlan } from "./plan";
import { ceilDecimal, decimalToString, floorDecimal, isInteger, isSubMillisecond, nextDay, parseDate, parseDecimal, parseInstant, parseUuid, startOfLocalDay } from "./operands";
import { parseImportRows } from "./parse-import-rows";
import { rowScopePredicate } from "./row-scope";
import { serializeRow, serializeValue, instantText } from "./serialize-row";
import { withColumnMap } from "./with-column-map";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", searchable: true },
  qty: { type: "number", numeric: "int4", aggregate: "sum" },
  price: { type: "number", numeric: "decimal", scale: 2 },
  note: { type: "number", numeric: "decimal" },
  seen: { type: "date", time: true, storage: "epoch-s" },
  born: { type: "date" },
  active: { type: "checkbox" },
  tenant: { type: "number", numeric: "int4", serverOnly: true },
  tenantName: { type: "text", serverOnly: true },
  tenantId8: { type: "number", numeric: "int8", serverOnly: true },
});

describe("defineColumnMap", () => {
  it("needs numeric on number columns and a way to order rows", () => {
    expect(() => defineColumnMap({ id: { type: "number", primaryKey: true } })).toThrow(/numeric/);
    expect(() => defineColumnMap({ id: { type: "text" } })).toThrow(/primaryKey/);
    expect(() => defineColumnMap({ id: { type: "text", primaryKey: true, serverOnly: true } })).toThrow(/serverOnly/);
    expect(() => defineColumnMap({ a: { type: "text", primaryKey: true }, b: { type: "text", primaryKey: true } })).toThrow(/at most one/);
    expect(() => defineColumnMap({ a: { type: "text" }, b: { type: "text", serverOnly: true } }, { tieBreaker: ["a", "b"] })).toThrow(/serverOnly/);
    expect(() => defineColumnMap({ a: { type: "text", searchable: true }, d: { type: "date", searchable: true } }, { tieBreaker: ["a"] })).toThrow(/searchable/);
    expect(() => defineColumnMap({ a: { type: "wat" } }, { tieBreaker: ["a"] })).toThrow(/kind/);
    expect(defineColumnMap({ a: { type: "wat", kind: "text" }, b: { type: "text" } }, { tieBreaker: ["a", "b"] })).toBeDefined();
  });

  it("rejects scale on a non-decimal and a native enum without choices", () => {
    expect(() => defineColumnMap({ id: { type: "number", numeric: "int4", scale: 2, primaryKey: true } })).toThrow(/scale/);
    expect(() => defineColumnMap({ id: { type: "text", primaryKey: true, native: "enum" } })).toThrow(/choices/);
    expect(() => defineColumnMap({ id: { type: "text", primaryKey: true, aggregate: "sum" } })).toThrow(/sum/);
  });
});

describe("describeFilterOperators", () => {
  it("lists what the server accepts and never a serverOnly column", () => {
    const description = describeFilterOperators(columns);
    expect(Object.keys(description)).toEqual(["id", "name", "qty", "price", "note", "seen", "born", "active"]);
    expect(description["qty"]!.operators).not.toContain("contains");
    expect(description["qty"]!.operators).toContain("gt");
    expect(description["active"]!.operators).toEqual(["equals", "notEquals", "empty", "notEmpty"]);
    expect(description["name"]!.operators).toContain("startsWith");
  });

  it("copies the client operator lists", () => {
    for (const name of ["number", "date", "select", "text", "url", "longText", "checkbox", undefined]) expect(defaultOperatorsFor(name ?? "text")).toEqual(operatorsForColumnType(name));
  });

  it("uses the client's group depth", () => {
    expect(MAX_FILTER_DEPTH).toBe(MAX_FILTER_GROUP_DEPTH);
  });
});

describe("withColumnMap", () => {
  it("merges operators and blocks columns the descriptor lacks", () => {
    const merged = withColumnMap([{ id: "qty" }, { id: "computed" }, { id: "toString" }], describeFilterOperators(columns));
    expect(merged[0]).toMatchObject({ filterable: true, sortable: true });
    expect(merged[0]!.filterOperators).not.toContain("contains");
    expect(merged[1]).toMatchObject({ filterable: false, sortable: false });
    expect(merged[2]).toMatchObject({ filterable: false, sortable: false });
  });
});

describe("operands", () => {
  it("parses the HTML number grammar", () => {
    for (const ok of ["1", "-1", ".5", "1.5", "1e5", "1E-5", "-0"]) expect(parseDecimal(ok)).not.toBeNull();
    for (const bad of ["", "+1", "1.", "0x1", "1,5", " 1", "1e", "1e12345", "--1", "1e+"]) expect(parseDecimal(bad)).toBeNull();
    expect(decimalToString(parseDecimal("1.2300e2")!)).toBe("123");
    expect(decimalToString(parseDecimal("-0.0")!)).toBe("0");
    expect(decimalToString(parseDecimal("5e-3")!)).toBe("0.005");
    expect(decimalToString(parseDecimal("12e1")!)).toBe("120");
  });

  it("floors and ceils exactly", () => {
    const [floor, ceil] = [(t: string) => floorDecimal(parseDecimal(t)!), (t: string) => ceilDecimal(parseDecimal(t)!)];
    expect([floor("2.5"), ceil("2.5"), floor("-2.5"), ceil("-2.5"), floor("3"), ceil("3"), floor("1e-3"), ceil("-1e-3")]).toEqual([2n, 3n, -3n, -2n, 3n, 3n, 0n, 0n]);
    expect(isInteger(parseDecimal("4.0")!)).toBe(true);
    expect(isInteger(parseDecimal("4.1")!)).toBe(false);
    expect(floor("9223372036854775808")).toBe(9223372036854775808n);
  });

  it("validates dates, instants, and uuids", () => {
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect([parseDate("2023-02-29"), parseDate("2024-13-01"), parseDate("2024-1-1"), parseDate("2024-01-01 ")]).toEqual([null, null, null, null]);
    expect(parseInstant("2024-01-01 10:00:00.5-05:00")).toBe("2024-01-01T15:00:00.500Z");
    expect([parseInstant("2024-01-01T25:00:00Z"), parseInstant("2024-01-01T10:00:00"), parseInstant("junk")]).toEqual([null, null, null]);
    expect(parseUuid("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(parseUuid("0f8fad5b")).toBeNull();
  });

  it("keeps an instant exact to the millisecond and refuses a nonzero digit past it", () => {
    expect(parseInstant("2024-01-01T00:00:00.1230Z")).toBe("2024-01-01T00:00:00.123Z");
    expect(parseInstant("2024-01-01T00:00:00.123000000+00:00")).toBe("2024-01-01T00:00:00.123Z");
    for (const fraction of ["1231", "12301", "123456", "1230001", "12300001", "123000001", "999999999"]) {
      expect(parseInstant(`2024-01-01T00:00:00.${fraction}Z`)).toBeNull();
      expect(isSubMillisecond(`2024-01-01T00:00:00.${fraction}Z`)).toBe(true);
    }
    expect(isSubMillisecond("2024-01-01 00:00:00.123456+00")).toBe(true);
    for (const exact of ["2024-01-01T00:00:00.123000Z", "2024-01-01T00:00:00Z", "junk"]) expect(isSubMillisecond(exact)).toBe(false);
    const hostile = `2024-01-01T00:00:00.${"1".repeat(100_000)}Z`;
    expect([parseInstant(hostile), isSubMillisecond(hostile), parseInstant("2024-01-01T00:00:00.1234567891Z")]).toEqual([null, true, null]);
  });

  it("finds a digit past the millisecond in every text shape a stored key takes, with or without a zone", () => {
    for (const digits of [4, 5, 6, 7, 8, 9]) {
      const fraction = `123${"0".repeat(digits - 4)}1`;
      for (const zone of ["", "Z", "+00", "+02:00", "-0530"]) {
        for (const separator of ["T", " "]) {
          expect(isSubMillisecond(`2024-01-01${separator}10:00:00.${fraction}${zone}`)).toBe(true);
          expect(isSubMillisecond(`2024-01-01${separator}10:00:00.${"1230000000".slice(0, digits)}${zone}`)).toBe(false);
        }
      }
    }
  });

  it("refuses a group key without a zone that holds a digit past the millisecond", async () => {
    const stamped = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, at: { type: "date", time: true } });
    for (const key of ["2024-01-01 10:00:00.123456", "2024-01-01T10:00:00.1230001"]) {
      const { executor } = fakeExecutor();
      executor.selectGroups = async () => [{ key, count: 1, childCount: 0, aggregates: {} }];
      const query = createGridQuery({ columns: stamped, executor });
      await expect(query.fetchRows({ spec: { groupBy: ["at"] }, childKind: "groups", start: 0, end: 10 })).rejects.toMatchObject({ code: "unsupported", path: ["spec", "groupBy", "at"] });
    }
  });

  it("refuses an epoch-s import or write value with a fraction of a second", () => {
    expect(() => parseImportRows({ rows: [{ seen: "2024-01-01T00:00:00.500Z" }] }, { columns })).toThrow(expect.objectContaining({ code: "unsupported-value" }));
    expect(parseImportRows({ rows: [{ seen: "2024-01-01T00:00:01.000Z" }] }, { columns }).rows).toEqual([{ seen: "2024-01-01T00:00:01.000Z" }]);
  });

  it("parses an instant in linear time, a hostile text no slower than a valid one", () => {
    const time = (text: string) => {
      const started = performance.now();
      for (let i = 0; i < 100_000; i++) parseInstant(text);
      return performance.now() - started;
    };
    const baseline = time("2024-01-01T00:00:00.123Z");
    for (const hostile of [`2024-01-01T00:00:00.${"1".repeat(5_000)}`, `2024-01-01T00:00:${"0".repeat(5_000)}Z`, "2024-01-01T".repeat(500)]) {
      expect(time(hostile)).toBeLessThan(baseline * 3 + 20);
    }
  });

  it("refuses an import or write with a nonzero digit past the millisecond", () => {
    const codesOf = (seen: string) => parseImportRows({ rows: [{ seen }] }, { columns }).rejected.map((entry) => entry.code);
    expect(codesOf("2024-01-01T00:00:00.123456Z")).toEqual(["too-many-decimals"]);
    expect(codesOf("2024-01-01T00:00:01.000000Z")).toEqual([]);
  });

  it("computes local day bounds across DST and in far offsets", () => {
    expect(startOfLocalDay("2024-03-31", "Europe/Berlin")).toBe("2024-03-30T23:00:00.000Z");
    expect(startOfLocalDay("2024-04-01", "Europe/Berlin")).toBe("2024-03-31T22:00:00.000Z");
    expect(startOfLocalDay("2024-10-27", "Europe/Berlin")).toBe("2024-10-26T22:00:00.000Z");
    expect(startOfLocalDay("2024-01-01", "UTC")).toBe("2024-01-01T00:00:00.000Z");
    expect(startOfLocalDay("2024-01-01", "Pacific/Kiritimati")).toBe("2023-12-31T10:00:00.000Z");
    expect(startOfLocalDay("2024-03-10", "America/Havana")).toBe("2024-03-10T05:00:00.000Z");
    expect(nextDay("2024-12-31")).toBe("2025-01-01");
    expect(nextDay("2024-02-28")).toBe("2024-02-29");
  });
});

describe("like", () => {
  it("escapes wildcards and the escape character", () => {
    expect(escapeLike("50%_!")).toBe("50!%!_!!");
    expect(likePattern("startsWith", "a%")).toBe("a!%%");
    expect(likePattern("endsWith", "a")).toBe("%a");
    expect(likePattern("equals", "a_b")).toBe("a!_b");
    expect(escapeLike("a\\b", "\\")).toBe("a\\\\b");
  });
});

describe("row scope", () => {
  const throwsFor = (value: unknown, key = "tenant") => expect(() => rowScopePredicate(columns, { [key]: value })).toThrow();

  it("builds exact tests", () => {
    expect(rowScopePredicate(columns, { tenant: 7 })).toMatchObject({ t: "leaf", test: { k: "exact", value: { kind: "bigint", v: 7n } } });
    expect(rowScopePredicate(columns, { tenant: 7, tenantName: "Acme" }).t).toBe("and");
    expect(rowScopePredicate(columns, { tenantId8: 5n })).toMatchObject({ test: { value: { v: 5n } } });
  });

  it("fails closed", () => {
    for (const bad of [undefined, null, Number.NaN, "", "  ", 1.5, 2 ** 40, "7", {}, [], true]) throwsFor(bad);
    throwsFor(undefined, "tenantName");
    throwsFor(null, "tenantName");
    throwsFor("   ", "tenantName");
    throwsFor(12, "tenantName");
    throwsFor(1n);
    throwsFor(1, "unmapped");
    throwsFor(Number.MAX_SAFE_INTEGER + 2, "tenantId8");
    throwsFor("2024-01-01T00:00:00.500Z", "seen");
    throwsFor("2024-01-01T00:00:01.000001Z", "seen");
    expect(rowScopePredicate(columns, { seen: "2024-01-01T00:00:01Z" })).toMatchObject({ test: { value: { kind: "instant", v: "2024-01-01T00:00:01.000Z" } } });
    expect(() => rowScopePredicate(columns, {})).toThrow(/no keys/);
    expect(() => rowScopePredicate(columns, [] as never)).toThrow();
    expect(() => rowScopePredicate(columns, null)).toThrow();
    expect(() => rowScopePredicate(columns, new Map() as never)).toThrow();
  });

  it("refuses a decimal that expands beyond maxNumberLength digits and reads a float without expanding it", () => {
    const scoped = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, region: { type: "number", numeric: "decimal" }, weight: { type: "number", numeric: "float" } });
    for (const region of ["1e9999", "1e-9999", "1e40"]) expect(() => rowScopePredicate(scoped, { region })).toThrow(/"region"/);
    expect(rowScopePredicate(scoped, { region: "12.50" })).toMatchObject({ test: { value: { kind: "number", v: "12.5" } } });
    expect(rowScopePredicate(scoped, { weight: 1e-300 })).toMatchObject({ test: { value: { kind: "number", v: "1e-300" } } });
    expect(rowScopePredicate(scoped, { weight: 1e300 })).toMatchObject({ test: { value: { kind: "number", v: "1e+300" } } });
  });

  it("takes the digit bound from the factory's maxNumberLength", () => {
    const scoped = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, region: { type: "number", numeric: "decimal" } });
    const wide = `1${"0".repeat(44)}`;
    expect(() => rowScopePredicate(scoped, { region: wide })).toThrow(/"region"/);
    expect(rowScopePredicate(scoped, { region: wide }, 80)).toMatchObject({ test: { value: { kind: "number", v: wide } } });
    const { executor } = fakeExecutor();
    const query = createGridQuery({ columns: scoped, executor, rowScope: () => ({ region: wide }), limits: { maxNumberLength: 80 } });
    expect(query).toBeDefined();
  });
});

describe("serializer", () => {
  const byId = (id: string) => [...describeIds()].find((column) => column.id === id)!;
  const describeIds = () => (columns as unknown as { visible: Parameters<typeof serializeValue>[1][] }).visible;

  it("keeps safe numbers, stringifies the unsafe, and respects scale", () => {
    expect(serializeValue(5, byId("qty"))).toBe(5);
    expect(serializeValue(5n, byId("id"))).toBe(5);
    expect(serializeValue(9007199254740993n, byId("id"))).toBe("9007199254740993");
    expect(serializeValue("9007199254740993", byId("id"))).toBe("9007199254740993");
    expect(serializeValue("12", byId("id"))).toBe(12);
    expect(serializeValue("12.50", byId("price"))).toBe("12.50");
    expect(serializeValue("12.50", byId("note"))).toBe(12.5);
    expect(serializeValue(Number.NaN, byId("qty"))).toBeNull();
    expect(serializeValue(null, byId("qty"))).toBeNull();
  });

  it("formats dates, instants, and booleans", () => {
    expect(serializeValue(new Date(2024, 0, 5), byId("born"))).toBe("2024-01-05");
    expect(serializeValue("2024-01-05 00:00:00", byId("born"))).toBe("2024-01-05");
    expect(serializeValue(1_704_067_200, byId("seen"))).toBe("2024-01-01T00:00:00.000Z");
    expect(instantText("2024-01-01 10:00:00+00", byId("seen"))).toBe("2024-01-01T10:00:00.000Z");
    expect(instantText("2024-01-01 10:00:00", byId("seen"))).toBe("2024-01-01T10:00:00.000Z");
    expect(instantText("bad", byId("seen"))).toBeNull();
    expect([instantText(" 1704067200 ", byId("seen")), instantText("-1", byId("seen"))]).toEqual(["2024-01-01T00:00:00.000Z", "1969-12-31T23:59:59.000Z"]);
    expect([instantText("9999999999999999", byId("seen")), instantText(9_999_999_999_999, byId("seen")), instantText("1e3", byId("seen"))]).toEqual([null, null, null]);
    expect([serializeValue(1, byId("active")), serializeValue("f", byId("active")), serializeValue("x", byId("active"))]).toEqual([true, false, null]);
  });

  it("projects only mapped columns and survives a null-prototype value", () => {
    const row = serializeRow({ id: 1, name: Object.create(null), tenant: 9, extra: 1 }, (columns as unknown as { visible: never[] }).visible);
    expect(row["name"]).toBe("");
    expect(row).not.toHaveProperty("tenant");
    expect(row).not.toHaveProperty("extra");
  });

  it("writes a mapped __proto__ column as a plain own key", () => {
    const protoKeyed = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, ["__proto__"]: { type: "text" } });
    const row = serializeRow(JSON.parse('{"id": 1, "__proto__": "x"}'), (protoKeyed as unknown as { visible: never[] }).visible);
    expect(Object.getOwnPropertyDescriptor(row, "__proto__")?.value).toBe("x");
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(row))).toEqual(JSON.parse('{"id": 1, "__proto__": "x"}'));
  });
});

function fakeExecutor() {
  const calls: string[] = [];
  const executor: QueryExecutor<string, string> = {
    capabilities: { caseInsensitiveText: "native", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: true },
    selectRows: async (_plan, page) => {
      calls.push(`rows:${page.offset}:${page.limit}`);
      return Array.from({ length: page.limit }, (_, index) => ({ id: page.offset + index + 1, name: `n${index}`, tenant: 1 }));
    },
    countRows: async () => {
      calls.push("count");
      return 42n;
    },
    selectValues: async () => [],
    aggregate: async () => ({}),
    selectGroups: async (plan, page) => {
      calls.push(`groups:${plan.level.id}:${page.offset}:${page.limit}`);
      return [
        { key: "a", count: 3n, childCount: 2, aggregates: { qty: 7 } },
        { key: null, count: "2", childCount: 2, aggregates: {} },
      ];
    },
    countGroups: async () => {
      calls.push("groupCount");
      return 5;
    },
    where: () => "where",
    orderBy: () => "order",
  };
  return { executor, calls };
}

describe("createGridQuery with a column id of __proto__", () => {
  it("keeps the aggregate of a column with the id __proto__ as an own key", async () => {
    const protoColumns = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, ["__proto__"]: { type: "number", numeric: "int4", aggregate: "sum" } });
    const { executor } = fakeExecutor();
    executor.aggregate = async () => JSON.parse('{"__proto__":7}') as Record<string, unknown>;
    const query = createGridQuery({ columns: protoColumns, executor });
    const answer = await query.aggregates({ spec: { sorts: [], filters: [], searchText: "" }, columnIds: ["__proto__"] });
    expect(Object.getPrototypeOf(answer)).toBe(Object.prototype);
    expect(Object.keys(answer)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(answer, "__proto__")?.value).toBe(7);
  });
});

describe("createGridQuery number aggregates", () => {
  const precise = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, n: { type: "number", numeric: "int8", aggregate: "sum" }, d: { type: "number", numeric: "decimal", scale: 2, aggregate: "sum" } });
  const answerFor = async (raw: Record<string, unknown>) => {
    const { executor } = fakeExecutor();
    executor.aggregate = async () => raw;
    return createGridQuery({ columns: precise, executor }).aggregates({ spec: { sorts: [], filters: [], searchText: "" }, columnIds: ["n", "d"] });
  };

  it("answers a number when the value round-trips through Number", async () => {
    expect(await answerFor({ n: 9007199254740991n, d: "10.50" })).toEqual({ n: 9007199254740991, d: 10.5 });
    expect(await answerFor({ n: "-42", d: "999999999999.99" })).toEqual({ n: -42, d: 999999999999.99 });
  });

  it("answers a string when the value has more than 15 significant digits", async () => {
    expect(await answerFor({ n: 9007199254740993n, d: "123456789012345.67" })).toEqual({ n: "9007199254740993", d: "123456789012345.67" });
  });

  it("answers avg as a number, also beyond 15 digits", async () => {
    const avgColumns = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, d: { type: "number", numeric: "decimal", scale: 2, aggregate: "avg" } });
    const { executor } = fakeExecutor();
    executor.aggregate = async () => ({ d: "123456789012345.678" });
    expect(await createGridQuery({ columns: avgColumns, executor }).aggregates({ spec: { sorts: [], filters: [], searchText: "" }, columnIds: ["d"] })).toEqual({ d: Number("123456789012345.678") });
  });

  it("answers a float as a number, also as text beyond 15 digits", async () => {
    const floatColumns = defineColumnMap({ id: { type: "number", numeric: "int8", primaryKey: true }, f: { type: "number", numeric: "float", aggregate: "sum" } });
    const { executor } = fakeExecutor();
    executor.aggregate = async () => ({ f: "0.30000000000000004" });
    expect(await createGridQuery({ columns: floatColumns, executor }).aggregates({ spec: { sorts: [], filters: [], searchText: "" }, columnIds: ["f"] })).toEqual({ f: 0.30000000000000004 });
  });

  it("answers null for a value that is not a number", async () => {
    expect(await answerFor({ n: "abc", d: Number.NaN })).toEqual({ n: null, d: null });
  });
});

describe("createGridQuery", () => {
  const request = (extra: Record<string, unknown> = {}) => ({ spec: { sorts: [], filters: [], searchText: "" }, start: 0, end: 5, ...extra });

  it("answers rows with a count on the first block and hasMore after", async () => {
    const { executor, calls } = fakeExecutor();
    const query = createGridQuery({ columns, executor });
    const first = (await query.fetchRows(request())) as RowsAnswer<Record<string, unknown>>;
    expect(first.totalRowCount).toBe(42);
    expect(first.rows).toHaveLength(5);
    expect(first.rows[0]).not.toHaveProperty("tenant");
    const later = (await query.fetchRows(request({ start: 5, end: 10 }))) as RowsAnswer<Record<string, unknown>>;
    expect(later).toMatchObject({ hasMore: true });
    expect(later.totalRowCount).toBeUndefined();
    expect(later.rows).toHaveLength(5);
    expect(calls).toContain("rows:5:6");
  });

  it("answers the groups of one level with counts, child counts, and reduced aggregates", async () => {
    const { executor, calls } = fakeExecutor();
    const query = createGridQuery({ columns, executor });
    const groupsRequest = { spec: { sorts: [], filters: [], searchText: "", groupBy: ["name", "active"], aggregates: [{ columnId: "qty", reducer: "sum" }] }, start: 0, end: 10 };
    const answer = (await query.fetchRows(groupsRequest)) as GroupsAnswer;
    expect(answer).toEqual({
      groups: [
        { key: "a", childCount: 2, totalRowCount: 3, aggregates: { qty: 7 } },
        { key: null, childCount: 2, totalRowCount: 2, aggregates: { qty: null } },
      ],
      groupCount: 5,
      totalRowCount: 42,
    });
    expect(calls).toContain("groups:name:0:10");
    const inner = (await query.fetchRows({ ...groupsRequest, groupPath: [{ columnId: "name", key: "a" }], childKind: "groups" })) as GroupsAnswer;
    expect(inner.totalRowCount).toBeUndefined();
  });

  it("refuses a group page that holds a key longer than the key limit", async () => {
    const { executor } = fakeExecutor();
    const answering = (key: string): typeof executor => ({ ...executor, selectGroups: async () => [{ key, count: 1n, childCount: 1, aggregates: {} }] });
    const ask = { spec: { groupBy: ["name"] }, start: 0, end: 5 };
    await expect(createGridQuery({ columns, executor: answering("x".repeat(1025)) }).fetchRows(ask)).rejects.toMatchObject({ code: "limit-exceeded", path: ["spec", "groupBy", "name"] });
    await expect(createGridQuery({ columns, executor: answering("x".repeat(30)), limits: { maxGroupKeyLength: 20 } }).fetchRows(ask)).rejects.toMatchObject({ code: "limit-exceeded" });
    await expect(createGridQuery({ columns, executor: answering("x".repeat(5000)), limits: { maxGroupKeyLength: 10_000 } }).fetchRows(ask)).rejects.toMatchObject({ code: "limit-exceeded" });
    const fits = (await createGridQuery({ columns, executor: answering("x".repeat(1024)) }).fetchRows(ask)) as GroupsAnswer;
    expect(fits.groups[0]!.key).toHaveLength(1024);
  });

  it("answers unsupported for groups when the adapter cannot group", async () => {
    const { executor } = fakeExecutor();
    const query = createGridQuery({ columns, executor: { ...executor, capabilities: { ...executor.capabilities, groupBy: false } } });
    await expect(query.fetchRows({ spec: { groupBy: ["name"] }, start: 0, end: 5 })).rejects.toMatchObject({ code: "unsupported" });
  });

  it("passes unbound methods and requires context with rowScope", async () => {
    const { executor } = fakeExecutor();
    const plain = createGridQuery({ columns, executor });
    const { fetchRows } = plain;
    await expect(fetchRows(request())).resolves.toBeDefined();
    const scoped = createGridQuery<Record<string, unknown>, { tenant: number }>({ columns, executor, rowScope: (context) => ({ tenant: context.tenant }) });
    await expect(scoped.fetchRows(request(), { context: { tenant: 3 } })).resolves.toBeDefined();
    await expect(scoped.fetchRows(request(), {} as never)).rejects.toThrow(/context/);
    await expect(scoped.fetchRows(request(), { context: { tenant: undefined as never } })).rejects.toThrow();
  });

  it("brands plans per factory and freezes them", () => {
    const { executor } = fakeExecutor();
    const a = createGridQuery({ columns, executor });
    const b = createGridQuery({ columns, executor });
    const plan = a.parse(request());
    expect(a.where(plan)).toBe("where");
    expect(a.orderBy(plan)).toBe("order");
    expect(() => b.where(plan)).toThrow();
    expect(() => a.where({ ...plan })).toThrow();
    expect(() => a.where(JSON.parse(JSON.stringify(plan)))).toThrow();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(() => {
      (plan as { where: unknown }).where = { t: "true" };
    }).toThrow();
  });

  it("fires an aborted signal before the query", async () => {
    const { executor, calls } = fakeExecutor();
    const query = createGridQuery({ columns, executor });
    const controller = new AbortController();
    controller.abort();
    await expect(query.fetchRows(request(), { signal: controller.signal })).rejects.toBeDefined();
    expect(calls).toEqual([]);
  });

  it("requires a handler for each declared custom operator", () => {
    const custom = defineColumnMap({ id: { type: "number", numeric: "int4", primaryKey: true }, region: { type: "select", operators: [{ id: "inRegion", label: "In", input: "single" }] } });
    expect(() => assertCustomOperatorHandlers(custom, {})).toThrow(/inRegion/);
    expect(() => assertCustomOperatorHandlers(custom, { inRegion: () => 1, extra: () => 1 })).toThrow(/extra/);
    expect(() => assertCustomOperatorHandlers(custom, { inRegion: () => 1 })).not.toThrow();
  });
});

describe("createGridQuery pivot", () => {
  const pivotColumns = defineColumnMap({
    id: { type: "number", numeric: "int8", primaryKey: true },
    name: { type: "text" },
    region: { type: "text" },
    status: { type: "select", native: "enum", choices: ["open", "closed"] },
    amount: { type: "number", numeric: "decimal", scale: 2 },
    qty: { type: "number", numeric: "int4", aggregate: "sum" },
    price: { type: "number", numeric: "decimal", scale: 2, aggregate: "max" },
    nameCount: { type: "text", field: "name", aggregate: "count" },
    tenant: { type: "number", numeric: "int4", serverOnly: true },
  });
  const ask = (aggregates: { columnId: string; reducer: string }[] = [{ columnId: "qty", reducer: "sum" }], extra: Record<string, unknown> = {}) => ({
    spec: { groupBy: ["name"], aggregates, pivot: { columnIds: ["region"] }, sorts: [{ columnId: "region", direction: "desc" }] },
    start: 0,
    end: 10,
    ...extra,
  });

  function pivotExecutor(keys: unknown[], total: unknown, cells: (keyCount: number) => unknown[][]) {
    const { executor, calls } = fakeExecutor();
    const seen: { phase1?: GroupsPlan; phase1Limit?: number; phase2?: GroupsPlan } = {};
    const pivoting: QueryExecutor<string, string> = {
      ...executor,
      capabilities: { ...executor.capabilities, pivot: true },
      selectPivotKeys: async (plan, page) => {
        calls.push("pivotKeys");
        seen.phase1 = plan;
        seen.phase1Limit = page.limit;
        return keys.slice(0, page.limit).map((key) => ({ key, total }));
      },
      selectGroups: async (plan) => {
        calls.push("groups");
        seen.phase2 = plan;
        const rows = cells(plan.pivot?.keys.length ?? 0);
        return rows.map((pivotCells, index) => ({ key: `g${index}`, count: 2, childCount: 2, aggregates: {}, pivotCells }));
      },
    };
    return { executor: pivoting, calls, seen };
  }

  it("runs the keys first, then answers key-major columns with a cell per column", async () => {
    const { executor, calls, seen } = pivotExecutor(["west", null], 2n, () => [[5, null], ["7", 1n]]);
    const answer = (await createGridQuery({ columns: pivotColumns, executor }).fetchRows(ask())) as GroupsAnswer;
    expect(calls.indexOf("pivotKeys")).toBeLessThan(calls.indexOf("groups"));
    expect(seen.phase1?.level.id).toBe("region");
    expect(seen.phase1?.direction).toBe("desc");
    expect(seen.phase1?.aggregates.map((value) => value.column.id)).toEqual(["qty"]);
    expect(seen.phase2?.level.id).toBe("name");
    expect(seen.phase2?.pivot?.keys.map((entry) => entry.key)).toEqual(["west", null]);
    expect(seen.phase2?.pivot?.keys.map((entry) => entry.test.t)).toEqual(["leaf", "leaf"]);
    expect(answer.pivotColumns).toEqual([{ path: ["west"], valueIndex: 0 }, { path: [null], valueIndex: 0 }]);
    expect(answer.pivotOmitted).toBe(0);
    expect(answer.groups.map((group) => group.pivotCells)).toEqual([[5, null], [7, 1]]);
  });

  it("cuts the keys to maxPivotColumns over the value count and answers the cut columns", async () => {
    const aggregates = [{ columnId: "qty", reducer: "sum" }, { columnId: "nameCount", reducer: "count" }];
    const { executor, seen } = pivotExecutor(["a", "b", "c", "d", "e"], 5, (keys) => [Array.from({ length: keys * 2 }, () => null)]);
    const answer = (await createGridQuery({ columns: pivotColumns, executor, limits: { maxPivotColumns: 5 } }).fetchRows(ask(aggregates))) as GroupsAnswer;
    expect(seen.phase1Limit).toBe(2);
    expect(answer.pivotColumns).toEqual([{ path: ["a"], valueIndex: 0 }, { path: ["a"], valueIndex: 1 }, { path: ["b"], valueIndex: 0 }, { path: ["b"], valueIndex: 1 }]);
    expect(answer.pivotOmitted).toBe(6);
    expect(answer.groups[0]!.pivotCells).toEqual([null, 0, null, 0]);
  });

  it("reads a maxPivotColumns over 200 as 200, the columns the grid keeps", async () => {
    const { executor, seen } = pivotExecutor(["a"], 1, (keys) => [Array.from({ length: keys }, () => 1)]);
    await createGridQuery({ columns: pivotColumns, executor, limits: { maxPivotColumns: 5000 } }).fetchRows(ask());
    expect(seen.phase1Limit).toBe(200);
  });

  it("reads decimal cells as numbers", async () => {
    const aggregates = [{ columnId: "price", reducer: "max" }];
    const { executor } = pivotExecutor(["a"], 1, () => [["12.50"]]);
    const answer = (await createGridQuery({ columns: pivotColumns, executor }).fetchRows(ask(aggregates))) as GroupsAnswer;
    expect(answer.groups[0]!.pivotCells).toEqual([12.5]);
  });

  it("reads a decimal cell beyond 15 digits as its nearest number", async () => {
    const aggregates = [{ columnId: "price", reducer: "max" }];
    const { executor } = pivotExecutor(["a"], 1, () => [["123456789012345.67"]]);
    const answer = (await createGridQuery({ columns: pivotColumns, executor }).fetchRows(ask(aggregates))) as GroupsAnswer;
    expect(answer.groups[0]!.pivotCells).toEqual([123456789012345.67]);
  });

  it("scopes the keys query, so another tenant's key never becomes a column", async () => {
    const { executor, seen } = pivotExecutor(["a"], 1, () => [[1]]);
    const query = createGridQuery<Record<string, unknown>, { tenant: number }>({ columns: pivotColumns, executor, rowScope: (context) => ({ tenant: context.tenant }) });
    await query.fetchRows(ask(), { context: { tenant: 3 } });
    const text = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) => (typeof entry === "bigint" ? entry.toString() : entry));
    expect(text(seen.phase1?.where)).toContain('"id":"tenant"');
    expect(text(seen.phase2?.where)).toContain('"id":"tenant"');
  });

  it("keeps a __proto__ key a plain path entry", async () => {
    const { executor } = pivotExecutor(["__proto__"], 1, () => [[3]]);
    const answer = (await createGridQuery({ columns: pivotColumns, executor }).fetchRows(ask())) as GroupsAnswer;
    expect(answer.pivotColumns).toEqual([{ path: ["__proto__"], valueIndex: 0 }]);
    expect(Object.getPrototypeOf(answer.pivotColumns![0]!)).toBe(Object.prototype);
  });

  it("drops a stored key that has no exact test and counts its columns as omitted", async () => {
    const aggregates = [{ columnId: "qty", reducer: "sum" }, { columnId: "nameCount", reducer: "count" }];
    const byStatus = { ...ask(aggregates), spec: { ...ask(aggregates).spec, pivot: { columnIds: ["status"] }, sorts: [] } };
    const { executor, seen } = pivotExecutor(["open", "archived", null], 3, (keys) => [Array.from({ length: keys * 2 }, () => 1)]);
    const answer = (await createGridQuery({ columns: pivotColumns, executor }).fetchRows(byStatus)) as GroupsAnswer;
    expect(seen.phase2?.pivot?.keys.map((entry) => entry.key)).toEqual(["open", null]);
    expect(answer.pivotColumns!.map((column) => column.path[0])).toEqual(["open", "open", null, null]);
    expect(answer.pivotOmitted).toBe(2);
    const byAmount = { ...ask(), spec: { ...ask().spec, pivot: { columnIds: ["amount"] }, sorts: [] } };
    const { executor: long } = pivotExecutor(["1.50", `1${"0".repeat(60)}`], 2, (keys) => [Array.from({ length: keys }, () => 1)]);
    const cut = (await createGridQuery({ columns: pivotColumns, executor: long }).fetchRows(byAmount)) as GroupsAnswer;
    expect(cut.pivotColumns).toEqual([{ path: ["1.50"], valueIndex: 0 }]);
    expect(cut.pivotOmitted).toBe(1);
  });

  it("starts no count when the keys query fails", async () => {
    const { executor, calls } = pivotExecutor([], 0, () => []);
    executor.selectPivotKeys = () => Promise.reject(new Error("keys failed"));
    await expect(createGridQuery({ columns: pivotColumns, executor }).fetchRows(ask())).rejects.toThrow("keys failed");
    expect(calls.filter((call) => call !== "pivotKeys")).toEqual([]);
  });

  it("refuses a stored key over the key limit", async () => {
    const { executor } = pivotExecutor(["x".repeat(1025)], 1, () => [[1]]);
    await expect(createGridQuery({ columns: pivotColumns, executor }).fetchRows(ask())).rejects.toMatchObject({ code: "limit-exceeded", path: ["spec", "pivot", "columnIds", 0] });
  });

  it("throws when the executor answers another cell count than the plan holds", async () => {
    const { executor } = pivotExecutor(["a", "b"], 2, () => [[1]]);
    await expect(createGridQuery({ columns: pivotColumns, executor }).fetchRows(ask())).rejects.toThrow(/pivot cells/);
    const { executor: none } = pivotExecutor(["a"], 1, () => [undefined as never]);
    await expect(createGridQuery({ columns: pivotColumns, executor: none }).fetchRows(ask())).rejects.toThrow(/pivot cells/);
  });

  it("answers no pivot fields without a pivot, and refuses one without the capability", async () => {
    const { executor } = pivotExecutor(["a"], 1, () => [[1]]);
    const plain = (await createGridQuery({ columns: pivotColumns, executor }).fetchRows({ spec: { groupBy: ["name"] }, start: 0, end: 5 })) as GroupsAnswer;
    expect(plain).not.toHaveProperty("pivotColumns");
    expect(plain.groups[0]).not.toHaveProperty("pivotCells");
    const { executor: off } = fakeExecutor();
    await expect(createGridQuery({ columns: pivotColumns, executor: off }).fetchRows(ask())).rejects.toMatchObject({ code: "unsupported" });
  });

  it("throws at creation when the capability is on and the keys query is missing", () => {
    const { executor } = fakeExecutor();
    expect(() => createGridQuery({ columns: pivotColumns, executor: { ...executor, capabilities: { ...executor.capabilities, pivot: true } } })).toThrow(/selectPivotKeys/);
  });
});

describe("handleGridRequest", () => {
  const post = (body: string, init: RequestInit = {}) => new Request("http://localhost/api", { method: "POST", body, ...init });

  it("runs the query and answers JSON", async () => {
    const response = await handleGridRequest(post(JSON.stringify({ a: 1 })), async (input) => ({ echoed: input }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ echoed: { a: 1 } });
  });

  it("maps a QueryError to 400 without values and any other error to 500 without a message", async () => {
    const bad = await handleGridRequest(post("{}"), async () => {
      throw new QueryError("unknown-column", ["spec", "filters", 2, "columnId"]);
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "unknown-column", path: ["spec", "filters", 2, "columnId"] });
    const unsupported = await handleGridRequest(post("{}"), async () => {
      throw new QueryError("unsupported");
    });
    expect(unsupported.status).toBe(501);
    const boom = await handleGridRequest(post("{}"), async () => {
      throw new Error("duplicate key value violates unique constraint (secret@example.com)");
    });
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await boom.json())).not.toContain("secret");
  });

  it("caps the body and answers malformed JSON with 400", async () => {
    expect((await handleGridRequest(post("x".repeat(100)), async () => 1, { maxBodyBytes: 10 })).status).toBe(413);
    expect((await handleGridRequest(post("not json"), async () => 1)).status).toBe(400);
    const chunked = new Request("http://localhost/api", { method: "POST", body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("y".repeat(50))); c.close(); } }), duplex: "half" } as RequestInit);
    expect((await handleGridRequest(chunked, async () => 1, { maxBodyBytes: 10 })).status).toBe(413);
  });

  it("forwards the request signal and the context", async () => {
    let seen: unknown;
    const controller = new AbortController();
    const req = new Request("http://localhost/api", { method: "POST", body: "{}", signal: controller.signal });
    await handleGridRequest<{ tenant: number }, number>(req, async (_input, opts) => {
      seen = opts;
      return 1;
    }, { context: { tenant: 4 } });
    expect(seen).toMatchObject({ context: { tenant: 4 } });
    expect((seen as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
