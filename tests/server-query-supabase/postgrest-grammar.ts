/**
 * An independent reader of PostgREST's logic-tree grammar, transcribed from `pLogicTree`, `pLogicSingleVal`, `pListVal`,
 * and `pQuotedValue` in PostgREST's `ApiRequest/QueryParams.hs`. It shares no code with the adapter, so a value that ends
 * its quotes early or adds a condition shows up as a different tree.
 */
export type LogicTree =
  | { group: "and" | "or"; not: boolean; items: LogicTree[] }
  | { field: string; not: boolean; op: string; value: string }
  | { field: string; not: boolean; op: "in"; list: string[] }
  | { field: string; not: boolean; op: "is"; is: string };

const SIMPLE_OPS = ["eq", "neq", "gte", "gt", "lte", "lt", "like", "ilike", "match", "imatch", "isdistinct"];
const IS_VALUES = ["null", "not_null", "true", "false", "unknown"];

class Reader {
  constructor(
    readonly text: string,
    public at = 0,
  ) {}
  peek(): string | undefined {
    return this.text[this.at];
  }
  take(literal: string): boolean {
    if (!this.text.startsWith(literal, this.at)) return false;
    this.at += literal.length;
    return true;
  }
  ws(): void {
    while (this.peek() === " " || this.peek() === "\t") this.at++;
  }
  fail(what: string): never {
    throw new Error(`postgrest grammar: expected ${what} at ${this.at} in ${JSON.stringify(this.text)}`);
  }
}

/** `try p`: runs `p`, and on failure rewinds and answers `undefined`. */
function attempt<T>(r: Reader, p: () => T): T | undefined {
  const start = r.at;
  try {
    return p();
  } catch {
    r.at = start;
    return undefined;
  }
}

/** `pQuotedValue`: a backslash takes the next character literally; only an unescaped `"` ends the value. */
function quoted(r: Reader): string {
  if (!r.take('"')) r.fail("opening quote");
  let out = "";
  for (;;) {
    const char = r.peek();
    if (char === undefined) r.fail("closing quote");
    r.at++;
    if (char === '"') return out;
    if (char === "\\") {
      const next = r.peek();
      if (next === undefined) r.fail("escaped character");
      out += next;
      r.at++;
    } else out += char;
  }
}

/** `notFollowedBy (noneOf ",)")`: the end of input, a comma, or a closing parenthesis. */
function atValueEnd(r: Reader): boolean {
  const next = r.peek();
  return next === undefined || next === "," || next === ")";
}

function unquoted(r: Reader): string {
  let out = "";
  while (r.peek() !== undefined && r.peek() !== "," && r.peek() !== ")") out += r.text[r.at++];
  return out;
}

/** `pLogicSingleVal`: a quoted value at a value end, else a `{...}` array literal, else the raw text up to `,` or `)`. */
function singleValue(r: Reader): string {
  const value = attempt(r, () => {
    const text = quoted(r);
    if (!atValueEnd(r)) r.fail("value end");
    return text;
  });
  if (value !== undefined) return value;
  const array = attempt(r, () => {
    if (!r.take("{")) r.fail("{");
    let body = "";
    while (r.peek() !== undefined && r.peek() !== "{" && r.peek() !== "}") body += r.text[r.at++];
    if (!r.take("}")) r.fail("}");
    return `{${body}}`;
  });
  return array ?? unquoted(r);
}

/** `pListVal`: `(` elements separated by `,` `)`, each a quoted value at a value end or raw text. */
function listValue(r: Reader): string[] {
  r.ws();
  if (!r.take("(")) r.fail("(");
  r.ws();
  const items: string[] = [];
  do {
    const value = attempt(r, () => {
      const text = quoted(r);
      if (!atValueEnd(r)) r.fail("value end");
      return text;
    });
    items.push(value ?? unquoted(r));
  } while (r.take(","));
  r.ws();
  if (!r.take(")")) r.fail(")");
  r.ws();
  return items;
}

/** `pFieldName`: a quoted name, or identifier characters (letters, digits, `_`, space, `$`) joined by single dashes. */
function fieldName(r: Reader): string {
  if (r.peek() === '"') return quoted(r);
  let name = "";
  while (r.peek() !== undefined && /[\p{L}\p{N}_ $-]/u.test(r.peek()!)) {
    if (r.peek() === "-" && r.text[r.at + 1] === ">") break;
    name += r.text[r.at++];
  }
  if (name.trim() === "") r.fail("field name");
  return name.trim();
}

function filter(r: Reader): LogicTree {
  r.ws();
  const field = fieldName(r);
  r.ws();
  if (!r.take(".")) r.fail(".");
  const not = r.take("not.");
  if (r.take("in.")) return { field, not, op: "in", list: listValue(r) };
  if (r.take("is.")) {
    const is = IS_VALUES.find((word) => r.text.slice(r.at, r.at + word.length).toLowerCase() === word);
    if (!is) r.fail("is value");
    r.at += is.length;
    return { field, not, op: "is", is };
  }
  const op = SIMPLE_OPS.find((name) => r.text.startsWith(`${name}.`, r.at));
  if (!op) r.fail("operator");
  r.at += op.length + 1;
  return { field, not, op, value: singleValue(r) };
}

function tree(r: Reader): LogicTree {
  const leaf = attempt(r, () => filter(r));
  if (leaf) return leaf;
  const not = r.take("not.");
  const group = r.take("and") ? "and" : r.take("or") ? "or" : r.fail("and or or");
  r.ws();
  if (!r.take("(")) r.fail("(");
  r.ws();
  const items: LogicTree[] = [];
  do {
    r.ws();
    items.push(tree(r));
    r.ws();
  } while (r.take(","));
  if (!r.take(")")) r.fail(")");
  r.ws();
  return { group, not, items };
}

/** Parses the value of an `or=` or `and=` parameter the way PostgREST does (`op <> v`), and requires the whole input. */
export function parseLogicParam(op: "and" | "or", value: string): LogicTree {
  const r = new Reader(`${op}${value}`);
  const parsed = tree(r);
  if (r.at !== r.text.length) r.fail("end of input");
  return parsed;
}

/** PostgREST reads the one-element list `[""]` as the empty list (`= ANY('{}')`), whatever its quoting. */
export const isEmptyList = (list: readonly string[]): boolean => list.length === 1 && list[0] === "";
