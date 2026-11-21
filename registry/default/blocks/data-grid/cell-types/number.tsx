import { toSafeText } from "./safe-text";
import { UnparseableTextError } from "./safe-from-text";
import type { KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { COMPARISON_FILTER_OPERATORS, SET_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from "./capabilities";
import { CELL_INPUT_CLASS, useCellEditorDraft } from "../interaction/use-cell-editor";
import { cn } from "@/lib/utils";
import { isComposingKey } from "../interaction/is-composing-key";
import { displayText } from "./display-text";
import { createFormatterCache, formatKey } from "./formatter-cache";
import { compareNumbers } from "../sort-filter/builtin-compare";

const IMPLIED_NUMBER_FORMAT: Intl.NumberFormatOptions = {};

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

const COMMA_GROUPS = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const DOT_GROUPS_COMMA_DECIMAL = /^[+-]?\d{1,3}(?:\.\d{3})+,\d+$/;
const SINGLE_GROUP_AMBIGUOUS = /^[+-]?\d{1,3},\d{3}$/;

/** Reads a pasted number to the text `Number()` parses; throws for text that could mean two numbers or none. */
function normalizeNumberText(text: string): string {
  const trimmed = text.trim();
  if (SINGLE_GROUP_AMBIGUOUS.test(trimmed)) throw new UnparseableTextError(`"${trimmed}" is ambiguous`);
  if (COMMA_GROUPS.test(trimmed)) return trimmed.replaceAll(",", "");
  if (DOT_GROUPS_COMMA_DECIMAL.test(trimmed)) return trimmed.replaceAll(".", "").replace(",", ".");
  return trimmed.replace(",", ".");
}

/** Clamps a parsed number into the column's configured min/max, if any. */
function clampNumber(value: number, options?: GridCellTypes["number"]["options"]): number {
  let clamped = value;
  if (options?.min !== undefined) clamped = Math.max(clamped, options.min);
  if (options?.max !== undefined) clamped = Math.min(clamped, options.max);
  return clamped;
}

/** Moves the decimal point by `places` through the exponent, so `1.005` shifts to exactly `100.5`. */
function shiftDecimal(value: number, places: number): number {
  const [mantissa = "0", exponent = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/** Rounds to the column's configured decimal precision, if any; never returns `-0`. */
function roundToDecimals(value: number, options?: GridCellTypes["number"]["options"]): number {
  if (options?.decimals === undefined || !Number.isFinite(value)) return value;
  const rounded = shiftDecimal(Math.round(shiftDecimal(value, options.decimals)), -options.decimals);
  return rounded === 0 ? 0 : rounded;
}

/** Count of fractional digits in a finite number's shortest decimal form. */
function decimalPlaces(value: number): number {
  const [mantissa = "", exponent = "0"] = String(value).split("e");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return Math.min(100, Math.max(0, fraction - Number(exponent)));
}

/** Pulls a bound into the column's decimals, keeping a bound that already sits on that grid. */
function boundToDecimals(bound: number, decimals: number, inward: (n: number) => number): number {
  const rounded = Math.round(bound * 10 ** decimals) / 10 ** decimals;
  if (rounded === bound) return rounded;
  return inward(bound * 10 ** decimals) / 10 ** decimals;
}

/** Clamps into min/max, pulling each bound inward to the column's decimals so the result never exceeds it. */
function clampToDecimals(value: number, options: GridCellTypes["number"]["options"], decimals: number): number {
  let clamped = value;
  if (options?.min !== undefined) clamped = Math.max(clamped, boundToDecimals(options.min, decimals, Math.ceil));
  if (options?.max !== undefined) clamped = Math.min(clamped, boundToDecimals(options.max, decimals, Math.floor));
  return clamped;
}

const cachedNumberFormatter = createFormatterCache<Intl.NumberFormat>("invalid number format options, showing the raw value");

// Skips the key build per cell: a scan of 200,000 cells spends more time on the key than on `format`.
const lastFormatterOf = new WeakMap<Intl.NumberFormatOptions, { locale: string; decimals: number | undefined; formatter: Intl.NumberFormat | null }>();

/** The formatter for the options, or `null` when they are invalid. A re-created literal with equal content reuses one formatter. */
function getNumberFormatter(format: Intl.NumberFormatOptions, locale: string, decimals: number | undefined): Intl.NumberFormat | null {
  const last = lastFormatterOf.get(format);
  if (last !== undefined && last.locale === locale && last.decimals === decimals) return last.formatter;
  const formatter = buildNumberFormatter(format, locale, decimals);
  lastFormatterOf.set(format, { locale, decimals, formatter });
  return formatter;
}

function buildNumberFormatter(format: Intl.NumberFormatOptions, locale: string, decimals: number | undefined): Intl.NumberFormat | null {
  return cachedNumberFormatter(`${locale}|${decimals ?? ""}|${formatKey(format)}`, () => {
    // decimals fills in fraction digits the format left open (0.25 under style:"percent" + decimals:2 renders 25.00%)
    const effective =
      decimals !== undefined && format.minimumFractionDigits === undefined && format.maximumFractionDigits === undefined
        ? { ...format, minimumFractionDigits: decimals, maximumFractionDigits: decimals }
        : format;
    return new Intl.NumberFormat(locale, effective);
  });
}

const DECIMAL_TEXT = /^-?\d+(?:\.\d+)?$/;

// Intl formats a decimal string exactly since ES2023; an older engine keeps the raw text.
const formatsDecimalText = (() => {
  try {
    return new Intl.NumberFormat("en-US").format("9007199254740993") === "9,007,199,254,740,993";
  } catch {
    return false;
  }
})();

const MAX_DECIMAL_TEXT = 1024;

const isDecimalText = (value: unknown): value is Intl.StringNumericLiteral => formatsDecimalText && typeof value === "string" && value.length <= MAX_DECIMAL_TEXT && DECIMAL_TEXT.test(value);

/** Rounds a decimal string like {@link roundToDecimals}: half up, no `-0`. A string within `decimals` stays as it is. */
function roundDecimalText(text: Intl.StringNumericLiteral, decimals: number): string {
  const dot = text.indexOf(".");
  if (dot === -1 || text.length - dot - 1 <= decimals) return text;
  const formatter = cachedNumberFormatter(`exact|${decimals}`, () => new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: decimals, roundingMode: "halfCeil", signDisplay: "negative" }));
  return formatter ? formatter.format(text) : text;
}

function NumberCell({ value, options }: CellRenderProps<unknown, number | null, GridCellTypes["number"]["options"]>) {
  return <CellSpan text={displayText(numberCellType, value, options)} />;
}

function parseDraft(draft: string, options?: GridCellTypes["number"]["options"]): number | null {
  try {
    return numberCellType.fromText(draft, options);
  } catch {
    return null;
  }
}

function NumberEditor(props: CellEditorProps<unknown, number | null, GridCellTypes["number"]["options"]>) {
  const { value, options, pending } = props;
  // seed with `toText` so `decimals` rounding matches; `format` stays display-only
  const { bindings, setDraft } = useCellEditorDraft(props, {
    toDraft: (draftValue) => numberCellType.toText(draftValue, options),
    toValue: (draft) => numberCellType.fromText(draft, options),
  });
  const { ref, onKeyDown, ...rest } = bindings;

  return (
    <Input
      ref={ref}
      {...rest}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
          onKeyDown(e);
          return;
        }
        if (pending || isComposingKey(e)) return;
        // step the draft; a cleared draft falls back to the committed value, so an empty
        // cell with a null value has no step base and stays untouched
        const base = parseDraft(rest.value, options) ?? value;
        if (base === null) return;
        e.preventDefault();
        const configuredStep = options?.step ?? 1;
        const step = options?.decimals !== undefined ? Math.max(configuredStep, 10 ** -options.decimals) : configuredStep;
        const raw = base + (e.key === "ArrowUp" ? step : -step);
        const clamped = clampNumber(raw, options);
        // float drift (0.1 + 0.2) rounds away at the finer of the draft's and the step's precision
        const next =
          options?.decimals !== undefined
            ? clampToDecimals(roundToDecimals(raw, options), options, options.decimals)
            : clamped === raw
              ? Number(raw.toFixed(Math.max(decimalPlaces(base), decimalPlaces(step))))
              : clamped;
        setDraft(String(next));
      }}
      className={cn(CELL_INPUT_CLASS, "[text-align:inherit] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")}
    />
  );
}

