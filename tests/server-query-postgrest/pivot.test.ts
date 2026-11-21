// @vitest-environment node
import { describe, expect, it } from "vitest";
import { defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { createSupabaseGridQuery } from "@/registry/default/blocks/data-grid-server-query-supabase/data-grid-server-query-supabase";
import { FIXTURE_ROWS } from "../server-query/fixture";
import { expectArrayAndCompositeLevels, expectLevelsLike, viewColumns } from "../server-query-supabase/pivot-oracle";
import { VIA, client, live } from "./live";

const stampColumns = defineColumnMap({
  id: { type: "number", numeric: "int4", primaryKey: true },
  at: { type: "date", time: true },
  atz: { type: "date", time: true },
  atMs: { type: "date", time: true, field: "at_ms" },
  atzMs: { type: "date", time: true, field: "atz_ms" },
  secs: { type: "date", time: true, storage: "epoch-s" },
});

type Query = { fetchRows(input: unknown): Promise<unknown> };
const ids = async (query: Query, spec: Record<string, unknown>, groupPath?: unknown[]) =>
  ((await query.fetchRows({ spec: { sorts: [{ columnId: "id", direction: "asc" }], ...spec }, ...(groupPath ? { groupPath, childKind: "rows" } : {}), start: 0, end: 100 })) as { rows: { id: unknown }[] }).rows.map((row) => row.id);
const equals = (columnId: string, value: string) => ({ filters: [{ columnId, operator: "equals", value }] });

describe.skipIf(!live)("the Supabase adapter's pivot and instants against a live PostgREST", () => {
  it("holds the fixture rows the client oracle reads", async () => {
    const { data } = await client(1).from("fixture_items").select("*").order("id");
    const read = (data as Record<string, unknown>[]).map((row) => ({ ...row, price: row["price"] === null ? null : Number(row["price"]), createdAt: row["createdAt"] === null ? null : Date.parse(row["createdAt"] as string) }));
    expect(read).toEqual(FIXTURE_ROWS.map((row) => ({ ...row, price: row.price === null ? null : Number(row.price), createdAt: row.createdAt === null ? null : Date.parse(row.createdAt) })));
  });

  describe.each(Object.entries(VIA))("over %s", (_via, options) => {
    const view = () => createSupabaseGridQuery({ client: client(1), table: "fixture_view", columns: viewColumns, rpc: "fixture_grid", ...options });
    const stamps = () => createSupabaseGridQuery({ client: client(1), table: "stamps", columns: stampColumns, rpc: "stamps_grid", ...options });

    it("matches the client at every depth of two to four pivot levels, the empty group included", async () => {
      await expectLevelsLike(view);
    });

    it("matches the client over an array and a composite group level under pivot, and drills only the array", async () => {
      await expectArrayAndCompositeLevels(view);
    });

    it("refuses the rows of a composite group key, as PostgREST cannot read a composite filter value", async () => {
      // The count's HEAD answer has no message, so either request can reject first.
      await expect(ids(view(), { groupBy: ["pair"] }, [{ columnId: "pair", key: "(red)" }])).rejects.toThrow(/^Supabase request failed: (input of anonymous composite types is not implemented|HTTP 400|gridcn: the column "pair" has no default btree operator class)$/);
    });

    it("refuses to group a time column with a key past the millisecond, a zoneless timestamp included", async () => {
      for (const columnId of ["at", "atz"]) {
        await expect(stamps().fetchRows({ spec: { groupBy: [columnId] }, start: 0, end: 10, childKind: "groups" })).rejects.toMatchObject({ code: "unsupported", path: ["spec", "groupBy", columnId] });
      }
    });

    it("groups millisecond keys of both types and drills each key to its own row", async () => {
      for (const columnId of ["atMs", "atzMs"]) {
        const answer = (await stamps().fetchRows({ spec: { groupBy: [columnId] }, start: 0, end: 10, childKind: "groups" })) as { groups: { key: unknown }[] };
        expect(answer.groups.map((group) => group.key)).toEqual(["2024-01-01T10:00:00.123Z", "2024-01-01T10:00:00.124Z", null]);
        const drilled = await Promise.all(answer.groups.map((group) => ids(stamps(), { groupBy: [columnId] }, [{ columnId, key: group.key }])));
        expect(drilled).toEqual([[1], [2], [3]]);
      }
    });

    it("refuses a filter instant past the millisecond and matches a millisecond instant exactly", async () => {
      for (const columnId of ["at", "atz"]) {
        for (const value of ["2024-01-01T10:00:00.123456Z", "2024-01-01 10:00:00.123456"]) {
          await expect(ids(stamps(), equals(columnId, value))).rejects.toMatchObject({ code: "unsupported-value" });
        }
        expect(await ids(stamps(), equals(columnId, "2024-01-01T10:00:00.123Z"))).toEqual([2]);
      }
    });

    it("rounds an epoch-s bound with a fraction to the whole second that keeps the same rows, and refuses an exact test with one", async () => {
      const seconds = [1_704_103_200, 1_704_103_201, -1];
      const compare = { gt: (a: number, b: number) => a > b, gte: (a: number, b: number) => a >= b, lt: (a: number, b: number) => a < b, lte: (a: number, b: number) => a <= b };
      for (const value of ["2024-01-01T10:00:00.500Z", "1969-12-31T23:59:59.500Z"]) {
        for (const [operator, keep] of Object.entries(compare)) {
          const want = seconds.flatMap((secs, index) => (keep(secs * 1000, Date.parse(value)) ? [index + 1] : []));
          expect(await ids(stamps(), { filters: [{ columnId: "secs", operator, value }] }), `${operator} ${value}`).toEqual(want);
        }
      }
      await expect(ids(stamps(), equals("secs", "2024-01-01T10:00:00.500Z"))).rejects.toMatchObject({ code: "unsupported-value" });
    });
  });
});
