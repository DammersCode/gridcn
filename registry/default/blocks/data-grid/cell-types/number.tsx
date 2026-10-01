import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { COMPARISON_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from "./capabilities";
import { useSeedFocus } from "../interaction/use-seed-focus";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { columnLabelText } from "../columns/column-format-helpers";

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

/** Rounds to the column's configured decimal precision, if any. */
function roundToDecimals(value: number, options?: GridCellTypes["number"]["options"]): number {
  if (options?.decimals === undefined) return value;
  const factor = 10 ** options.decimals;
  return Math.round(value * factor) / factor;
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

function NumberCell({ value, options }: CellRenderProps<unknown, number | null, GridCellTypes["number"]["options"]>) {
  return <CellSpan text={numberCellType.toText(value, options)} align="right" />;
}

function NumberEditor({
  value,
  initialText,
  options,
  onChange,
  commit,
  cancel,
  column,
  pending,
  rejectionCount,
}: CellEditorProps<unknown, number | null, GridCellTypes["number"]["options"]>) {
  const ref = useRef<HTMLInputElement>(null);
  // seed with the same options the cell display formats with, so the draft matches what the cell showed
  const [text, setText] = useState(initialText ?? numberCellType.toText(value, options));
  useSeedFocus(ref, initialText);
  const committed = useCommitGuard();

  // An async schema resolving with ISSUES leaves editing open — re-arm the guard so the user's
  // next Enter/blur after fixing the value isn't silently dropped. Keyed off rejectionCount
  // specifically (not "pending went from true to false", which also fires on Escape/cancel right
  // before unmount — resetting there let the unmount's own blur commit a second, stale time).
  const lastRejectionCount = useRef(rejectionCount ?? 0);
  useEffect(() => {
    if ((rejectionCount ?? 0) !== lastRejectionCount.current) committed.reset();
    lastRejectionCount.current = rejectionCount ?? 0;
  }, [rejectionCount, committed]);

  const commitText = (movement?: { dx: number; dy: number }) => {
    if (!committed.tryCommit()) return;
    onChange(numberCellType.fromText(text, options));
    commit(movement);
  };

  return (
    <Input
      ref={ref}
      value={text}
      // Numerals are direction-neutral, so under an inherited `dir=rtl` a leading minus sign and the
      // caret land on the wrong end. `auto` has no strong character to find here and resolves to
      // ltr — the correct reading order for a number in either layout direction.
      dir="auto"
      // readOnly, not disabled: a disabled input can't receive focus/keyboard events at all, which
      // would silently swallow Escape while an async validation is pending — readOnly blocks typing
      // but keeps Escape/Tab/blur working.
      readOnly={pending}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          commitText({ dx: 0, dy: 1 });
        } else if (e.key === "Escape") {
          cancel();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          if (pending || e.nativeEvent.isComposing) return;
          // step the draft; a cleared draft falls back to the committed value, so an empty
          // cell with a null value has no step base and stays untouched
          const base = numberCellType.fromText(text, options) ?? value;
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
          setText(String(next));
        }
      }}
      onBlur={() => commitText({ dx: 0, dy: 0 })}
      aria-label={columnLabelText(column)}
      aria-busy={pending || undefined}
      className="h-full w-full border-none bg-transparent p-0 text-end shadow-none outline-none [appearance:textfield] focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

/** `number`: comma-decimal-tolerant parse, min/max clamp, decimals rounding, plain `String()` serialization (no locale formatting in v1). */
export const numberCellType: CellType<unknown, number | null, GridCellTypes["number"]["options"]> = {
  Cell: NumberCell,
  Editor: NumberEditor,
  numeric: true,
  filter: { operators: [...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS], valueInput: "number" },
  toText: (value, options) => {
    if (value == null) return "";
    return String(options?.decimals !== undefined ? roundToDecimals(value, options) : value);
  },
  fromText: (text, options) => {
    const normalized = normalizeNumberText(text);
    if (normalized === "") return null;
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) return null;
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
