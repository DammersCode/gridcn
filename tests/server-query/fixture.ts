import { defineColumnMap } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";

export type FixtureRow = {
  id: number;
  name: string | null;
  tag: string | null;
  score: number | null;
  qty: number | null;
  active: boolean | null;
  price: string | null;
  createdAt: string | null;
  tenantId: number;
};

const NAMES: (string | null)[] = [
  "alpha", "Alpha", "ALPHA", "beta", "Beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota",
  "100% sure", "a_b", "a!b", "back\\slash", "[bracket]", "star*", "quote'd", "dash--dash", "semi;colon", "percent%", "under_score", "x",
  "", null, "  ", "alpha beta", "Gamma ray", "Émile", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigma", "tau", "upsilon",
];
const TAGS: (string | null)[] = ["red", "green", "blue", "Red", null, ""];
const SCORES: (number | null)[] = [0, 1, -1, 1.5, 2.25, -3.75, 10, 100.5, null, 0.1];
const QTYS: (number | null)[] = [0, 1, 2, 5, -4, 100, 32767, -32768, null, 7];
const ACTIVE: (boolean | null)[] = [true, false, null];
const PRICES: (string | null)[] = ["0.00", "12.50", "-3.25", "9999999.99", null, "1.05"];
const STAMPS: (string | null)[] = [
  "2024-01-01T00:00:00.000Z", "2024-01-01T23:59:59.999Z", "2024-01-02T00:00:00.000Z", "2024-03-10T06:59:59.000Z", "2024-03-10T07:00:00.000Z", "2023-12-31T23:00:00.000Z", null,
];

export const FIXTURE_ROWS: readonly FixtureRow[] = NAMES.map((name, index) => ({
  id: index + 1,
  name,
  tag: TAGS[index % TAGS.length]!,
  score: SCORES[index % SCORES.length]!,
  qty: QTYS[(index * 3) % QTYS.length]!,
  active: ACTIVE[index % ACTIVE.length]!,
  price: PRICES[index % PRICES.length]!,
  createdAt: STAMPS[index % STAMPS.length]!,
  tenantId: index % 2 === 0 ? 1 : 2,
}));

export type Engine = "sqlite" | "pg";

export function fixtureColumns(engine: Engine, search: "default" | "none" = "default") {
  return defineColumnMap({
    id: { type: "number", numeric: "int8", primaryKey: true },
    name: { type: "text", searchable: search === "default" },
    tag: { type: "select", choices: ["red", "green", "blue", "Red"], searchable: search === "default" },
    score: { type: "number", numeric: "float", aggregate: "avg" },
    qty: { type: "number", numeric: "int4", aggregate: "sum" },
    active: { type: "checkbox" },
    price: { type: "number", numeric: "decimal", scale: 2, aggregate: "max" },
    createdAt: { type: "date", time: true, storage: engine === "pg" ? "native" : "iso-text", aggregate: "max" },
    tenantId: { type: "number", numeric: "int4", serverOnly: true },
  });
}

export const SQLITE_DDL = `create table items (
  id integer primary key, name text, tag text, score real, qty integer, active integer, price numeric, "createdAt" text, "tenantId" integer not null
)`;
export const PG_DDL = `create table items (
  id bigint primary key, name text, tag text, score double precision, qty integer, active boolean, price numeric(12,2), "createdAt" timestamptz, "tenantId" integer not null
)`;

/** The fixture map with one column per reducer, so each reducer is a request-able aggregate. */
export function groupColumns(engine: Engine) {
  return defineColumnMap({
    id: { type: "number", numeric: "int8", primaryKey: true },
    name: { type: "text", searchable: true },
    tag: { type: "select", choices: ["red", "green", "blue", "Red"], searchable: true },
    score: { type: "number", numeric: "float", aggregate: "avg" },
    qty: { type: "number", numeric: "int4", aggregate: "sum" },
    qtyMin: { type: "number", numeric: "int4", field: "qty", aggregate: "min" },
    qtyMax: { type: "number", numeric: "int4", field: "qty", aggregate: "max" },
    nameCount: { type: "text", field: "name", aggregate: "count" },
    active: { type: "checkbox" },
    price: { type: "number", numeric: "decimal", scale: 2, aggregate: "max" },
    createdAt: { type: "date", time: true, storage: engine === "pg" ? "native" : "iso-text", aggregate: "max" },
    tenantId: { type: "number", numeric: "int4", serverOnly: true, aggregate: "sum" },
  });
}
