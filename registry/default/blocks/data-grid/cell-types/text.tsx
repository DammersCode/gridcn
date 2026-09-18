import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { useSeedFocus } from "../interaction/use-seed-focus";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { columnLabelText } from "../columns/column-format-helpers";

function TextCell({ value }: CellRenderProps<unknown, string>) {
  return <CellSpan text={value} />;
}

function TextEditor({ value, initialText, onChange, commit, cancel, column, pending, rejectionCount }: CellEditorProps<unknown, string>) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText ?? textCellType.toText(value));
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
    onChange(textCellType.fromText(text));
    commit(movement);
  };

  return (
    <Input
      ref={ref}
      value={text}
      // Caret and typing order must follow the VALUE's script, not the grid's layout direction:
      // inheriting `dir=rtl` for a Latin value renders the caret at one end while edits land at the
      // other. An input is its own box, so `auto` here is safe (unlike CellSpan, see cell-span.tsx).
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
      className="h-full w-full border-none bg-transparent p-0 shadow-none outline-none focus-visible:ring-0"
    />
  );
}

/** `text`: identity value pipeline — clipboard/paste text is the value verbatim. */
export const textCellType: CellType<unknown, string, GridCellTypes["text"]["options"]> = {
  Cell: TextCell,
  Editor: TextEditor,
  toText: (value) => value,
  fromText: (text) => text,
  clearValue: () => "",
  isEmpty: (value) => value == null || value === "",
  compare: (a, b) => a.localeCompare(b),
  align: "left",
};
