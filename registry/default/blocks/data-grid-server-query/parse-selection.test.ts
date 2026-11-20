// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defineColumnMap } from "./column-map";
import { type QueryExecutor, createGridQuery } from "./create-grid-query";
import { QueryError } from "./errors";
import { DEFAULT_LIMITS, resolveLimits } from "./limits";
import { MAX_HIDDEN_CHECKED_ROWS } from "@/registry/default/blocks/data-grid/store/hidden-checked-rows";
import { validateChange } from "./validate-change";
import { parseSelection, selectionBodyBytes } from "./parse-selection";
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
    const { plan } = parse({ selection: { mode: "ids", ids: ["1", "2.5", "x", " 3 ", "9223372036854775807", "9223372036854775808", "1e9999", "1e3"], excludedIds: [], count: 3 } });
    expect(idsLeaf(plan.where)).toEqual({
      k: "ids",
      negate: false,
      values: [
        { kind: "bigint", v: BigInt(1) },
        { kind: "bigint", v: BigInt(3) },
        { kind: "bigint", v: BigInt("9223372036854775807") },
        { kind: "bigint", v: BigInt(1000) },
      ],
    });
  });

  it("ignores a filled excludedIds list, which only the body cap bounds", () => {
    const excludedIds = [...Array.from({ length: DEFAULT_LIMITS.maxSelectionIds + 1 }, () => "x"), 5];
    expect(idsLeaf(parse({ selection: { mode: "ids", ids: ["1"], excludedIds } }).plan.where)?.values).toEqual([{ kind: "bigint", v: BigInt(1) }]);
  });

  it("matches no row when no id parses", () => {
    expect(parse({ selection: { mode: "ids", ids: [], excludedIds: [] } }).plan.where).toEqual({ t: "false" });
    expect(parse({ selection: { mode: "ids", ids: ["x"], excludedIds: [] } }).plan.where).toEqual({ t: "false" });
  });

  it("keeps __proto__, constructor, and the empty text as plain ids of a text key", () => {
    const { plan } = parseSelection({ selection: { mode: "ids", ids: ["__proto__", "constructor", ""], excludedIds: [] } }, { columns: textKeyed });
    expect(idsLeaf(plan.where)?.values).toEqual([
      { kind: "text", v: "__proto__" },
      { kind: "text", v: "constructor" },
      { kind: "text", v: "" },
    ]);
  });

  it("compares a key and never validates it: choices and maxLength do not apply", () => {
    const chosen = defineColumnMap({ k: { type: "select", choices: ["a"], maxLength: 2, primaryKey: true } });
    const { plan } = parseSelection({ selection: { mode: "ids", ids: ["zzz"], excludedIds: [] } }, { columns: chosen });
    expect(idsLeaf(plan.where)?.values).toEqual([{ kind: "text", v: "zzz" }]);
  });

  it("drops an id a decimal key declines for its length, so one long id fails no request", () => {
    const decimal = defineColumnMap({ k: { type: "number", numeric: "decimal", primaryKey: true } });
    expect(parseSelection({ selection: { mode: "ids", ids: ["1".repeat(41), "2"], excludedIds: [] } }, { columns: decimal }).plan.where).toMatchObject({ test: { values: [{ v: "2" }] } });
    expect(parse({ selection: { mode: "ids", ids: ["1".repeat(41)], excludedIds: [] } }).plan.where).toEqual({ t: "false" });
    expect(parseSelection({ selection: { mode: "ids", ids: ["a".repeat(1001)], excludedIds: [] } }, { columns: textKeyed }).plan.where).toEqual({ t: "false" });
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
    const { plan } = parse({ selection: { mode: "allMatching", ids: [], excludedIds: ["7"], count: 10, spec }, include: "ids", start: 0, end: 50 });
    const filters = parseQuery({ spec, start: 0, end: 1 }, { columns, request: "rows" }).where;
    expect(plan.where).toEqual({ t: "and", items: [filters, { t: "leaf", column: expect.objectContaining({ id: "id" }), test: { k: "ids", negate: true, values: [{ kind: "bigint", v: BigInt(7) }] } }] });
    expect(plan.orderBy.map((term) => `${term.column.id} ${term.direction}`)).toEqual(["name desc", "id asc"]);
    expect(plan.rowRange).toEqual({ start: 0, end: 50 });
  });

  it("drops an excluded id that no key can hold: a draft or stale id fails no request", () => {
    const { plan } = parse({ selection: { mode: "allMatching", excludedIds: ["7", "new-0", "x", "1e9999", "2.5", "9223372036854775808"], spec } });
    expect(idsLeaf(plan.where)?.values).toEqual([{ kind: "bigint", v: BigInt(7) }]);
    const none = parse({ selection: { mode: "allMatching", excludedIds: ["new-0", "x"], spec } }).plan.where;
    expect(none).toEqual(parse({ selection: { mode: "allMatching", excludedIds: [], spec } }).plan.where);
  });

  it("refuses an excluded id the layer declines, which dropping would put back into the selection", () => {
    const decimal = defineColumnMap({ k: { type: "number", numeric: "decimal", primaryKey: true } });
    const float = defineColumnMap({ k: { type: "number", numeric: "float", primaryKey: true } });
    const long = { selection: { mode: "allMatching", excludedIds: ["1", "1".repeat(41)], spec: {} } };
    expect(codeOf(() => parseSelection(long, { columns: decimal }))).toBe("invalid-value selection.excludedIds.1");
    expect(codeOf(() => parseSelection(long, { columns: float }))).toBe("invalid-value selection.excludedIds.1");
    const text = { selection: { mode: "allMatching", excludedIds: ["a".repeat(1001)], spec: {} } };
    expect(codeOf(() => parseSelection(text, { columns: textKeyed }))).toBe("invalid-value selection.excludedIds.0");
  });

  it("ignores a filled ids list, which only the body cap bounds", () => {
    const ids = [...Array.from({ length: DEFAULT_LIMITS.maxSelectionIds + 1 }, () => "x"), 5];
    expect(parse({ selection: { mode: "allMatching", ids, excludedIds: [], spec: {} } }).plan.where).toEqual({ t: "true" });
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
    expect(codeOf(() => parse({ selection: { mode: "ids", ids, excludedIds: [] } }, { maxSelectionIds: 2 }))).toBe("limit-exceeded selection.ids");
    expect(codeOf(() => parse({ selection: { mode: "allMatching", ids: [], excludedIds: ids } }, { maxSelectionIds: 2 }))).toBe("limit-exceeded selection.excludedIds");
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: [...ids, 4], excludedIds: [] } }, { maxSelectionIds: 2 }))).toBe("limit-exceeded selection.ids");
  });

  it("refuses a non-string id, and an id's length never exceeds a limit", () => {
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: ["1", 2], excludedIds: [] } }))).toBe("invalid-request selection.ids.1");
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: ["1", "9".repeat(1001)], excludedIds: [] } }))).toBeUndefined();
  });

  it("takes every id a grid can send: the remembered rows plus 100,000 loaded ones", () => {
    expect(DEFAULT_LIMITS.maxSelectionIds).toBe(MAX_HIDDEN_CHECKED_ROWS + 100_000);
    const ids = Array.from({ length: DEFAULT_LIMITS.maxSelectionIds }, (_, i) => String(i + 1));
    expect(idsLeaf(parse({ selection: { mode: "ids", ids, excludedIds: [] } }).plan.where)?.values).toHaveLength(ids.length);
    expect(codeOf(() => parse({ selection: { mode: "ids", ids: [...ids, "0"], excludedIds: [] } }))).toBe("limit-exceeded selection.ids");
  });

  it("reads an exponent id like validateChange does", () => {
    const change = validateChange({ ops: [{ type: "delete", rowId: "1e3" }, { type: "delete", rowId: "1e9999" }] }, { columns });
    expect(change.deletes.map((entry) => entry.where)).toEqual([{ t: "leaf", column: expect.objectContaining({ id: "id" }), test: { k: "exact", value: { kind: "bigint", v: BigInt(1000) } } }]);
    expect(change.rejected).toEqual([{ rowId: "1e9999", code: "not-an-id", message: "Not a valid id" }]);
    expect(idsLeaf(parse({ selection: { mode: "ids", ids: ["1e3", "1e9999"], excludedIds: [] } }).plan.where)?.values).toEqual([{ kind: "bigint", v: BigInt(1000) }]);
  });

  it("refuses huge exponents in bulk without building their digits", () => {
    const ops = Array.from({ length: 10_000 }, () => ({ type: "delete", rowId: "1e9999" }));
    expect(validateChange({ ops }, { columns }).rejected).toHaveLength(10_000);
    const ids = Array.from({ length: DEFAULT_LIMITS.maxSelectionIds }, () => "1e9999");
    expect(parse({ selection: { mode: "ids", ids, excludedIds: [] } }).plan.where).toEqual({ t: "false" });
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

const isScope = (where: Predicate): boolean => where.t === "leaf" && where.column.id === "tenant" && where.test.k === "exact";
// The scope must AND the whole filter: a scope leaf inside an `or` would widen the result.
const hasScope = (where: Predicate): boolean => isScope(where) || (where.t === "and" && where.items.some(isScope));

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

  it("answers rows in the wire form, without a serverOnly column", async () => {
    const { executor, calls } = recordingExecutor([{ id: 1, name: "a", qty: 2, tenant: 9 }], 1);
    const query = createGridQuery({ columns, executor });
    const answer = await query.selection({ selection: { mode: "ids", ids: ["1"], excludedIds: [] }, include: "rows" });
    expect(answer).toEqual({ count: 1, rows: [{ id: 1, name: "a", qty: 2 }], hasMore: false });
    expect(calls.find((call) => call.kind === "select")!.plan.projection.map((column) => column.id)).toEqual(["id", "name", "qty"]);
  });

  it("ANDs rowScope around an or-joined spec", async () => {
    const { executor, calls } = recordingExecutor([], 0);
    const query = createGridQuery<Record<string, unknown>, { tenant: number }, Predicate>({ columns, executor, rowScope: ({ tenant }) => ({ tenant }) });
    const spec = { filterJoin: "or", filters: [{ columnId: "qty", operator: "gt", value: "5" }, { columnId: "name", operator: "equals", value: "a" }] };
    await query.selection({ selection: { mode: "allMatching", ids: [], excludedIds: ["3"], spec }, include: "ids" }, { context: { tenant: 1 } });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(hasScope(call.plan.where)).toBe(true);
      expect(call.plan.where.t === "and" && call.plan.where.items.some((item) => item.t === "or")).toBe(true);
    }
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

  it("carries a body cap that fits its limits: a quoted uuid per id and a full spec", () => {
    const { executor } = recordingExecutor([], 0);
    const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(createGridQuery({ columns, executor }).selection.maxBodyBytes).toBe(selectionBodyBytes(resolveLimits(undefined)));
    const raised = createGridQuery({ columns, executor, limits: { maxSelectionIds: 400_000 } }).selection.maxBodyBytes;
    expect(raised).toBeGreaterThan(400_000 * `${JSON.stringify(uuid)},`.length);
    const excludedIds = Array.from({ length: DEFAULT_LIMITS.maxSelectionIds }, () => uuid);
    const body = JSON.stringify({ selection: { mode: "allMatching", ids: [], excludedIds, spec: { searchText: "x".repeat(DEFAULT_LIMITS.maxTreeStringBytes) } } });
    expect(new TextEncoder().encode(body).length).toBeLessThan(selectionBodyBytes(resolveLimits(undefined)));
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