/** `number`: comma-decimal and grouped-thousands parse that rejects ambiguous or non-numeric text, min/max clamp, decimals rounding, plain `String()` serialization; `options.format` (implied as `{}` by `options.locale` alone) renders display-only locale formatting — copy, export, and the editor keep the raw value. */
export const numberCellType: CellType<unknown, number | null, GridCellTypes["number"]["options"]> = {
  Cell: NumberCell,
  Editor: NumberEditor,
  numeric: true,
  filter: { operators: [...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS, ...SET_FILTER_OPERATORS], valueInput: "number" },
  toText: (value, options) => {
    if (value == null) return "";
    if (options?.decimals !== undefined && isDecimalText(value)) return roundDecimalText(value, options.decimals);
    return toSafeText(options?.decimals !== undefined ? roundToDecimals(value, options) : value);
  },
  toDisplayText: (value, options) => {
    if (value == null) return "";
    // a locale alone implies the default grouped format
    const format = options?.format ?? (options?.locale ? IMPLIED_NUMBER_FORMAT : undefined);
    if (format && isDecimalText(value)) {
      const formatter = getNumberFormatter(format, options?.locale ?? "en-US", options?.decimals);
      const rounded = options?.decimals === undefined ? value : (roundDecimalText(value, options.decimals) as Intl.StringNumericLiteral);
      return formatter ? formatter.format(rounded) : numberCellType.toText(value, options);
    }
    if (!format || typeof value !== "number") return numberCellType.toText(value, options);
    const formatter = getNumberFormatter(format, options?.locale ?? "en-US", options?.decimals);
    return formatter ? formatter.format(roundToDecimals(value, options)) : numberCellType.toText(value, options);
  },
  fromText: (text, options) => {
    const normalized = normalizeNumberText(text);
    if (normalized === "") return null;
    const parsed = DECIMAL_NUMBER.test(normalized) ? Number(normalized) : Number.NaN;
    if (!Number.isFinite(parsed)) throw new UnparseableTextError(`"${text}" is not a number`);
    if (options?.decimals !== undefined) return clampToDecimals(roundToDecimals(parsed, options), options, options.decimals);
    return clampNumber(parsed, options);
  },
  clearValue: () => null,
  isEmpty: (value) => value == null,
  compare: compareNumbers,
  align: "end",
};
