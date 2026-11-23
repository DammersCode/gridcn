import type { NumericType } from "./column-map";

/** A filter value after parsing. Numbers are exact: ints are `bigint`, others are canonical decimal strings. */
export type Operand =
  | { kind: "text"; v: string }
  | { kind: "number"; v: string }
  | { kind: "bigint"; v: bigint }
  | { kind: "boolean"; v: boolean }
  | { kind: "date"; v: string }
  | { kind: "instant"; v: string };

/** A decimal value: `(neg ? -1 : 1) * coef / 10 ** scale`. */
export type Decimal = { neg: boolean; coef: bigint; scale: number };

// HTML "valid floating-point number", anchored; the exponent is at most 4 digits.
const NUMBER_GRAMMAR = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d{1,4})?$/;

export function parseDecimal(text: string): Decimal | null {
  if (!NUMBER_GRAMMAR.test(text)) return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(text);
  if (!match) return null;
  const [, sign = "", whole = "", fraction = "", exponent = "0"] = match;
  const mantissa = `${whole}${fraction}`;
  let end = mantissa.length;
  while (end > 0 && mantissa[end - 1] === "0") end--;
  const coef = BigInt(mantissa.slice(0, end) || "0");
  const scale = coef === ZERO ? 0 : fraction.length - Number(exponent) - (mantissa.length - end);
  return { neg: sign === "-" && coef !== ZERO, coef, scale };
}

/** Whether the expanded value has more than `maxDigits` whole or fractional digits; check it before any exact math on untrusted text. */
export function exceedsDigits(value: Decimal, maxDigits: number): boolean {
  return value.coef !== ZERO && (value.coef.toString().length - value.scale > maxDigits || value.scale > maxDigits);
}

/** The nearest finite float, read without expanding the digits. */
export function decimalToFloat(value: Decimal): number {
  return clampFloat(`${value.neg ? "-" : ""}${value.coef.toString()}e${-value.scale}`);
}

// BigInt literals and `**` need ES2020 targets; consumer apps may compile lower.
const ZERO = BigInt(0);
const ONE = BigInt(1);

function bigPow(base: bigint, exponent: number): bigint {
  let result = ONE;
  let square = base;
  for (let rest = exponent; rest > 0; rest = Math.floor(rest / 2)) {
    if (rest % 2 === 1) result *= square;
    square *= square;
  }
  return result;
}

function pow10(exponent: number): bigint {
  return bigPow(BigInt(10), exponent);
}

