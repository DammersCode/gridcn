import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { displayText } from "./display-text";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { columnLabelText } from "../columns/column-format-helpers";

/** Normalizes any Date-parseable input to its ISO `yyyy-mm-dd` date part; null when unparseable or out of range. */
function toIsoDatePart(input: string, options?: GridCellTypes["date"]["options"]): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  let isoDate: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    isoDate = trimmed;
  } else {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
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

/** Constructing an `Intl.DateTimeFormat` costs ~38us against ~0.7us to reuse one (measured) — at
 * fling speed that ran once per date cell per newly-mounted row, so formatters are cached by their
 * resolved locale + format options instead. Keyed on the serialized options rather than the options
 * object's identity: a column literal re-created each render is the common case and must still hit. */
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

function DateCell({ value, column }: CellRenderProps<unknown, string | null>) {
  const options = column.options as GridCellTypes["date"]["options"] | undefined;
  return <CellSpan text={displayText(dateCellType, value, options)} align="right" />;
}

/** Popover + Calendar (shadcn date-picker pattern): opens on edit start; picking a date commits and stays; a small typed-input above the calendar accepts ISO or Date.parse-able text with Enter to commit. */
function DateEditor({
  value,
  onChange,
  commit,
  cancel,
  column,
  pending,
  rejectionCount,
}: CellEditorProps<unknown, string | null>) {
  const options = column.options as GridCellTypes["date"]["options"] | undefined;
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
      onOpenChange={(next) => {
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
          if (e.key === "Escape") {
            if (committed.tryCommit()) cancel();
          }
        }}
      >
        <div className="p-2 pb-0">
          <Input
            ref={inputRef}
            value={text}
            // readOnly, not disabled: a disabled input can't receive focus/keyboard events at all, which
            // would silently swallow Escape while an async validation is pending — readOnly blocks typing
            // but keeps Escape/Tab/blur working.
            readOnly={pending}
            // ISO date text is direction-neutral; see the number editor for why `auto` beats the
            // grid's inherited layout direction on a value-carrying input.
            dir="auto"
            placeholder="yyyy-mm-dd"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
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
  toText: (value) => value ?? "",
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
