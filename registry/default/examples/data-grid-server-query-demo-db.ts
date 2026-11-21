import { PGlite } from "@electric-sql/pglite";
import { boolean, date, integer, pgTable, text } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
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

const REGIONS = ["North", "South", "East", "West"];
const DEALERSHIPS = ["Northgate Motors", "Pine Ridge Cars", "Bayview Autos", "Southfield Motors", "Eastbrook Cars", "Harbor Point Motors", "Westlake Autos", "Canyon Road Motors"];
const SALESPEOPLE = ["Dana Brooks", "Eli Moreno", "Fern Walsh", "Gus Ortega", "Hana Ito", "Ivan Petrov", "Jade Lin", "Kofi Mensah", "Lena Fischer", "Milo Grant", "Nia Duarte", "Omar Aziz", "Pia Lund", "Raul Vega", "Sana Mir", "Theo Clark"];
const MAKES = ["Kestrel", "Marlow", "Nordvik", "Solenne", "Vantor"];
const MODELS = [["Brook", "Glide", "Summit"], ["Coast", "Harbor", "Tide"], ["Birch", "Fjord", "Frost"], ["Dawn", "Lumen", "Opal"], ["Ember", "Flint", "Quarry"]];
const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Robin"];
const LAST = ["Smith", "Garcia", "Chen", "Patel", "Novak", "Okafor", "Larsen", "Rossi", "Kim", "Silva", "Meyer", "Haddad"];
const ROW_COUNT = 5000;

const pad = (value: number) => String(value).padStart(2, "0");

/** Opens an in-browser PostgreSQL, seeds it with 5,000 fictional car sales, and wires the query layer to it. Every statement the layer runs goes to `onQuery`. */
export async function createQueryDemo(onQuery: (entry: LoggedQuery) => void) {
  const pg = new PGlite();
  await pg.exec(
    "create table car_sales (id integer primary key, sold_on date not null, region text not null, dealership text not null, salesperson text not null, make text not null, model text not null, customer text not null, price integer not null, discount integer not null, financed boolean not null)",
  );
  // The seed names hold no quote, so plain interpolation stays valid SQL.
  const values = Array.from({ length: ROW_COUNT }, (_, index) => {
    const region = index % REGIONS.length;
    const make = Math.floor(index / REGIONS.length) % MAKES.length;
    const model = Math.floor(index / 20) % 3;
    const dealership = region * 2 + (Math.floor(index / 60) % 2);
    const salesperson = SALESPEOPLE[dealership * 2 + (Math.floor(index / 120) % 2)]!;
    const customer = `${FIRST[Math.floor(index / 5) % FIRST.length]!} ${LAST[(index * 7) % LAST.length]!}`;
    const soldOn = `2025-${pad(((index * 5) % 12) + 1)}-${pad(((index * 11) % 28) + 1)}`;
    const price = 21000 + make * 6000 + model * 9000 + ((index * 37) % 41) * 100;
    const discount = ((index * 7) % 13) * 250;
    return `(${index + 1}, '${soldOn}', '${REGIONS[region]!}', '${DEALERSHIPS[dealership]!}', '${salesperson}', '${MAKES[make]!}', '${MODELS[make]![model]!}', '${customer}', ${price}, ${discount}, ${index % 3 !== 0})`;
  });
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
