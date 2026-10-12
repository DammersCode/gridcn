import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { TEXT_FILTER_OPERATORS } from "./capabilities";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { isComposingKey } from "../interaction/is-composing-key";
import { columnLabelText } from "../columns/column-format-helpers";
import { displayText } from "./display-text";

/** Rendered text is capped so one huge stored value cannot stall layout. */
const LONG_TEXT_DISPLAY_LIMIT = 500;

/** The editor textarea's `maxLength` and the type's default `validate` bound when a column sets no `maxLength` of its own. */
export const LONG_TEXT_DEFAULT_MAX_LENGTH = 100_000;

function LongTextCell({ value, options }: CellRenderProps<unknown, string, GridCellTypes["longText"]["options"]>) {
  return <CellSpan text={displayText(longTextCellType, value, options)} />;
}

/** Popover + textarea (the date editor's pattern): the cell stays one line, the editor takes a real multi-line surface. Outside press commits the draft; Escape cancels. */
function LongTextEditor({
  value,
  options,
  onChange,
  commit,
  cancel,
  column,
  pending,
  rejectionCount,
}: CellEditorProps<unknown, string, GridCellTypes["longText"]["options"]>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(longTextCellType.toText(value));
  const [open, setOpen] = useState(true);
  const committed = useCommitGuard();

  // Re-arm on each rejection, not on pending->false (that also fires on the cancel right before unmount); see CellEditorProps.rejectionCount.
  const lastRejectionCount = useRef(rejectionCount ?? 0);
  useEffect(() => {
    if ((rejectionCount ?? 0) !== lastRejectionCount.current) committed.reset();
    lastRejectionCount.current = rejectionCount ?? 0;
  }, [rejectionCount, committed]);

  // The portal commits its content one render after mount; a mount effect would read a null ref.
  const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const commitValue = (nextValue: string, movement?: { dx: number; dy: number }) => {
    if (!committed.tryCommit()) return;
    onChange(nextValue);
    commit(movement);
  };

  const insertLineBreak = () => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + "\n" + text.slice(end));
    // restore the caret after React re-renders the controlled value
    requestAnimationFrame(() => el?.setSelectionRange(start + 1, start + 1));
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
        if (!next) {
          // Escape cancels the edit; any other close (outside press) commits the draft.
          // commitValue owns the one-shot guard; cancel is idempotent.
          if (details.reason === "escape-key") cancel();
          else commitValue(longTextCellType.fromText(text), { dx: 0, dy: 0 });
        }
      }}
    >
      <PopoverTrigger nativeButton={false} render={<span className="block size-full truncate" />}>
        {displayText(longTextCellType, value, options)}
      </PopoverTrigger>
      <PopoverContent
        data-grid-cell-editor=""
        // Base UI's open-focus wins the rAF race and resets the caret; the mount effect owns focus.
        initialFocus={false}
        align="start"
        className="w-auto p-0"
        onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
          if (e.key === "Escape" && !isComposingKey(e) && committed.tryCommit()) cancel();
        }}
      >
        <textarea
          ref={setTextareaRef}
          value={text}
          // readOnly, not disabled: a disabled textarea swallows Escape while an async validation is pending.
          readOnly={pending}
          dir="auto"
          aria-multiline
          aria-label={columnLabelText(column)}
          maxLength={options?.maxLength ?? LONG_TEXT_DEFAULT_MAX_LENGTH}
          placeholder={options?.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (isComposingKey(e)) return;
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (e.shiftKey || e.altKey) insertLineBreak();
            else commitValue(longTextCellType.fromText(text), { dx: 0, dy: 1 });
          }}
          className="h-24 w-40 resize-none border-none bg-transparent p-2 text-sm shadow-none outline-none"
        />
      </PopoverContent>
    </Popover>
  );
}

/** `longText`: multi-line value stored verbatim; the cell renders the first 500 characters with line breaks as spaces, the editor is a popover textarea. The type's default `validate` cannot see column `options`, so it bounds at {@link LONG_TEXT_DEFAULT_MAX_LENGTH} — a column with a custom `maxLength` declares its own `validate` for the non-editor paths. */
export const longTextCellType: CellType<unknown, string, GridCellTypes["longText"]["options"]> = {
  Cell: LongTextCell,
  Editor: LongTextEditor,
  filter: { operators: TEXT_FILTER_OPERATORS, valueInput: "text" },
  toText: (value) => value ?? "",
  toDisplayText: (value) => (value ?? "").slice(0, LONG_TEXT_DISPLAY_LIMIT).replace(/\r\n|\r|\n/g, " "),
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value == null || value === "",
  compare: (a, b) => (a ?? "").localeCompare(b ?? ""),
  validate: (value) =>
    (value ?? "").length > LONG_TEXT_DEFAULT_MAX_LENGTH ? `Too long: max ${LONG_TEXT_DEFAULT_MAX_LENGTH} characters` : null,
};
