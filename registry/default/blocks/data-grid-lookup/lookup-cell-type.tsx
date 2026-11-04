"use client";

import { CellSpan, type CellRenderProps, type CellType } from "@/registry/default/blocks/data-grid/data-grid";
import { createFilterMatcher } from "@/registry/default/blocks/data-grid/data-grid";
import { SET_FILTER_OPERATORS, TEXT_FILTER_OPERATORS } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { LookupEditor } from "./lookup-editor";
import { isUnresolved, MAX_LOOKUP_TEXT, readLookup, recallOption, rememberOption, type LookupOptions, type LookupValue } from "./lookup-model";

function LookupCell({ value }: CellRenderProps<unknown, LookupValue, LookupOptions>) {
  const option = readLookup(value);
  if (!option) return <CellSpan text="" />;
  if (isUnresolved(value)) {
    return (
      <span data-unresolved="" className="block w-full truncate text-muted-foreground">
        <bdi>{option.label}</bdi>
      </span>
    );
  }
  return <CellSpan text={option.label} />;
}

function labelOf(value: unknown): string {
  return readLookup(value)?.label ?? "";
}

/**
 * `lookup`: the stored value is `{ value, label }` (the key and the text the user sees). `toText`
 * copies the label; `fromText` resolves a pasted label or key against the options this column has
 * shown or copied, else follows `unresolvedPaste`. Sort and quick search read the label.
 */
export const lookupCellType: CellType<unknown, LookupValue, LookupOptions> = {
  Cell: LookupCell,
  Editor: LookupEditor,
  toText: (value, options) => {
    const option = readLookup(value);
    if (!option) return "";
    if (options?.fetchOptions) rememberOption(options.fetchOptions, option);
    return option.label;
  },
  fromText: (text, options) => {
    const trimmed = text.trim().slice(0, MAX_LOOKUP_TEXT);
    if (trimmed === "") return null;
    const hit = options?.fetchOptions ? recallOption(options.fetchOptions, trimmed) : undefined;
    if (hit) return hit;
    return options?.unresolvedPaste === "keep" ? { value: trimmed, label: trimmed } : null;
  },
  clearValue: () => null,
  isEmpty: (value) => readLookup(value) === null,
  compare: (a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true, sensitivity: "base" }),
  toSearchText: (value) => labelOf(value),
  filter: {
    operators: [...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS],
    match: (value, filter) => createFilterMatcher(filter)(labelOf(value)),
  },
  align: "left",
};
