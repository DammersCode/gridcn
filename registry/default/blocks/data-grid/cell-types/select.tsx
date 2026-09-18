import { useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { columnLabelText } from "../columns/column-format-helpers";

function findChoice(
  choices: readonly { value: string; label: string }[] | undefined,
  raw: string,
): { value: string; label: string } | undefined {
  if (!choices) return undefined;
  const byValue = choices.find((c) => c.value === raw);
  if (byValue) return byValue;
  const lower = raw.toLowerCase();
  return choices.find((c) => c.label.toLowerCase() === lower);
}

function SelectCell({ value, column }: CellRenderProps<unknown, string | null>) {
  const options = column.options as GridCellTypes["select"]["options"] | undefined;
  const choice = value == null ? undefined : findChoice(options?.choices, value);
  return <CellSpan text={choice?.label ?? value ?? ""} />;
}

/** Opens on mount; picking an option commits immediately (no separate confirm step). */
function SelectEditor({ value, onChange, commit, cancel, column, rejectionCount }: CellEditorProps<unknown, string | null>) {
  const options = column.options as GridCellTypes["select"]["options"] | undefined;
  const [open, setOpen] = useState(true);
  const committed = useCommitGuard();

  // Re-arm on each rejection, not on pending->false (that also fires on the cancel right before unmount); see CellEditorProps.rejectionCount.
  const lastRejectionCount = useRef(rejectionCount ?? 0);
  useEffect(() => {
    if ((rejectionCount ?? 0) !== lastRejectionCount.current) committed.reset();
    lastRejectionCount.current = rejectionCount ?? 0;
  }, [rejectionCount, committed]);

  return (
    <Select
      value={value ?? ""}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // picking an option also closes the select, firing this with `next: false` after commit already ran
        if (!next && committed.tryCommit()) cancel();
      }}
      onValueChange={(next) => {
        if (!committed.tryCommit()) return;
        onChange(next === "" || next == null ? null : next);
        commit({ dx: 0, dy: 0 });
      }}
    >
      <SelectTrigger aria-label={columnLabelText(column)} className="size-full justify-start rounded-none border-none p-0 text-sm shadow-none outline-none focus-visible:ring-0 [&_svg]:hidden">
        <SelectValue placeholder="" />
      </SelectTrigger>
      <SelectContent data-grid-cell-editor="">
        {options?.choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** `select`: fromText resolves pasted option values first, then labels (case-insensitive) so pasted labels round-trip. */
export const selectCellType: CellType<unknown, string | null, GridCellTypes["select"]["options"]> = {
  Cell: SelectCell,
  Editor: SelectEditor,
  toText: (value, options) => {
    if (value == null) return "";
    return findChoice(options?.choices, value)?.label ?? value;
  },
  fromText: (text, options) => {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const choice = findChoice(options?.choices, trimmed);
    return choice?.value ?? null;
  },
  clearValue: () => null,
  isEmpty: (value) => value == null,
  compare: (a, b) => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    return a.localeCompare(b);
  },
  align: "left",
};
