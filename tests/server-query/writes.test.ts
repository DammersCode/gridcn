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
  const run = query.save(async (change) => ({
    updates: change.updates.map((write) => db.update(sqliteItems).set(write.values).where(write.where).run().changes),
    deletes: change.deletes.map((write) => db.delete(sqliteItems).where(write.where).run().changes),
    moves: change.moves.map(() => 0),
  }));
  const stored = (id: number) => database.prepare("select name from items where id = ?").get(id) as { name: string } | undefined;
  const [own, other, otherToDelete] = [FIXTURE_ROWS[0]!, FIXTURE_ROWS[1]!, FIXTURE_ROWS[3]!];

  it("writes the row of the call's tenant and refuses another tenant's row as not-found", async () => {
    expect([own.tenantId, other.tenantId, otherToDelete.tenantId]).toEqual([1, 2, 2]);
    const rename = (id: number) => ({ type: "update", rowId: String(id), row: {}, prev: {}, cells: [{ columnId: "name", value: "Renamed", prev: null }] });
    const body = JSON.stringify({ ops: [rename(own.id), rename(other.id), { type: "delete", rowId: String(otherToDelete.id) }], source: "edit" });
    const response = await handleGridRequest(new Request("http://x/", { method: "POST", body }), run, { context: { tenantId: 1 } });
    expect(await response.json()).toEqual({
      rejected: [
        { rowId: String(other.id), code: "not-found", message: "Not found" },
        { rowId: String(otherToDelete.id), code: "not-found", message: "Not found" },
      ],
    });
    expect(stored(own.id)?.name).toBe("Renamed");
    expect(stored(other.id)?.name).toBe(other.name);
    expect(stored(otherToDelete.id)?.name).toBe(otherToDelete.name);
  });
});
