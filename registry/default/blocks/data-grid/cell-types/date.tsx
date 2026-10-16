import { toSafeText } from "./safe-text";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { COMPARISON_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from "./capabilities";
import { displayText } from "./display-text";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { isComposingKey } from "../interaction/is-composing-key";
import { useDataGridLabels } from "../store";
import { columnLabelText } from "../columns/column-format-helpers";

/** Calendar-validity probe for an ISO-shaped `yyyy-mm-dd`: UTC so no time-zone can shift a day; `setUTCFullYear` (unlike the `Date.UTC` constructor) maps 0-99 to themselves, so `0026-01-01` stays 0026. */
function isRealIsoDate(iso: string): boolean {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

const MONTH_NAME_PREFIXES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** True when the input itself names the parsed year, month, and day, so `Date` did not roll an invalid day into the next month. */
function inputNamesDate(input: string, year: number, month: number, day: number): boolean {
  const numbers = (input.match(/\d+/g) ?? []).map(Number);
  const take = (matches: (n: number) => boolean): boolean => {
    const at = numbers.findIndex(matches);
    if (at === -1) return false;
    numbers.splice(at, 1);
    return true;
  };
  if (!take((n) => n === year) && !take((n) => n < 100 && n === year % 100)) return false;
  if (!take((n) => n === day)) return false;
  const namedMonths = new Set((input.toLowerCase().match(/[a-z]+/g) ?? []).map((word) => word.slice(0, 3)).filter((prefix) => MONTH_NAME_PREFIXES.includes(prefix)));
  if (namedMonths.size > 1) return false;
  return take((n) => n === month) || namedMonths.has(MONTH_NAME_PREFIXES[month - 1]!);
}

// anchored time grammar: hh:mm[:ss[.f]] [AM|PM] [Z | [GMT|UTC]+hh[:]mm] [(zone name)]; the lookbehind keeps whitespace runs linear
const TIME_PART_RE = /(?:[Tt]|(?<![\s,]),?\s+)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*[AaPp][Mm])?(?:\s*(?:[Zz]|(?:GMT|UTC)?[+-]\d{2}:?\d{2}))?(?:\s*\([^()]*\))?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalizes any Date-parseable input to its ISO `yyyy-mm-dd` date part; null when unparseable, calendar-invalid, or out of range. A datetime stores its local calendar day. */
function toIsoDatePart(input: string, options?: GridCellTypes["date"]["options"]): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // the written date, without its time part, is what must be a real calendar day
  const written = trimmed.replace(TIME_PART_RE, "");
  let isoDate: string;
  if (ISO_DATE_RE.test(written) && written === trimmed) {
    // the shape check is not a calendar check — 2026-02-30 matches it and must not commit
    if (!isRealIsoDate(trimmed)) return null;
    isoDate = trimmed;
  } else {
    if (ISO_DATE_RE.test(written) && !isRealIsoDate(written)) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    const writtenDate = new Date(written);
    if (Number.isNaN(writtenDate.getTime())) return null;
    if (!inputNamesDate(written, writtenDate.getFullYear(), writtenDate.getMonth() + 1, writtenDate.getDate())) return null;
    // use local getters, not toISOString(), so a locale-parsed date (local midnight) doesn't shift a day across UTC
    const year = String(parsed.getFullYear()).padStart(4, "0");
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    isoDate = `${year}-${month}-${day}`;
  }
  if (options?.min !== undefined && isoDate < options.min) return null;
  if (options?.max !== undefined && isoDate > options.max) return null;
  return isoDate;
}

