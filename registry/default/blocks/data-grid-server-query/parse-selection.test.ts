// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defineColumnMap } from "./column-map";
import { type QueryExecutor, createGridQuery } from "./create-grid-query";
import { QueryError } from "./errors";
import { DEFAULT_LIMITS } from "./limits";
import { SELECTION_MAX_BODY_BYTES, parseSelection } from "./parse-selection";
import { parseQuery } from "./parse-query";
import type { Predicate, RowsPlan } from "./plan";

const columns = defineColumnMap({
  id: { type: "number", numeric: "int8", primaryKey: true },
  name: { type: "text", searchable: true },
  qty: { type: "number", numeric: "int4" },
  tenant: { type: "number", numeric: "int4", serverOnly: true },
});
const textKeyed = defineColumnMap({ code: { type: "text", primaryKey: true }, name: { type: "text" } });

const parse = (input: unknown, limits?: Parameters<typeof parseSelection>[1]["limits"]) => parseSelection(input, { columns, limits });
const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof QueryError) return `${error.code} ${error.path.join(".")}`;
    throw error;
  }
  return undefined;
};
const idsLeaf = (where: Predicate) => {
  const found = where.t === "leaf" ? where : where.t === "and" ? where.items.find((item) => item.t === "leaf" && item.test.k === "ids") : undefined;
  return found?.t === "leaf" && found.test.k === "ids" ? found.test : undefined;
};

describe("parseSelection: ids mode", () => {
  it("matches the parsed ids and drops an id the key cannot parse", () => {
    const { plan } = parse({ selection: { mode: "ids", ids: ["1", "2.5", "x", " 3 ", "9223372036854775807", "9223372036854775808", "1e3"], excludedIds: [], count: 3 } });
    expect(idsLeaf(plan.where)).toEqual({
      k: "ids",
      negate: false,
      values: [
        { kind: "bigint", v: BigInt(1) },
        { kind: "bigint", v: BigInt(3) },
        { kind: "bigint", v: BigInt("9223372036854775807") },
      ],
    });
  });

  it("matches no row when no id parses", () => {
    expect(parse({ selection: { mode: "ids", ids: [], excludedIds: [] } }).plan.where).toEqual({ t: "false" });
    expect(parse({ selection: { mode: "ids", ids: ["x"], excludedIds: [] } }).plan.where).toEqual({ t: "false" });
  });

  it("keeps __proto__ and constructor as plain ids of a text key", () => {
    const { plan } = parseSelection({ selection: { mode: "ids", ids: ["__proto__", "constructor", ""], excludedIds: [] } }, { columns: textKeyed });
    expect(idsLeaf(plan.where)?.values).toEqual([
      { kind: "text", v: "__proto__" },
      { kind: "text", v: "constructor" },
    ]);
  });

  it("orders by the tie-breaker and always counts", () => {
    const { plan } = parse({ selection: { mode: "ids", ids: ["1"], excludedIds: [] } });
    expect(plan.orderBy.map((term) => term.column.id)).toEqual(["id"]);
    expect(plan.runCount).toBe(true);
    expect(plan.rowRange).toEqual({ start: 0, end: DEFAULT_LIMITS.maxPageSize });
  });
});

describe("parseSelection: allMatching mode", () => {
  const spec = { sorts: [{ columnId: "name", direction: "desc" }], filters: [{ columnId: "qty", operator: "gt", value: "5" }], searchText: "" };

  it("ANDs the spec's filters with NOT the excluded ids and orders by the spec", () => {
    const { plan } = parse({ selection: { mode: "allMatching", ids: [], excludedIds: ["7", "bad"], count: 10, spec }, include: "ids", start: 0, end: 50 });
    const filters = parseQuery({ spec, start: 0, end: 1 }, { columns, request: "rows" }).where;
    expect(plan.where).toEqual({ t: "and", items: [filters, { t: "leaf", column: expect.objectContaining({ id: "id" }), test: { k: "ids", negate: true, values: [{ kind: "bigint", v: BigInt(7) }] } }] });
    expect(plan.orderBy.map((term) => `${term.column.id} ${term.direction}`)).toEqual(["name desc", "id asc"]);
    expect(plan.rowRange).toEqual({ start: 0, end: 50 });
  });

  it("adds no id test for an empty exclusion list", () => {
    const { plan } = parse({ selection: { mode: "allMatching", ids: [], excludedIds: [], count: null, spec: { searchText: "" } } });
    expect(plan.where).toEqual({ t: "true" });
  });

  it("ignores grouping keys, which never change the matching rows", () => {
    const grouped = { ...spec, groupBy: ["name"], aggregates: [{ columnId: "qty", reducer: "sum" }] };
    const a = parse({ selection: { mode: "allMatching", ids: [], excludedIds: ["7"], spec: grouped } }).plan;
    const b = parse({ selection: { mode: "allMatching", ids: [], excludedIds: ["7"], spec } }).plan;
    expect(a.where).toEqual(b.where);
  });

  it("answers a filter on a serverOnly column like an unmapped one, with the selection path", () => {
    const hidden = { filters: [{ columnId: "tenant", operator: "equals", value: "1" }] };
    const unmapped = { filters: [{ columnId: "nope", operator: "equals", value: "1" }] };
    expect(codeOf(() => parse({ selection: { mode: "allMatching", excludedIds: [], spec: hidden } }))).toBe("unknown-column selection.spec.filters.0.columnId");
    expect(codeOf(() => parse({ selection: { mode: "allMatching", excludedIds: [], spec: unmapped } }))).toBe("unknown-column selection.spec.filters.0.columnId");
  });
});

