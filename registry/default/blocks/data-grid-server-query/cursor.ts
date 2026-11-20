import { type ColumnMap, type PlanColumn, mapOf } from "./column-map";
import { QueryError } from "./errors";
import type { ResolvedLimits } from "./limits";
import { parseDate, parseInstant } from "./operands";
import { type Operand, type OrderTerm, type Predicate, type RowsPlan, combine, leaf } from "./plan";
import { instantText, serializeValue } from "./serialize-row";
import { toSafeText } from "./safe-text";
import { keyOperand } from "./validate-change";

/**
 * A keyset cursor is base64url JSON `[1, planHash, ...keyTexts]`: one text or `null` per order term. It holds only values the
 * client could send as filters, so it carries no signature; the hash only marks a cursor of another filter or order stale.
 */
const VERSION = 1;
// `[1,"` + 16 hex digits + `"` + `]`.
const HEADER_BYTES = 22;
const CURSOR_TEXT = /^[A-Za-z0-9_-]+$/;
// The longest text `INSTANT_KEY` accepts.
const INSTANT_KEY_LENGTH = 32;
const INSTANT_KEY = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[-+]\d{2}:?\d{2})?$/;
const NUMBER_TEXT_LENGTH = new Map<string, number>([["int2", 6], ["int4", 11], ["int8", 20], ["float", 24]]);
// BigInt literals need ES2020 targets; consumer apps may compile lower.
const FNV_OFFSET = BigInt("0xcbf29ce484222325");
const FNV_PRIME = BigInt("0x100000001b3");
const encoder = new TextEncoder();

const badCursor = () => new QueryError("bad-cursor", ["cursor"]);
const isTime = (column: PlanColumn): boolean => column.kind === "date" && column.time;
const isEpoch = (column: PlanColumn): boolean => column.storage === "epoch-ms" || column.storage === "epoch-s";

/** The most JSON bytes one key of the column takes, or `null` for text with no `maxLength`. */
function keyBytes(column: PlanColumn, limits: ResolvedLimits): number | null {
  if (column.kind === "number") return 2 + Math.min(NUMBER_TEXT_LENGTH.get(column.numeric!) ?? Infinity, limits.maxNumberLength);
  if (column.kind === "checkbox") return 7;
  if (column.kind === "date") return 2 + (column.time ? INSTANT_KEY_LENGTH : 10);
  if (column.native === "uuid") return 38;
  const longest = column.native === "enum" ? column.choices!.reduce((most, choice) => Math.max(most, choice.length), 0) : column.maxLength;
  // JSON escapes a control character or a lone surrogate as `\uXXXX`: six bytes for one UTF-16 unit.
  return longest === undefined ? null : 2 + 6 * longest;
}

/** The longest base64url cursor over these key columns, or `null` when one is text with no `maxLength`. */
export function cursorBytes(keys: readonly PlanColumn[], limits: ResolvedLimits): number | null {
  let json = HEADER_BYTES;
  for (const column of keys) {
    const bytes = keyBytes(column, limits);
    if (bytes === null) return null;
    json += 1 + bytes;
  }
  return Math.ceil((json * 4) / 3);
}

/** Throws at creation when a sort the map allows could build a cursor over `maxCursorBytes`, or one with no bound at all. */
export function assertCursorColumns(columns: ColumnMap, limits: ResolvedLimits): void {
  const { visible, tieBreaker } = mapOf(columns);
  for (const column of tieBreaker) {
    if (keyBytes(column, limits) === null) throw new Error(`cursor paging: the tie-breaker "${column.id}" is text without \`maxLength\`; set \`maxLength\` to bound the cursor`);
  }
  for (const column of [undefined, ...visible.filter((entry) => entry.sortable && !tieBreaker.includes(entry))]) {
    if (column && keyBytes(column, limits) === null) {
      throw new Error(`cursor paging: the sortable text column "${column.id}" has no \`maxLength\`, so its cursor has no bound: set \`maxLength\`, or set \`sortable: false\``);
    }
    const bytes = cursorBytes(column ? [column, ...tieBreaker] : tieBreaker, limits)!;
    if (bytes > limits.maxCursorBytes) {
      throw new Error(`cursor paging: a cursor of a sort on "${(column ?? tieBreaker[0]!).id}" can reach ${bytes} bytes, over \`maxCursorBytes\` ${limits.maxCursorBytes}: lower \`maxLength\`, or raise \`maxCursorBytes\``);
    }
  }
}

/** An alias per `time` column for its key text, taken by no column id. */
export function keyTextAliases(columns: ColumnMap): ReadonlyMap<PlanColumn, string> {
  const { byId, visible } = mapOf(columns);
  const aliases = new Map<PlanColumn, string>();
  visible.filter(isTime).forEach((column, index) => {
    let alias = `cursor_key_${index}`;
    while (byId.has(alias)) alias = `_${alias}`;
    aliases.set(column, alias);
  });
  return aliases;
}

function fnv1a64(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * FNV_PRIME);
  return hash.toString(16).padStart(16, "0");
}

const isPlanColumn = (value: unknown): value is PlanColumn => typeof value === "object" && value !== null && "operators" in value && "field" in value;

