"use client";

import { CellSpan, type CellRenderProps, type CellType } from "@/registry/default/blocks/data-grid/data-grid";
import { createFilterMatcher } from "@/registry/default/blocks/data-grid/data-grid";
import type { FilterSpec } from "@/registry/default/blocks/data-grid/data-grid";
import { SET_FILTER_OPERATORS, TEXT_FILTER_OPERATORS, sortCollator, UnparseableTextError, useOptionalDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { LookupEditor } from "./lookup-editor";
import { adoptOwner, isUnresolved, MAX_LOOKUP_TEXT, readLookup, MAX_KNOWN_LABELS, recallOption, rememberOption, sanitizeOptions, type LookupOptions, type LookupValue } from "./lookup-model";

function LookupCell({ value, options, columnId }: CellRenderProps<unknown, LookupValue, LookupOptions>) {
  const grid = useOptionalDataGridStoreApi();
  if (grid && options?.fetchOptions) adoptOwner(grid, columnId, options.fetchOptions, options.labelCacheKey);
  const option = readLookup(value);
  if (!option) return <CellSpan text="" />;
  // a shown label pastes back to its key, also from outside the grid
  if (options?.fetchOptions && !isUnresolved(value)) rememberOption(options.fetchOptions, option);
  if (isUnresolved(value)) {
    return (
      <span data-unresolved="" className="block w-full truncate text-muted-foreground">
        <bdi>{option.label}</bdi>
      </span>
    );
  }
  return <CellSpan text={option.label} />;
}

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
 * listed, a cell showed, or `toText` wrote (copy, export, print, fill source, autosize, filter value list), else follows `unresolvedPaste`. Sort, quick search, and the text filter operators
 * read the label; `isAnyOf` and `isNoneOf` match the stored key or the label, so a server that lists keys and a client list of labels both work.
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
    if (options?.unresolvedPaste === "keep") return { value: trimmed, label: "" };
    if (options?.unresolvedPaste === "clear") return null;
    throw new UnparseableTextError("no known option");
  },
  resolveTexts: (texts, options, { signal }) => {
    const { fetchOptions, resolveLabels } = options ?? {};
    if (!fetchOptions || !resolveLabels) return;
    const unknown = new Set<string>();
    for (const text of texts) {
      const label = text.trim().slice(0, MAX_LOOKUP_TEXT);
      if (label !== "" && !recallOption(fetchOptions, label) && unknown.size < MAX_KNOWN_LABELS) unknown.add(label);
    }
    if (unknown.size === 0) return;
    return resolveLabels({ labels: [...unknown], signal }).then((answer) => {
      for (const option of sanitizeOptions(answer, unknown.size, MAX_KNOWN_LABELS)) rememberOption(fetchOptions, option);
    });
  },
  clearValue: () => null,
  isEmpty: (value) => readLookup(value) === null,
  compare: (a, b) => sortCollator().compare(labelOf(a), labelOf(b)),
  toSearchText: (value) => labelOf(value),
  filter: {
    operators: [...TEXT_FILTER_OPERATORS, ...SET_FILTER_OPERATORS],
    match: (value, filter) => {
      const matches = matcherFor(filter);
      const label = labelOf(value);
      if (filter.operator === "isAnyOf") return matches(label) || matches(readLookup(value)?.value ?? "");
      if (filter.operator === "isNoneOf") return matches(label) && matches(readLookup(value)?.value ?? "");
      return matches(label);
    },
  },
  align: "start",
};
