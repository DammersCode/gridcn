"use client";

import { CellSpan, type CellRenderProps, type CellType } from "@/registry/default/blocks/data-grid/data-grid";
import { createFilterMatcher } from "@/registry/default/blocks/data-grid/data-grid";
import type { FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { TEXT_FILTER_OPERATORS } from "@/registry/default/blocks/data-grid/data-grid-sdk";
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

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const matchers = new WeakMap<FilterSpec, (text: string) => boolean>();

function matcherFor(filter: FilterSpec): (text: string) => boolean {
  let matcher = matchers.get(filter);
  if (!matcher) {
    matcher = createFilterMatcher(filter);
    matchers.set(filter, matcher);
  }
  return matcher;
}

function labelOf(value: unknown): string {
  return readLookup(value)?.label ?? "";
}

/**
 * `lookup`: the stored value is `{ value, label }` (the key and the text the user sees). `toText`
 * copies the label; `fromText` resolves a pasted label or key against the options the editor
 * listed or `toText` wrote (copy, export, fill source), else follows `unresolvedPaste`. Sort, quick search, and the text filter operators
 * read the label.
 */
export const lookupCellType: CellType<unknown, LookupValue, LookupOptions> = {
  Cell: LookupCell,
  Editor: LookupEditor,
  toText: (value, options) => {
    const option = readLookup(value);
    if (!option) return "";
    if (options?.fetchOptions && !isUnresolved(value)) rememberOption(options.fetchOptions, option);
    return option.label;
  },
  fromText: (text, options) => {
    const trimmed = text.trim().slice(0, MAX_LOOKUP_TEXT);
    if (trimmed === "") return null;
    const hit = options?.fetchOptions ? recallOption(options.fetchOptions, trimmed) : undefined;
    if (hit) return hit;
    return options?.unresolvedPaste === "keep" ? { value: trimmed, label: "" } : null;
  },
  clearValue: () => null,
  isEmpty: (value) => readLookup(value) === null,
  compare: (a, b) => collator.compare(labelOf(a), labelOf(b)),
  toSearchText: (value) => labelOf(value),
  filter: {
    operators: TEXT_FILTER_OPERATORS,
    match: (value, filter) => matcherFor(filter)(labelOf(value)),
  },
  align: "left",
};
