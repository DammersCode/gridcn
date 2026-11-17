// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORACLE_CASES, SERVER_CASES } from "./cases";
import { oracleIds } from "./client-oracle";
import { type Harness, openPg, openSqlite } from "./engines";
import { FIXTURE_ROWS } from "./fixture";

const harnesses: Harness[] = [];
const closers: (() => Promise<void> | void)[] = [];

beforeAll(async () => {
  const sqlite = await openSqlite();
  const pg = await openPg();
  harnesses.push(...sqlite.harnesses, ...pg.harnesses);
  closers.push(() => void sqlite.database.close(), () => pg.pg.close());
}, 60_000);

afterAll(async () => {
  for (const close of closers) await close();
});

const request = (filters: unknown, extra: Record<string, unknown> = {}) => ({ spec: { sorts: [], filters, searchText: "" }, start: 0, end: 1000, ...extra });
const idsOf = (answer: { rows: Record<string, unknown>[] }): number[] => answer.rows.map((row) => row["id"] as number).sort((a, b) => a - b);

describe.each([
  ["sqlite", "drizzle"],
  ["sqlite", "kysely"],
  ["pg", "drizzle"],
  ["pg", "kysely"],
] as const)("%s + %s", (engine, adapter) => {
  const query = () => harnesses.find((h) => h.engine === engine && h.adapter === adapter)!.make();

  it.each(ORACLE_CASES)("matches the client filter engine: $name", async ({ filters }) => {
    const answer = await query().fetchRows(request(filters));
    expect(idsOf(answer)).toEqual(oracleIds(filters));
  });

  it.each(SERVER_CASES)("documented difference: $name", async ({ filters, expect: expected }) => {
    const answer = await query().fetchRows(request(filters));
    expect(idsOf(answer)).toEqual((expected as { ids: number[] }).ids);
  });

  it("refuses a text operator on a number column", async () => {
    await expect(query().fetchRows(request([{ columnId: "qty", operator: "contains", value: "1" }]))).rejects.toMatchObject({ code: "operator-not-allowed" });
  });

  it("never selects or filters a serverOnly column", async () => {
    const answer = await query().fetchRows(request([]));
    expect(Object.keys(answer.rows[0]!)).not.toContain("tenantId");
    await expect(query().fetchRows(request([{ columnId: "tenantId", operator: "equals", value: "1" }]))).rejects.toMatchObject({ code: "unknown-column" });
    await expect(query().fetchRows({ spec: { sorts: [{ columnId: "tenantId", direction: "asc" }], filters: [], searchText: "" }, start: 0, end: 5 })).rejects.toMatchObject({ code: "unknown-column" });
  });

  it("orders NULLs last in both directions with a total order", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const answer = await query().fetchRows({ spec: { sorts: [{ columnId: "qty", direction }], filters: [], searchText: "" }, start: 0, end: 1000 });
      const values = answer.rows.map((row) => row["qty"] as number | null);
      const firstNull = values.indexOf(null);
      expect(values.slice(firstNull).every((value) => value === null)).toBe(true);
      const present = values.slice(0, firstNull) as number[];
      expect(present).toEqual([...present].sort((a, b) => (direction === "asc" ? a - b : b - a)));
      expect(new Set(answer.rows.map((row) => row["id"])).size).toBe(FIXTURE_ROWS.length);
    }
  });

  it("pages with a stable order and counts", async () => {
    const q = query();
    const first = await q.fetchRows({ spec: { sorts: [{ columnId: "qty", direction: "asc" }], filters: [], searchText: "" }, page: 2, pageSize: 10, start: 10, end: 20 });
    const second = await q.fetchRows({ spec: { sorts: [{ columnId: "qty", direction: "asc" }], filters: [], searchText: "" }, page: 2, pageSize: 10, start: 10, end: 20 });
    expect(first.rows).toHaveLength(10);
    expect(first.rows).toEqual(second.rows);
    expect(first.totalRowCount).toBe(FIXTURE_ROWS.length);
  });

  it("counts only the first scroll block, then reports hasMore", async () => {
    const q = query();
    const head = await q.fetchRows({ spec: { sorts: [], filters: [], searchText: "" }, start: 0, end: 10 });
    expect(head.totalRowCount).toBe(FIXTURE_ROWS.length);
    const tail = await q.fetchRows({ spec: { sorts: [], filters: [], searchText: "" }, start: 10, end: 20 });
    expect(tail.totalRowCount).toBeUndefined();
    expect(tail.hasMore).toBe(true);
  });

  it("quick search narrows by substring over searchable columns", async () => {
    const answer = await query().fetchRows({ spec: { sorts: [], filters: [], searchText: "ALP" }, start: 0, end: 1000 });
    const expected = FIXTURE_ROWS.filter((row) => `${row.name ?? ""}`.toLowerCase().includes("alp") || `${row.tag ?? ""}`.toLowerCase().includes("alp")).map((row) => row.id);
    expect(idsOf(answer)).toEqual(expected);
  });

  it("matches hostile text only as literal text", async () => {
    for (const hostile of ["'; drop table items; --", "\" or 1=1 --", "%", "_", "\\", "!"]) {
      const answer = await query().fetchRows(request([{ columnId: "name", operator: "contains", value: hostile }]));
      const expected = FIXTURE_ROWS.filter((row) => (row.name ?? "").toLowerCase().includes(hostile.toLowerCase())).map((row) => row.id);
      expect(idsOf(answer)).toEqual(expected);
    }
    expect((await query().fetchRows(request([]))).rows).toHaveLength(FIXTURE_ROWS.length);
  });

  it("applies rowScope to rows, values, and aggregates, and fails closed", async () => {
    const harness = harnesses.find((h) => h.engine === engine && h.adapter === adapter)!;
    const scoped = harness.make({ rowScope: true });
    const mine = FIXTURE_ROWS.filter((row) => row.tenantId === 1).map((row) => row.id);
    expect(idsOf(await scoped.fetchRows(request([]), { context: { tenantId: 1 } }))).toEqual(mine);
    const values = await scoped.filterValues({ columnId: "tag", query: "", filters: [] }, { context: { tenantId: 1 } });
    expect(values.values.reduce((sum, entry) => sum + (entry.count ?? 0), 0)).toBe(mine.length);
    const totals = await scoped.aggregates({ spec: { sorts: [], filters: [], searchText: "" }, columnIds: ["qty"] }, { context: { tenantId: 1 } });
    expect(totals["qty"]).toBe(FIXTURE_ROWS.filter((row) => row.tenantId === 1).reduce((sum, row) => sum + (row.qty ?? 0), 0));
    await expect(scoped.fetchRows(request([]), { context: { tenantId: undefined as never } })).rejects.toThrow();
    await expect(scoped.fetchRows(request([]), {} as never)).rejects.toThrow();
  });

  it("lists set values grouped without regard to case, blanks merged", async () => {
    const result = await query().filterValues({ columnId: "tag", query: "", filters: [] });
    const counts = new Map<string, number>();
    for (const row of FIXTURE_ROWS) {
      const key = (row.tag ?? "").toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(result.values.reduce((sum, entry) => sum + (entry.count ?? 0), 0)).toBe(FIXTURE_ROWS.length);
    expect(new Set(result.values.map((entry) => entry.value.toLowerCase())).size).toBe(counts.size);
    const filtered = await query().filterValues({ columnId: "tag", query: "re", filters: [] });
    expect(filtered.values.map((entry) => entry.value.toLowerCase()).sort()).toEqual(["green", "red"]);
  });

  it("lists days of a time column", async () => {
    const result = await query().filterValues({ columnId: "createdAt", query: "", filters: [] });
    const days = new Set(FIXTURE_ROWS.map((row) => (row.createdAt ? row.createdAt.slice(0, 10) : "")));
    expect(new Set(result.values.map((entry) => entry.value))).toEqual(days);
  });

  it("computes flat aggregates", async () => {
    const result = await query().aggregates({ spec: { sorts: [], filters: [], searchText: "" }, columnIds: ["qty", "score", "price", "createdAt", "name"] });
    expect(result["qty"]).toBe(FIXTURE_ROWS.reduce((sum, row) => sum + (row.qty ?? 0), 0));
    const scores = FIXTURE_ROWS.map((row) => row.score).filter((v): v is number => v !== null);
    expect(result["score"] as number).toBeCloseTo(scores.reduce((a, b) => a + b, 0) / scores.length, 9);
    expect(Number(result["price"])).toBe(9999999.99);
    expect(result["createdAt"]).toBe("2024-03-10T07:00:00.000Z");
    expect(result).not.toHaveProperty("name");
  });

  it("rejects a plan it did not make", () => {
    const q = query();
    expect(() => q.where({ kind: "rows" } as never)).toThrow();
    const plan = q.parse(request([{ columnId: "name", operator: "contains", value: "a" }]));
    expect(() => q.where(plan)).not.toThrow();
    expect(() => q.where({ ...plan })).toThrow();
  });
});