/** The digest of a parsed plan's filter and order, before `rowScope`; a cursor of another digest is stale. */
export function planHash(plan: Pick<RowsPlan, "where" | "orderBy">): string {
  const text = JSON.stringify([plan.where, plan.orderBy], (_key, value: unknown) => {
    if (typeof value === "bigint") return `${value.toString()}n`;
    return isPlanColumn(value) ? value.id : value;
  });
  return fnv1a64(text);
}

function instantKey(text: string): boolean {
  const match = INSTANT_KEY.exec(text);
  return match !== null && parseDate(match[1]!) !== null && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4]) <= 59;
}

/** A key text parsed by the column's physical type, or `null` when the column cannot hold it. */
function keyFromText(column: PlanColumn, text: string, limits: ResolvedLimits): Operand | null {
  if (isTime(column)) {
    // An epoch key travels as the `toISOString` text the encoder wrote; other storages compare the stored text exactly.
    const valid = isEpoch(column) ? parseInstant(text) === text : instantKey(text);
    return valid ? { kind: "instant", v: text } : null;
  }
  const operand = keyOperand(column, text, limits);
  if (typeof operand === "string") return null;
  if (column.native === "enum") return column.choices!.includes(text) ? operand : null;
  if ((column.kind === "text" || column.kind === "select") && column.maxLength !== undefined && text.length > column.maxLength) return null;
  return operand;
}

type KeyContext = { terms: readonly OrderTerm[]; hash: string; limits: ResolvedLimits; nonNull: (column: PlanColumn) => boolean };

/** The keys of a cursor, in order-term order; every failure is the same `bad-cursor`, which never names the part that failed. */
export function decodeCursor(cursor: unknown, ctx: KeyContext): (Operand | null)[] {
  if (typeof cursor !== "string" || cursor.length > ctx.limits.maxCursorBytes || !CURSOR_TEXT.test(cursor)) throw badCursor();
  let parsed: unknown;
  try {
    const binary = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  } catch {
    throw badCursor();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 + ctx.terms.length || parsed[0] !== VERSION || parsed[1] !== ctx.hash) throw badCursor();
  const entries: unknown[] = parsed;
  return ctx.terms.map(({ column }, index) => {
    const key = entries[index + 2];
    if (key === null && !ctx.nonNull(column)) return null;
    const operand = typeof key === "string" ? keyFromText(column, key, ctx.limits) : null;
    if (!operand) throw badCursor();
    return operand;
  });
}

const notCarried = () => new QueryError("limit-exceeded", ["cursor"]);

/** The key text of one row value: the stored text, the exact `keyText` of a time key, or the number's own digits. */
function keyTextOf(column: PlanColumn, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (isTime(column) && !isEpoch(column)) return typeof raw === "string" ? raw : toSafeText(raw);
  if (isTime(column)) {
    const text = instantText(raw, column);
    if (text === null) throw notCarried();
    return text;
  }
  if (column.kind === "number") {
    if (typeof raw === "string") return raw;
    if (typeof raw === "bigint" || (typeof raw === "number" && Number.isFinite(raw))) return raw.toString();
    throw notCarried();
  }
  if (column.kind === "text" || column.kind === "select") return typeof raw === "string" ? raw : toSafeText(raw);
  const value = serializeValue(raw, column);
  if (value === null) throw notCarried();
  return toSafeText(value);
}

/**
 * The cursor after `row`. A key the cursor cannot carry (stored text over `maxLength`, a number over `maxNumberLength`)
 * throws `limit-exceeded`: the layer never answers a cursor it would refuse.
 */
export function cursorAfter(row: Record<string, unknown>, keyText: ReadonlyMap<PlanColumn, string>, ctx: KeyContext): string {
  const keys = ctx.terms.map(({ column }) => {
    const field = keyText.get(column) ?? column.id;
    return keyTextOf(column, Object.hasOwn(row, field) ? row[field] : null);
  });
  const bytes = encoder.encode(JSON.stringify([VERSION, ctx.hash, ...keys]));
  if (Math.ceil((bytes.length * 4) / 3) > ctx.limits.maxCursorBytes) throw notCarried();
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const cursor = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    decodeCursor(cursor, ctx);
  } catch {
    throw notCarried();
  }
  return cursor;
}

/**
 * The rows after the keys in the order of `terms`, NULLs last in both directions: the OR over each term of "every earlier
 * key equal, this one after". Nothing sorts after a NULL key, so its branch drops out.
 */
export function resumePredicate(terms: readonly OrderTerm[], keys: readonly (Operand | null)[], nonNull: (column: PlanColumn) => boolean): Predicate {
  const branches: Predicate[] = [];
  const same: Predicate[] = [];
  terms.forEach(({ column, direction }, index) => {
    const key = keys[index] ?? null;
    const isNull = leaf(column, { k: "key", op: "null" });
    if (key !== null) {
      const after = leaf(column, { k: "key", op: direction === "asc" ? "gt" : "lt", value: key });
      branches.push(combine("and", [...same, nonNull(column) ? after : combine("or", [after, isNull])]));
    }
    same.push(key === null ? isNull : leaf(column, { k: "key", op: "eq", value: key }));
  });
  return combine("or", branches);
}