describe("parseSelection: bounds", () => {
  it("bounds the id count before it reads an id, in both modes", () => {
    const ids = ["1", "2", "3"];
    expect(codeOf(() => parse({ selection: { mode: "ids", ids, excludedIds: [] } }, { maxExcludedIds: 2 }))).toBe("limit-exceeded selection.ids");
    expect(codeOf(() => parse({ selection: { mode: "allMatching", ids: [], excludedIds: ids } }, { maxExcludedIds: 2 }))).toBe("limit-exceeded selection.excludedIds");
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: [...ids, 4], excludedIds: [] } }, { maxExcludedIds: 2 }))).toBe("limit-exceeded selection.ids");
  });

  it("refuses a non-string id and bounds each id and the total id text", () => {
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: ["1", 2], excludedIds: [] } }))).toBe("invalid-request selection.ids.1");
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: ["1", "9".repeat(1001)], excludedIds: [] } }))).toBe("limit-exceeded selection.ids.1");
    const long = "a".repeat(1000);
    const many = Array.from({ length: Math.ceil(SELECTION_MAX_BODY_BYTES / 1000) + 1 }, () => long);
    expect(codeOf(() => parseSelection({ selection: { mode: "ids", ids: many, excludedIds: [] } }, { columns: textKeyed }))).toBe("limit-exceeded selection.ids");
  });

  it("drops a long number id instead of throwing", () => {
    expect(parse({ selection: { mode: "ids", ids: ["1".repeat(41)], excludedIds: [] } }).plan.where).toEqual({ t: "false" });
  });

  it("reads 100,000 ids with an exponent fast", () => {
    const ids = Array.from({ length: DEFAULT_LIMITS.maxExcludedIds }, () => "1e9999");
    const started = performance.now();
    expect(parse({ selection: { mode: "ids", ids, excludedIds: [] } }).plan.where).toEqual({ t: "false" });
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("refuses a malformed request", () => {
    expect(codeOf(() => parse(null))).toBe("invalid-request ");
    expect(codeOf(() => parse({}))).toBe("invalid-request selection");
    expect(codeOf(() => parse({ selection: { mode: "some", ids: [] } }))).toBe("invalid-request selection.mode");
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: "1" } }))).toBe("invalid-request selection.ids");
    expect(codeOf(() => parse({ selection: { mode: "allMatching", excludedIds: [], spec: [] } }))).toBe("invalid-request selection.spec");
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: [] }, include: "all" }))).toBe("invalid-request include");
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: [] }, start: 0, end: 1001 }))).toBe("invalid-value end");
  });

  it("is unsupported without one primary key, or for a key that is not a number or text", () => {
    const composite = defineColumnMap({ a: { type: "text" }, b: { type: "text" } }, { tieBreaker: ["a", "b"] });
    const dated = defineColumnMap({ day: { type: "date", primaryKey: true } });
    const flag = defineColumnMap({ on: { type: "checkbox", primaryKey: true } });
    const body = { selection: { mode: "ids", ids: ["1"], excludedIds: [] } };
    for (const map of [composite, dated, flag]) expect(codeOf(() => parseSelection(body, { columns: map }))).toBe("unsupported selection");
  });
});

type Recorded = { kind: "count" | "select"; plan: RowsPlan; page?: { offset: number; limit: number } };

