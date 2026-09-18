import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
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

function NumberCell({ value, column }: CellRenderProps<unknown, number | null>) {
  const options = column.options as GridCellTypes["number"]["options"] | undefined;
  return <CellSpan text={numberCellType.toText(value, options)} align="right" />;
}

function NumberEditor({
  value,
  initialText,
  onChange,
  commit,
  cancel,
  column,
  pending,
  rejectionCount,
}: CellEditorProps<unknown, number | null>) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText ?? numberCellType.toText(value));
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
    onChange(numberCellType.fromText(text, column.options as GridCellTypes["number"]["options"]));
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
  toText: (value, options) => {
    if (value == null) return "";
    return String(options?.decimals !== undefined ? roundToDecimals(value, options) : value);
  },
  fromText: (text, options) => {
    const normalized = normalizeNumberText(text);
    if (normalized === "") return null;
    const parsed = Number(normalized);
    if (Number.isNaN(parsed)) return null;
    return roundToDecimals(clampNumber(parsed, options), options);
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
