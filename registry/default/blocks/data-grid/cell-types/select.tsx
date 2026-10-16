import { useEffect, useRef, useState } from "react";
import { toSafeText } from "./safe-text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CellEditorProps, CellRenderProps, CellType, GridCellTypes } from "../types";
import { CellSpan } from "./cell-span";
import { TEXT_FILTER_OPERATORS } from "./capabilities";
import { useCommitGuard } from "../interaction/use-commit-guard";
import { columnLabelText } from "../columns/column-format-helpers";
import { defaultCompareText } from "../sort-filter/default-compare-text";

type Choice = { value: string; label: string };
type ChoiceIndex = { byValue: Map<string, Choice>; byLowerLabel: Map<string, Choice> };

// Per-cell lookups (search, display, copy) stay O(1); keyed by array identity, so an in-place mutation of `choices` is not seen.
const choiceIndexes = new WeakMap<readonly Choice[], ChoiceIndex>();

function choiceIndex(choices: readonly Choice[]): ChoiceIndex {
  let index = choiceIndexes.get(choices);
  if (index) return index;
  index = { byValue: new Map(), byLowerLabel: new Map() };
  for (const choice of choices) {
    if (!index.byValue.has(choice.value)) index.byValue.set(choice.value, choice);
    const lower = choice.label.toLowerCase();
    if (!index.byLowerLabel.has(lower)) index.byLowerLabel.set(lower, choice);
  }
  choiceIndexes.set(choices, index);
  return index;
}

// Sort ranks by label per `choices` array; equal labels share a rank, so a sort compares integers.
const choiceRanks = new WeakMap<readonly Choice[], Map<string, number>>();

function choiceRank(choices: readonly Choice[]): Map<string, number> {
  let ranks = choiceRanks.get(choices);
  if (ranks) return ranks;
  ranks = new Map();
  const byLabel = [...choices].sort((a, b) => defaultCompareText(a.label, b.label));
  let rank = -1;
  let previous: string | undefined;
  for (const choice of byLabel) {
    if (previous === undefined || defaultCompareText(previous, choice.label) !== 0) rank++;
    previous = choice.label;
    if (!ranks.has(choice.value)) ranks.set(choice.value, rank);
  }
  choiceRanks.set(choices, ranks);
  return ranks;
}

/** The choice whose value is `raw`, else the first whose label matches `raw` case-insensitively. */
function findChoice(choices: readonly Choice[] | undefined, raw: string): Choice | undefined {
  if (!choices) return undefined;
  const index = choiceIndex(choices);
  return index.byValue.get(raw) ?? index.byLowerLabel.get(String(raw).toLowerCase());
}

function SelectCell({ value, options }: CellRenderProps<unknown, string | null, GridCellTypes["select"]["options"]>) {
  const choice = value == null ? undefined : findChoice(options?.choices, value);
  return <CellSpan text={choice?.label ?? value ?? ""} />;
}

/** Opens on mount; picking an option commits immediately (no separate confirm step). */
function SelectEditor({ value, options, onChange, commit, cancel, column, rejectionCount }: CellEditorProps<unknown, string | null, GridCellTypes["select"]["options"]>) {
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
    const key = toSafeText(value);
    return findChoice(options?.choices, key)?.label ?? key;
  },
  // search the label, like toText — the stored value is an opaque choice id
  toSearchText: (value, options) => {
    if (value == null) return "";
    const key = toSafeText(value);
    return findChoice(options?.choices, key)?.label ?? key;
  },
  filter: { operators: [...TEXT_FILTER_OPERATORS, "isAnyOf"], valueInput: "choices" },
  fromText: (text, options) => {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const choice = findChoice(options?.choices, trimmed);
    return choice?.value ?? null;
  },
  clearValue: () => null,
  isEmpty: (value) => value == null,
  // sort by the label the user sees, not the opaque stored value
  compare: (a, b, options) => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    const choices = options?.choices;
    if (choices) {
      const ranks = choiceRank(choices);
      const rankA = ranks.get(a);
      const rankB = ranks.get(b);
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    }
    return defaultCompareText(findChoice(choices, a)?.label ?? a, findChoice(choices, b)?.label ?? b);
  },
  align: "left",
};
