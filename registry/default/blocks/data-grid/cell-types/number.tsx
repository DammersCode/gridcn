import { toSafeText } from "./safe-text";
import type { KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { COMPARISON_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from "./capabilities";
import { CELL_INPUT_CLASS, useCellEditorDraft } from "../interaction/use-cell-editor";
import { cn } from "@/lib/utils";
import { isComposingKey } from "../interaction/is-composing-key";
import { displayText } from "./display-text";
import { warnDev } from "../store/commit";

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** Normalizes a comma decimal separator to a dot so `Number()` can parse locales pasted verbatim. */
function normalizeNumberText(text: string): string {
  return text.trim().replace(",", ".");
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

/** One `Intl.NumberFormat` per (format options object, locale, decimals); the options object as WeakMap key keeps a per-render literal GC-able. */
const numberFormatterCache = new WeakMap<Intl.NumberFormatOptions, Map<string, Intl.NumberFormat>>();
/** Options objects whose `new Intl.NumberFormat` threw; the dev fallback warning fires once per object. */
const warnedNumberFormats = new WeakSet<Intl.NumberFormatOptions>();

function getNumberFormatter(format: Intl.NumberFormatOptions, locale: string, decimals: number | undefined): Intl.NumberFormat {
  const perOptions = numberFormatterCache.get(format) ?? new Map<string, Intl.NumberFormat>();
  const key = `${locale}|${decimals ?? ""}`;
  let formatter = perOptions.get(key);
  if (!formatter) {
    // decimals fills in fraction digits the format left open (0.25 under style:"percent" + decimals:2 renders 25.00%)
    const effective =
      decimals !== undefined && format.minimumFractionDigits === undefined && format.maximumFractionDigits === undefined
        ? { ...format, minimumFractionDigits: decimals, maximumFractionDigits: decimals }
        : format;
    formatter = new Intl.NumberFormat(locale, effective);
    perOptions.set(key, formatter);
    numberFormatterCache.set(format, perOptions);
  }
  return formatter;
}

function NumberCell({ value, options }: CellRenderProps<unknown, number | null, GridCellTypes["number"]["options"]>) {
  return <CellSpan text={displayText(numberCellType, value, options)} align="right" />;
}

function NumberEditor(props: CellEditorProps<unknown, number | null, GridCellTypes["number"]["options"]>) {
  const { value, options, pending } = props;
  // seed with the same options the cell display formats with, so the draft matches what the cell showed
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
        const base = numberCellType.fromText(rest.value, options) ?? value;
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
      className={cn(CELL_INPUT_CLASS, "text-end [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")}
    />
  );
}

/** `number`: comma-decimal-tolerant parse, min/max clamp, decimals rounding, plain `String()` serialization; `options.format` renders display-only locale formatting — copy, export, and the editor keep the raw value. */
export const numberCellType: CellType<unknown, number | null, GridCellTypes["number"]["options"]> = {
  Cell: NumberCell,
  Editor: NumberEditor,
  numeric: true,
  filter: { operators: [...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS], valueInput: "number" },
  toText: (value, options) => {
    if (value == null) return "";
    return toSafeText(options?.decimals !== undefined ? roundToDecimals(value, options) : value);
  },
  toDisplayText: (value, options) => {
    if (value == null) return "";
    if (!options?.format) return numberCellType.toText(value, options);
    try {
      return getNumberFormatter(options.format, options.locale ?? "en-US", options.decimals).format(roundToDecimals(value, options));
    } catch (error) {
      // invalid options (e.g. style:"currency" without currency) — raw text, one dev warning per options object;
      // engines differ on the thrown type (V8/Node: TypeError, spec: RangeError)
      if ((error instanceof RangeError || error instanceof TypeError) && !warnedNumberFormats.has(options.format)) {
        warnedNumberFormats.add(options.format);
        warnDev(`invalid number format options, showing the raw value: ${error instanceof Error ? error.message : String(error)}`);
      }
      return numberCellType.toText(value, options);
    }
  },
  fromText: (text, options) => {
    const normalized = normalizeNumberText(text);
    if (normalized === "") return null;
    if (!DECIMAL_NUMBER.test(normalized)) return null;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    if (options?.decimals !== undefined) return clampToDecimals(roundToDecimals(parsed, options), options, options.decimals);
    return clampNumber(parsed, options);
  },
  clearValue: () => null,
  isEmpty: (value) => value == null,
  compare: (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    return a - b;
  },
  align: "right",
};
