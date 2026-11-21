import { drizzle } from "drizzle-orm/better-sqlite3";
import type { SQL } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { type GridQuery, handleGridRequest } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { openSqlite, sqliteItems } from "./engines";
import { FIXTURE_ROWS } from "./fixture";

type Context = { tenantId: number };

describe("save on SQLite through Drizzle", async () => {
  const { database, harnesses } = await openSqlite();
  afterAll(() => database.close());
  const db = drizzle(database);
  const query = harnesses.find((h) => h.adapter === "drizzle")!.make({ rowScope: true }) as unknown as GridQuery<Record<string, unknown>, Context, SQL>;
  const found = (where: SQL | undefined) => where === undefined || db.select().from(sqliteItems).where(where).all().length > 0;
  const run = query.save(async (change) =>
    db.transaction((tx) => {
      for (const insert of change.inserts) tx.insert(sqliteItems).values(insert.values as typeof sqliteItems.$inferInsert).run();
      return {
        updates: change.updates.map((write) => tx.update(sqliteItems).set(write.values).where(write.where).run().changes),
        deletes: change.deletes.map((write) => tx.delete(sqliteItems).where(write.where).run().changes),
        // The fixture has no order column: a move counts 1 when its row and its neighbors are in scope.
        moves: change.moves.map((write) => (found(write.where) && found(write.beforeWhere) && found(write.afterWhere) ? 1 : 0)),
      };
    }),
  );
  const post = async (ops: unknown[]) => {
    const response = await handleGridRequest(new Request("http://x/", { method: "POST", body: JSON.stringify({ ops, source: "edit" }) }), run, { context: { tenantId: 1 } });
    return response.json();
  };
  const stored = (id: number) => database.prepare('select name, "tenantId" from items where id = ?').get(id) as { name: string; tenantId: number } | undefined;
  const notFound = (id: number) => ({ rowId: String(id), code: "not-found", message: "Not found" });
  const [own, other, ownNeighbor, otherToDelete] = [FIXTURE_ROWS[0]!, FIXTURE_ROWS[1]!, FIXTURE_ROWS[2]!, FIXTURE_ROWS[3]!];

  it("writes the row of the call's tenant and refuses another tenant's row as not-found", async () => {
    expect([own.tenantId, other.tenantId, ownNeighbor.tenantId, otherToDelete.tenantId]).toEqual([1, 2, 1, 2]);
    const rename = (id: number) => ({ type: "update", rowId: String(id), row: {}, prev: {}, cells: [{ columnId: "name", value: "Renamed", prev: null }] });
    await expect(post([rename(own.id), rename(other.id), { type: "delete", rowId: String(otherToDelete.id) }])).resolves.toEqual({ rejected: [notFound(other.id), notFound(otherToDelete.id)] });
    expect(stored(own.id)?.name).toBe("Renamed");
    expect(stored(other.id)?.name).toBe(other.name);
    expect(stored(otherToDelete.id)?.name).toBe(otherToDelete.name);
  });

  it("scopes a move's neighbor: another tenant's neighbor answers not-found", async () => {
    await expect(post([{ type: "move", rowId: String(own.id), beforeRowId: String(ownNeighbor.id) }])).resolves.toEqual({ rejected: [] });
    await expect(post([{ type: "move", rowId: String(own.id), beforeRowId: String(other.id) }])).resolves.toEqual({ rejected: [notFound(own.id)] });
  });

  it("inserts with the call's tenant, whatever tenant the row names", async () => {
    await expect(post([{ type: "insert", rowId: "new-0", row: { name: "Inserted", tenantId: 2 }, index: 0 }])).resolves.toEqual({ rejected: [] });
    expect(database.prepare('select "tenantId" from items where name = ?').all("Inserted")).toEqual([{ tenantId: 1 }]);
  });
});