function recordingExecutor(rows: Record<string, unknown>[], count: unknown): { executor: QueryExecutor<Predicate, unknown>; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const unused = () => {
    throw new Error("unused");
  };
  return {
    calls,
    executor: {
      capabilities: { caseInsensitiveText: "ascii", likeEscape: true, literalAsterisk: true, nullsLast: "native", aggregates: true, groupBy: true, localDayGrouping: false },
      selectRows: (plan, page) => {
        calls.push({ kind: "select", plan, page: { offset: page.offset, limit: page.limit } });
        return Promise.resolve(rows.slice(0, page.limit));
      },
      countRows: (plan) => {
        calls.push({ kind: "count", plan });
        return Promise.resolve(count);
      },
      selectValues: unused,
      aggregate: unused,
      selectGroups: unused,
      countGroups: unused,
      where: (plan) => plan.where,
      orderBy: () => undefined,
    },
  };
}

const hasScope = (where: Predicate): boolean =>
  where.t === "leaf" ? where.column.id === "tenant" && where.test.k === "exact" : where.t === "and" || where.t === "or" ? where.items.some(hasScope) : false;

describe("GridQuery.selection", () => {
  it("answers the count alone without include", async () => {
    const { executor, calls } = recordingExecutor([], BigInt(42));
    const query = createGridQuery({ columns, executor });
    await expect(query.selection({ selection: { mode: "ids", ids: ["1"], excludedIds: [] } })).resolves.toEqual({ count: 42 });
    expect(calls.map((call) => call.kind)).toEqual(["count"]);
  });

  it("answers one page of ids from the key alone, with hasMore", async () => {
    const { executor, calls } = recordingExecutor([{ id: BigInt("9223372036854775807") }, { id: 2 }, { id: 3 }], 3);
    const query = createGridQuery({ columns, executor });
    const answer = await query.selection({ selection: { mode: "allMatching", ids: [], excludedIds: [], spec: {} }, include: "ids", start: 0, end: 2 });
    expect(answer).toEqual({ count: 3, ids: ["9223372036854775807", "2"], hasMore: true });
    const select = calls.find((call) => call.kind === "select")!;
    expect(select.plan.projection.map((column) => column.id)).toEqual(["id"]);
    expect(select.page).toEqual({ offset: 0, limit: 3 });
  });

  it("answers rows in the wire form", async () => {
    const { executor } = recordingExecutor([{ id: 1, name: "a", qty: 2 }], 1);
    const query = createGridQuery({ columns, executor });
    const answer = await query.selection({ selection: { mode: "ids", ids: ["1"], excludedIds: [] }, include: "rows" });
    expect(answer).toEqual({ count: 1, rows: [{ id: 1, name: "a", qty: 2 }], hasMore: false });
  });

  it("applies rowScope to the count and to the ids", async () => {
    const { executor, calls } = recordingExecutor([{ id: 1 }], 1);
    const query = createGridQuery<Record<string, unknown>, { tenant: number }, Predicate>({ columns, executor, rowScope: ({ tenant }) => ({ tenant }) });
    await query.selection({ selection: { mode: "ids", ids: ["1"], excludedIds: [] }, include: "ids" }, { context: { tenant: 1 } });
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(hasScope(call.plan.where)).toBe(true);
    // @ts-expect-error a factory with rowScope needs context
    await expect(query.selection({ selection: { mode: "ids", ids: ["1"], excludedIds: [] } })).rejects.toThrow(/context/);
  });

  it("carries the selection body cap", () => {
    const { executor } = recordingExecutor([], 0);
    expect(createGridQuery({ columns, executor }).selection.maxBodyBytes).toBe(SELECTION_MAX_BODY_BYTES);
    expect(SELECTION_MAX_BODY_BYTES).toBe(8 * 1024 * 1024);
  });

  it("gives a scoped plan for a bulk write through where", () => {
    const { executor } = recordingExecutor([], 0);
    const query = createGridQuery<Record<string, unknown>, { tenant: number }, Predicate>({ columns, executor, rowScope: ({ tenant }) => ({ tenant }) });
    const plan = query.selectionPlan({ selection: { mode: "ids", ids: ["1"], excludedIds: [] } }, { context: { tenant: 1 } });
    const where = query.where(plan);
    expect(hasScope(where)).toBe(true);
    expect(idsLeaf(where)?.values).toEqual([{ kind: "bigint", v: BigInt(1) }]);
  });
});
