import type { FilterTree } from "./client-oracle";
import { FIXTURE_ROWS, type FixtureRow } from "./fixture";

export type Case = {
  name: string;
  filters: FilterTree;
  /** "oracle": the client filter engine decides. Otherwise the ids the server must return, with the reason they differ from the client. */
  expect: "oracle" | { ids: number[]; because: string };
};

const leaf = (columnId: string, operator: string, value?: unknown) => ({ columnId, operator, ...(value === undefined ? {} : { value }) });
const ids = (keep: (row: FixtureRow) => boolean): number[] => FIXTURE_ROWS.filter(keep).map((row) => row.id);

const oracleCases: Case[] = [];
const add = (name: string, filters: FilterTree) => oracleCases.push({ name, filters, expect: "oracle" });

for (const value of ["alpha", "ALPHA", "a_", "%", "!", "\\", "*", "'", "--", "[", "]", ";", "sure", "  ", "Gamma"]) add(`name contains ${JSON.stringify(value)}`, [leaf("name", "contains", value)]);
for (const value of ["alpha", "Beta", "x", "none"]) {
  add(`name notContains ${JSON.stringify(value)}`, [leaf("name", "notContains", value)]);
  add(`name equals ${JSON.stringify(value)}`, [leaf("name", "equals", value)]);
  add(`name notEquals ${JSON.stringify(value)}`, [leaf("name", "notEquals", value)]);
}
for (const value of ["al", "a", "100", "[b"]) add(`name startsWith ${JSON.stringify(value)}`, [leaf("name", "startsWith", value)]);
for (const value of ["a", "ta", "%"]) add(`name endsWith ${JSON.stringify(value)}`, [leaf("name", "endsWith", value)]);
for (const operator of ["empty", "notEmpty"]) add(`name ${operator}`, [leaf("name", operator)]);
for (const operator of ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"]) add(`name ${operator} blank operand`, [leaf("name", operator, "")]);
for (const operator of ["isAnyOf", "isNoneOf"]) {
  for (const list of [["alpha", "BETA"], ["alpha", ""], [""], [], ["x", "no such"]]) add(`name ${operator} ${JSON.stringify(list)}`, [leaf("name", operator, list)]);
}
add("name isAnyOf non-ASCII", [leaf("name", "isAnyOf", ["Émile"])]);
add("name isNoneOf non-ASCII", [leaf("name", "isNoneOf", ["Émile"])]);
for (const operator of ["equals", "notEquals", "contains"]) add(`tag ${operator} red`, [leaf("tag", operator, "red")]);
for (const operator of ["isAnyOf", "isNoneOf"]) add(`tag ${operator}`, [leaf("tag", operator, ["red", "BLUE"])]);
add("tag empty", [leaf("tag", "empty")]);
add("tag notEmpty", [leaf("tag", "notEmpty")]);

for (const column of ["qty", "score"]) {
  for (const operator of ["gt", "gte", "lt", "lte"]) {
    for (const value of ["1", "0.5", "-1", "2.5", "100000000000000000000"]) add(`${column} ${operator} ${value}`, [leaf(column, operator, value)]);
  }
  for (const range of [["1", "5"], ["", "5"], ["1", ""], ["", ""], ["-1", "2"]]) add(`${column} isBetween ${JSON.stringify(range)}`, [leaf(column, "isBetween", range)]);
  for (const operator of ["isAnyOf", "isNoneOf"]) add(`${column} ${operator}`, [leaf(column, operator, ["1", "2", "0"])]);
  for (const operator of ["empty", "notEmpty"]) add(`${column} ${operator}`, [leaf(column, operator)]);
  add(`${column} equals 5`, [leaf(column, "equals", "5")]);
  add(`${column} notEquals 5`, [leaf(column, "notEquals", "5")]);
}
add("qty equals non-integer", [leaf("qty", "equals", "5.5")]);
add("qty lt width overflow", [leaf("qty", "lt", "99999999999")]);
add("qty gt width underflow", [leaf("qty", "gt", "-99999999999")]);
add("score equals 1.5", [leaf("score", "equals", "1.5")]);

for (const value of ["true", "false"]) {
  add(`active equals ${value}`, [leaf("active", "equals", value)]);
  add(`active notEquals ${value}`, [leaf("active", "notEquals", value)]);
  add(`active isAnyOf ${value}`, [leaf("active", "isAnyOf", [value])]);
  add(`active isNoneOf ${value}`, [leaf("active", "isNoneOf", [value])]);
}
add("active empty", [leaf("active", "empty")]);
add("active notEmpty", [leaf("active", "notEmpty")]);

for (const operator of ["gt", "gte", "lt", "lte"]) for (const value of ["0", "5", "-3", "12.5", "100"]) add(`price ${operator} ${value}`, [leaf("price", operator, value)]);
add("price isBetween", [leaf("price", "isBetween", ["0", "20"])]);

add("or group", [{ join: "or", filters: [leaf("name", "equals", "alpha"), leaf("qty", "gt", "50")] }]);
add("and of or groups", [{ join: "or", filters: [leaf("tag", "equals", "red"), leaf("active", "equals", "true")] }, leaf("qty", "lt", "50")]);
add("nested group", [{ join: "and", filters: [{ join: "or", filters: [leaf("name", "contains", "a"), leaf("name", "contains", "e")] }, leaf("score", "gt", "0")] }]);
add("empty group", [{ join: "and", filters: [] }]);
add("no filters", []);

export const ORACLE_CASES = oracleCases;

const day = (iso: string) => iso.slice(0, 10);
export const SERVER_CASES: Case[] = [
  { name: "decimal equals is numeric", filters: [leaf("price", "equals", "12.5")], expect: { because: "the client compares text", ids: ids((r) => r.price !== null && Number(r.price) === 12.5) } },
  { name: "int equals 1e1 is numeric", filters: [leaf("qty", "equals", "1e1")], expect: { because: "the client compares text", ids: ids((r) => r.qty === 10) } },
  { name: "createdAt equals a day", filters: [leaf("createdAt", "equals", "2024-01-01")], expect: { because: "day range, not text equality", ids: ids((r) => r.createdAt !== null && day(r.createdAt) === "2024-01-01") } },
  { name: "createdAt notEquals a day keeps NULL", filters: [leaf("createdAt", "notEquals", "2024-01-01")], expect: { because: "day range", ids: ids((r) => r.createdAt === null || day(r.createdAt) !== "2024-01-01") } },
  { name: "createdAt gt a day", filters: [leaf("createdAt", "gt", "2024-01-01")], expect: { because: "day range", ids: ids((r) => r.createdAt !== null && day(r.createdAt) > "2024-01-01") } },
  { name: "createdAt lte a day", filters: [leaf("createdAt", "lte", "2024-01-01")], expect: { because: "day range", ids: ids((r) => r.createdAt !== null && day(r.createdAt) <= "2024-01-01") } },
  { name: "createdAt isBetween days", filters: [leaf("createdAt", "isBetween", ["2024-01-01", "2024-01-02"])], expect: { because: "day range", ids: ids((r) => r.createdAt !== null && day(r.createdAt) >= "2024-01-01" && day(r.createdAt) <= "2024-01-02") } },
  { name: "createdAt isAnyOf days", filters: [leaf("createdAt", "isAnyOf", ["2024-01-01", "2024-03-10"])], expect: { because: "day range", ids: ids((r) => r.createdAt !== null && ["2024-01-01", "2024-03-10"].includes(day(r.createdAt))) } },
  { name: "createdAt isNoneOf days", filters: [leaf("createdAt", "isNoneOf", ["2024-01-01"])], expect: { because: "day range", ids: ids((r) => r.createdAt === null || day(r.createdAt) !== "2024-01-01") } },
  { name: "createdAt gte instant", filters: [leaf("createdAt", "gte", "2024-01-01T23:59:59.999Z")], expect: { because: "instant compare", ids: ids((r) => r.createdAt !== null && r.createdAt >= "2024-01-01T23:59:59.999Z") } },
];