/** Parses an ISO `yyyy-mm-dd` date part as a local-midnight `Date` for the Calendar; null for anything else. */
function isoDatePartToLocalDate(isoDate: string | null): Date | undefined {
  if (isoDate == null || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return undefined;
  // regex above guarantees exactly 3 numeric "-"-separated parts
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

/** Local-midnight `Date` back to its ISO `yyyy-mm-dd` part (mirrors `toIsoDatePart`'s local-getter approach). */
function localDateToIsoDatePart(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Formatters keyed by serialized options, so a re-created column literal reuses one (build ~38us, reuse ~0.7us). */
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(locale: string, format: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(format)}`;
  let formatter = dateFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, format);
    dateFormatterCache.set(key, formatter);
  }
  return formatter;
}

/** Formats an ISO date part per the column's `displayFormat`/`locale`, falling back to the raw ISO text. */
function formatDateDisplay(value: string | null, options?: GridCellTypes["date"]["options"]): string {
  if (value == null) return "";
  if (!options?.displayFormat) return value;
  const date = isoDatePartToLocalDate(value);
  if (!date) return value;
  // pinned default: server and browser Intl defaults can differ -> SSR hydration mismatch
  return getDateFormatter(options.locale ?? "en-US", options.displayFormat).format(date);
}

function DateCell({ value, options }: CellRenderProps<unknown, string | null, GridCellTypes["date"]["options"]>) {
  return <CellSpan text={displayText(dateCellType, value, options)} align="right" />;
}

/** Popover + Calendar (shadcn date-picker pattern): opens on edit start; picking a date commits and stays; a small typed-input above the calendar accepts ISO or Date.parse-able text with Enter to commit. */
function DateEditor({
  value,
  options,
  onChange,
  commit,
  cancel,
  column,
  pending,
  rejectionCount,
}: CellEditorProps<unknown, string | null, GridCellTypes["date"]["options"]>) {
  const labels = useDataGridLabels();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(dateCellType.toText(value));
  const [open, setOpen] = useState(true);
  const committed = useCommitGuard();

  // Re-arm on each rejection, not on pending->false (that also fires on the cancel right before unmount); see CellEditorProps.rejectionCount.
  const lastRejectionCount = useRef(rejectionCount ?? 0);
  useEffect(() => {
    if ((rejectionCount ?? 0) !== lastRejectionCount.current) committed.reset();
    lastRejectionCount.current = rejectionCount ?? 0;
  }, [rejectionCount, committed]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const commitValue = (nextValue: string | null, movement?: { dx: number; dy: number }) => {
    if (!committed.tryCommit()) return;
    onChange(nextValue);
    commit(movement);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key" && isComposingKey(details.event)) {
          details.cancel();
          return;
        }
        setOpen(next);
        if (!next && committed.tryCommit()) cancel();
      }}
    >
      <PopoverTrigger
        nativeButton={false}
        render={<span className="block size-full truncate text-end" />}
      >
        {displayText(dateCellType, value, options)}
      </PopoverTrigger>
      <PopoverContent
        data-grid-cell-editor=""
        align="start"
        className="w-auto p-0"
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Escape" && !isComposingKey(e)) {
            if (committed.tryCommit()) cancel();
          }
        }}
      >
        <div className="p-2 pb-0">
          <Input
            ref={inputRef}
            value={text}
            // readOnly, not disabled: a disabled input swallows Escape while an async validation is pending.
            readOnly={pending}
            // ISO date text is direction-neutral, so it must not inherit the grid's layout direction.
            dir="auto"
            placeholder={labels.grid.datePlaceholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              // Enter or Escape during IME composition confirms or cancels the composition, not the edit.
              if (isComposingKey(e)) return;
              if (e.key === "Enter") {
                commitValue(dateCellType.fromText(text, options), { dx: 0, dy: 1 });
              } else if (e.key === "Escape") {
                if (committed.tryCommit()) cancel();
              }
            }}
            aria-label={columnLabelText(column)}
            className="h-8 w-full border-none bg-transparent px-2 shadow-none outline-none focus-visible:ring-0"
          />
        </div>
        <Calendar
          mode="single"
          selected={isoDatePartToLocalDate(value)}
          defaultMonth={isoDatePartToLocalDate(value)}
          onSelect={(date) => {
            if (!date) return;
            commitValue(localDateToIsoDatePart(date), { dx: 0, dy: 0 });
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** `date`: ISO `yyyy-mm-dd` storage; fromText accepts ISO or any Date.parse-able string, normalized and range-checked against min/max. */
export const dateCellType: CellType<unknown, string | null, GridCellTypes["date"]["options"]> = {
  Cell: DateCell,
  Editor: DateEditor,
  numeric: true,
  filter: { operators: [...TEXT_FILTER_OPERATORS, ...COMPARISON_FILTER_OPERATORS], valueInput: "date" },
  toText: (value) => toSafeText(value),
  toDisplayText: (value, options) => formatDateDisplay(value, options),
  fromText: (text, options) => toIsoDatePart(text, options),
  clearValue: () => null,
  isEmpty: (value) => value == null,
  compare: (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  },
  align: "right",
};