export function decimalToString(value: Decimal): string {
  const sign = value.neg ? "-" : "";
  if (value.coef === ZERO) return "0";
  if (value.scale <= 0) return `${sign}${(value.coef * pow10(-value.scale)).toString()}`;
  const digits = value.coef.toString().padStart(value.scale + 1, "0");
  const whole = digits.slice(0, digits.length - value.scale);
  const fraction = digits.slice(digits.length - value.scale).replace(/0+$/, "");
  return `${sign}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

/** Whole part and whether there was a fraction. */
function split(value: Decimal): { whole: bigint; exact: boolean } {
  if (value.scale <= 0) return { whole: (value.neg ? -ONE : ONE) * value.coef * pow10(-value.scale), exact: true };
  const divisor = pow10(value.scale);
  const quotient = value.coef / divisor;
  return { whole: value.neg ? -quotient : quotient, exact: value.coef % divisor === ZERO };
}

export function isInteger(value: Decimal): boolean {
  return split(value).exact;
}

export function floorDecimal(value: Decimal): bigint {
  const { whole, exact } = split(value);
  return !exact && value.neg ? whole - ONE : whole;
}

export function ceilDecimal(value: Decimal): bigint {
  const { whole, exact } = split(value);
  return !exact && !value.neg ? whole + ONE : whole;
}

export const INT_RANGE: Readonly<Record<"int2" | "int4" | "int8", readonly [bigint, bigint]>> = {
  int2: [-bigPow(BigInt(2), 15), bigPow(BigInt(2), 15) - ONE],
  int4: [-bigPow(BigInt(2), 31), bigPow(BigInt(2), 31) - ONE],
  int8: [-bigPow(BigInt(2), 63), bigPow(BigInt(2), 63) - ONE],
};

export function isIntType(numeric: NumericType | undefined): numeric is "int2" | "int4" | "int8" {
  return numeric === "int2" || numeric === "int4" || numeric === "int8";
}

/** A finite JS number from a float bound; a non-finite result clamps by sign. */
export function clampFloat(text: string): number {
  const n = Number(text);
  if (Number.isFinite(n)) return n;
  return n < 0 ? -Number.MAX_VALUE : Number.MAX_VALUE;
}

export function parseBoolean(text: string): boolean | null {
  const lower = text.trim().toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return null;
}

const DATE_GRAMMAR = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date `YYYY-MM-DD`, else `null`. */
export function parseDate(text: string): string | null {
  const match = DATE_GRAMMAR.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? text : null;
}

const INSTANT_GRAMMAR = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[-+]\d{2}(?::?\d{2})?)$/i;
const MAX_INSTANT_TEXT = 40;

const instantMatch = (text: string): RegExpExecArray | null => (text.length > MAX_INSTANT_TEXT ? null : INSTANT_GRAMMAR.exec(text));
const pastMillisecond = (fraction: string | undefined): boolean => fraction !== undefined && /[1-9]/.test(fraction.slice(3));

// Every shape `instantText` reads: `T` or a space, any zone or none.
const SECOND_FRACTION = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}\.(\d+)/;

/** Whether the instant text holds a nonzero digit past the millisecond, which `parseInstant` refuses. */
export function isSubMillisecond(text: string): boolean {
  return pastMillisecond(SECOND_FRACTION.exec(text)?.[1]);
}

/** Whether the column stores the instant exactly: an `epoch-s` column holds whole seconds only. */
export function holdsInstant(column: { storage?: string }, instant: string): boolean {
  return column.storage !== "epoch-s" || Date.parse(instant) % 1000 === 0;
}

/** An ISO instant with an explicit offset as a canonical `toISOString` text, else `null`, also for a nonzero digit past the millisecond. */
export function parseInstant(text: string): string | null {
  const match = instantMatch(text);
  if (!match || parseDate(match[1]!) === null || pastMillisecond(match[5])) return null;
  const [, day, hour, minute, second = "00", fraction = "0", zone = "Z"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  let offset = "Z";
  if (zone.toUpperCase() !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const hours = digits.slice(0, 2);
    const minutes = digits.slice(2) || "00";
    if (Number(hours) > 23 || Number(minutes) > 59) return null;
    offset = `${zone[0]}${hours}:${minutes}`;
  }
  const time = Date.parse(`${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0").slice(0, 3)}${offset}`);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const UUID_GRAMMAR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(text: string): string | null {
  return UUID_GRAMMAR.test(text) ? text.toLowerCase() : null;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    zoneFormats.set(timeZone, format);
  }
  return format;
}

/** Throws a `RangeError` when `timeZone` is not an IANA zone or a fixed offset. */
export function assertTimeZone(timeZone: string): void {
  zoneFormat(timeZone);
}

function localParts(instant: number, timeZone: string): { day: string; wall: number } {
  const parts: Record<string, string> = {};
  for (const part of zoneFormat(timeZone).formatToParts(new Date(instant))) parts[part.type] = part.value;
  const year = parts["year"]!.padStart(4, "0");
  const wall = Date.UTC(Number(parts["year"]), Number(parts["month"]) - 1, Number(parts["day"]), Number(parts["hour"]), Number(parts["minute"]), Number(parts["second"]));
  return { day: `${year}-${parts["month"]}-${parts["day"]}`, wall };
}

function offsetAt(instant: number, timeZone: string): number {
  return localParts(instant, timeZone).wall - Math.floor(instant / 1000) * 1000;
}

const DAY_MS = 86_400_000;

/** The first instant of the local day `day` (`YYYY-MM-DD`) in `timeZone`; a DST gap at midnight starts the day at the transition. */
export function startOfLocalDay(day: string, timeZone: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const guess = new Date(0).setUTCFullYear(year, month - 1, date);
  const candidates = [-DAY_MS, 0, DAY_MS].map((shift) => guess - offsetAt(guess + shift, timeZone));
  const onDay = candidates.filter((instant) => localParts(instant, timeZone).day === day);
  const pool = onDay.length > 0 ? onDay : candidates;
  const first = pool.reduce((a, b) => (a < b ? a : b));
  return new Date(first).toISOString();
}

/** The calendar day after `day`. */
export function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(0);
  next.setUTCFullYear(year, month - 1, date + 1);
  return next.toISOString().slice(0, 10);
}

/** The local day of an instant in `timeZone`, as `YYYY-MM-DD`. */
export function localDayOf(instantIso: string, timeZone: string): string {
  return localParts(Date.parse(instantIso), timeZone).day;
}
