// @vitest-environment node
import { describe, expect, it } from "vitest";
import { QueryError } from "@/registry/default/blocks/data-grid-server-query/data-grid-server-query";
import { quote } from "@/registry/default/blocks/data-grid-server-query-supabase/quote";
import { type LogicTree, parseLogicParam } from "./postgrest-grammar";

const HOSTILE = [
  "",
  " ",
  "  padded  ",
  "a,b",
  "a)b",
  "(a",
  ")",
  "),tenantId.neq.(7",
  '"',
  '""',
  '"),id.gt.(0',
  '\\"),id.gt.(0',
  "\\",
  "trailing\\",
  "\\\\",
  'a"b\\c"d',
  ":",
  "a.b",
  ".",
  "eq.1",
  "*",
  "%_",
  "{a,b}",
  "{",
  "}",
  "null",
  "NULL",
  "true",
  "false",
  "-1",
  "-",
  "__proto__",
  "constructor",
  "line\nbreak",
  "tab\tvalue",
  "carriage\r\nreturn",
  "nul\u0000byte",
  "emoji 😀 and ünïcödé",
  "רוח",
  "‮bidi",
  "a&b=c",
  "a+b",
  "%2C%29",
  "x".repeat(10_000),
  ",".repeat(500) + ")".repeat(500),
  "and(id.eq.1)",
  "not.or(a.is.null)",
];

/** The `or=` value a client sends for one tree, through the URL encoding of `URLSearchParams` and back. */
function roundTrip(tree: string): LogicTree {
  const url = new URL("https://example.test/rest/v1/items");
  url.searchParams.append("or", `(${tree})`);
  const sent = new URL(url.href).searchParams.get("or")!;
  return parseLogicParam("or", sent);
}

const expected = (value: string, other: string): LogicTree => ({
  group: "or",
  not: false,
  items: [
    {
      group: "and",
      not: false,
      items: [
        { field: "name", not: false, op: "eq", value },
        { field: "tenantId", not: false, op: "eq", value: "7" },
      ],
    },
    { field: "id", not: true, op: "in", list: [value, other] },
  ],
});

const treeOf = (value: string, other: string) => `and(name.eq.${quote(value)},tenantId.eq.${quote("7")}),id.not.in.(${quote(value)},${quote(other)})`;

/** A deterministic generator over the grammar's own characters, so a failure reproduces. */
function* randomValues(count: number): Generator<string> {
  const alphabet = [..."\"\\,().:*{} \t\n-%_ab", "😀", "\u0000"];
  let seed = 0x2545f491;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  for (let index = 0; index < count; index++) {
    const length = Math.floor(next() * 24);
    let value = "";
    for (let char = 0; char < length; char++) value += alphabet[Math.floor(next() * alphabet.length)];
    yield value;
  }
}

describe("quote", () => {
  it("wraps the value in double quotes and escapes only the double quote and the backslash", () => {
    expect(quote("plain")).toBe('"plain"');
    expect(quote("")).toBe('""');
    expect(quote('a"b')).toBe('"a\\"b"');
    expect(quote("a\\b")).toBe('"a\\\\b"');
    expect(quote("a,b)")).toBe('"a,b)"');
  });

  it.each(HOSTILE.map((value) => [value.length > 40 ? `${value.slice(0, 40)}… (${value.length})` : JSON.stringify(value), value]))(
    "keeps %s one value: the parsed tree equals the intended tree",
    (_label, value) => {
      expect(roundTrip(treeOf(value, "x"))).toEqual(expected(value, "x"));
    },
  );

  it("keeps every pair of hostile values in their places", () => {
    for (const value of HOSTILE.slice(0, 30)) for (const other of HOSTILE.slice(0, 30)) expect(roundTrip(treeOf(value, other))).toEqual(expected(value, other));
  });

  it("keeps 5,000 generated values from the grammar's characters in their places", () => {
    const values = [...randomValues(5_000)];
    values.forEach((value, index) => expect(roundTrip(treeOf(value, values[(index + 1) % values.length]!))).toEqual(expected(value, values[(index + 1) % values.length]!)));
  });

  it("the reader catches an unquoted value that adds a condition", () => {
    const injected = "x,tenantId.neq.7";
    expect(roundTrip(`name.eq.${injected}`)).toEqual({
      group: "or",
      not: false,
      items: [
        { field: "name", not: false, op: "eq", value: "x" },
        { field: "tenantId", not: false, op: "neq", value: "7" },
      ],
    });
    expect(roundTrip(`name.eq.${quote(injected)}`)).toEqual({ group: "or", not: false, items: [{ field: "name", not: false, op: "eq", value: injected }] });
    // A quote that a later character does not end falls back to raw text, so naive quoting is not enough.
    expect(roundTrip(`name.eq."a"b`)).toEqual({ group: "or", not: false, items: [{ field: "name", not: false, op: "eq", value: '"a"b' }] });
  });

  it("refuses a lone surrogate, which the URL encoding would turn into another value", () => {
    expect(() => quote("a\uD800b")).toThrow(QueryError);
    expect(() => quote("\uDC00")).toThrow(QueryError);
    expect(quote("😀")).toBe('"😀"');
  });
});
