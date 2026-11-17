import { PGlite } from "@electric-sql/pglite";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { columnsFromDrizzleTable, createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";

export type QueryDemoRow = { id: number; name: string; email: string; role: string; score: number | null; active: boolean | null };
export type LoggedQuery = { sql: string; params: unknown[] };

const users = pgTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  score: integer("score"),
  active: boolean("active"),
});

const FIRST = ["Ada", "Alan", "Grace", "Linus", "Margaret", "Dennis", "Barbara", "Ken", "Radia", "Edsger", "Hedy", "Tim"];
const LAST = ["Lovelace", "Turing", "Hopper", "Torvalds", "Hamilton", "Ritchie", "Liskov", "Thompson", "Perlman", "Dijkstra", "Lamarr", "Berners-Lee"];
const ROLES = ["admin", "member", "viewer"];
const ROW_COUNT = 5000;

/** Opens an in-browser PostgreSQL, seeds it, and wires the query layer to it. Every statement the layer runs goes to `onQuery`. */
export async function createQueryDemo(onQuery: (entry: LoggedQuery) => void) {
  const pg = new PGlite();
  await pg.exec("create table users (id integer primary key, name text not null, email text not null, role text not null, score integer, active boolean)");
  const values = Array.from({ length: ROW_COUNT }, (_, index) => {
    const first = FIRST[index % FIRST.length]!;
    const last = LAST[Math.floor(index / FIRST.length) % LAST.length]!;
    const score = index % 11 === 0 ? "null" : String((index * 37) % 101);
    const active = index % 7 === 0 ? "null" : index % 3 === 0 ? "false" : "true";
    return `(${index + 1}, '${first} ${last}', '${first.toLowerCase()}.${last.toLowerCase()}${index}@example.com', '${ROLES[index % ROLES.length]!}', ${score}, ${active})`;
  });
  await pg.exec(`insert into users values ${values.join(", ")}`);
  const db = drizzle(pg, { logger: { logQuery: (sql, params) => onQuery({ sql, params }) } });
  const columns = columnsFromDrizzleTable(users, {
    pick: ["id", "name", "email", "role", "score", "active"],
    overrides: { name: { searchable: true }, email: { searchable: true }, role: { type: "select", choices: ROLES }, score: { aggregate: "avg" } },
  });
  const query = createDrizzleGridQuery<QueryDemoRow>({ db, table: users, columns });
  return { query, columns, total: ROW_COUNT };
}
