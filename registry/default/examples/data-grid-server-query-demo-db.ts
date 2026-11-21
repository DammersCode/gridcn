import { PGlite } from "@electric-sql/pglite";
import { boolean, date, integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { DEALERSHIPS, MAKES, REGIONS, generateSales } from "./sales-data";
import { columnsFromDrizzleTable, createDrizzleGridQuery } from "@/registry/default/blocks/data-grid-server-query-drizzle/data-grid-server-query-drizzle";

/** One car sold by a dealership. */
export type QueryDemoRow = {
  id: number;
  soldOn: string;
  region: string;
  dealership: string;
  salesperson: string;
  make: string;
  model: string;
  customer: string;
  price: number;
  discount: number;
  financed: boolean;
};
export type LoggedQuery = { sql: string; params: unknown[] };

const carSales = pgTable("car_sales", {
  id: integer("id").primaryKey(),
  soldOn: date("sold_on", { mode: "string" }).notNull(),
  region: text("region").notNull(),
  dealership: text("dealership").notNull(),
  salesperson: text("salesperson").notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  customer: text("customer").notNull(),
  price: integer("price").notNull(),
  discount: integer("discount").notNull(),
  financed: boolean("financed").notNull(),
});

const ROW_COUNT = 5000;

/** Opens an in-browser PostgreSQL, seeds it with 5,000 fictional car sales, and wires the query layer to it. Every statement the layer runs goes to `onQuery`. */
export async function createQueryDemo(onQuery: (entry: LoggedQuery) => void) {
  const pg = new PGlite();
  await pg.exec(
    "create table car_sales (id integer primary key, sold_on date not null, region text not null, dealership text not null, salesperson text not null, make text not null, model text not null, customer text not null, price integer not null, discount integer not null, financed boolean not null)",
  );
  // The seed names hold no quote, so plain interpolation stays valid SQL.
  const values = generateSales(ROW_COUNT).map((sale, index) => `(${index + 1}, '${sale.soldOn}', '${sale.region}', '${sale.dealership}', '${sale.salesperson}', '${sale.make}', '${sale.model}', '${sale.customer}', ${sale.price}, ${sale.discount}, ${sale.financed})`);
  await pg.exec(`insert into car_sales values ${values.join(", ")}`);
  const db = drizzle(pg, { logger: { logQuery: (sql, params) => onQuery({ sql, params }) } });
  const columns = columnsFromDrizzleTable(carSales, {
    pick: ["id", "soldOn", "region", "dealership", "salesperson", "make", "model", "customer", "price", "discount", "financed"],
    overrides: {
      customer: { searchable: true },
      salesperson: { searchable: true },
      model: { searchable: true },
      region: { type: "select", choices: REGIONS },
      dealership: { type: "select", choices: DEALERSHIPS },
      make: { type: "select", choices: MAKES },
      price: { aggregate: "sum" },
    },
  });
  const query = createDrizzleGridQuery<QueryDemoRow>({ db, table: carSales, columns });
  return { query, columns, total: ROW_COUNT };
}
