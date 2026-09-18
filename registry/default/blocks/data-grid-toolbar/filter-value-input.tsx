"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useDataGridLabels,
  type AnyColumnDef,
  type FilterOperator,
  type GridCellTypes,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { operatorIsAnyOf, operatorIsBetween } from "./operators-for-column-type";

/** Debounce (ms) between typing and committing a filter value, matching {@link DataGridSearch} (PLAN §4.6). */
const FILTER_VALUE_DEBOUNCE_MS = 200;

/** Props for {@link DataGridFilterValueInput}. */
export type DataGridFilterValueInputProps = {
  /** The filtered column, for choosing a typed input (number/date/checkbox/select) over the plain-text default. */
  column: AnyColumnDef | undefined;
  operator: FilterOperator;
  value: string | [string, string] | string[] | undefined;
  onValueChange: (value: string | [string, string] | string[]) => void;
};

/** Debounces a single text/number/date input's keystrokes into one commit, matching {@link DataGridSearch} (PLAN §4.6). */
function useDebouncedInput(value: string, onValueChange: (value: string) => void) {
  const [inputValue, setInputValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // an external change (e.g. clear all, column swap) should resync the visible text.
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setInputValue(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onValueChange(next), FILTER_VALUE_DEBOUNCE_MS);
    },
    [onValueChange],
  );

  return { inputValue, onChange };
}

/** A single debounced text/number/date value input, shared by the plain and `isBetween` (two-input) layouts. */
function SingleValueInput(props: {
  type: "text" | "number" | "date";
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const { type, value, onValueChange, ariaLabel, placeholder } = props;
  const { inputValue, onChange } = useDebouncedInput(value, onValueChange);
  return (
    <Input
      type={type}
      value={inputValue}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="h-8 w-full"
    />
  );
}

/**
 * The `isBetween` two-input range layout. Each side debounces independently (same as a lone value
 * input), but both commits read the OTHER side's value from a ref at commit time rather than closing
 * over the render-time value — two edits within the same debounce window (e.g. filling "from" then
 * "to" quickly) would otherwise race: whichever debounce fires last overwrites the other's edit with
 * the stale value it captured 200ms earlier.
 */
function BetweenValueInput(props: {
  type: "text" | "number" | "date";
  from: string;
  to: string;
  onValueChange: (value: [string, string]) => void;
  fromAriaLabel: string;
  toAriaLabel: string;
}) {
  const { type, from, to, onValueChange, fromAriaLabel, toAriaLabel } = props;
  const fromRef = useRef(from);
  const toRef = useRef(to);
  fromRef.current = from;
  toRef.current = to;

  const commitFrom = useCallback((next: string) => onValueChange([next, toRef.current]), [onValueChange]);
  const commitTo = useCallback((next: string) => onValueChange([fromRef.current, next]), [onValueChange]);

  const fromInput = useDebouncedInput(from, commitFrom);
  const toInput = useDebouncedInput(to, commitTo);

  return (
    <div className="flex items-center gap-1.5">
      <Input type={type} value={fromInput.inputValue} onChange={fromInput.onChange} aria-label={fromAriaLabel} className="h-8 w-full" />
      <Input type={type} value={toInput.inputValue} onChange={toInput.onChange} aria-label={toAriaLabel} className="h-8 w-full" />
    </div>
  );
}

/**
 * The `isAnyOf` multi-choice input: a dropdown of the select column's own `choices`, each a
 * checkbox. Commits immediately (no debounce — a click is already a deliberate, discrete choice,
 * unlike a keystroke).
 */
function AnyOfValueInput(props: {
  choices: readonly { value: string; label: string }[];
  selected: readonly string[];
  onValueChange: (value: string[]) => void;
  ariaLabel: string;
  summary: string;
}) {
  const { choices, selected, onValueChange, ariaLabel, summary } = props;
  const toggle = (choice: string, checked: boolean) => {
    // rebuild from `choices` so the committed order is the column's own, not click order
    const next = new Set(selected);
    if (checked) next.add(choice);
    else next.delete(choice);
    onValueChange(choices.map((c) => c.value).filter((v) => next.has(v)));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="h-8 w-full justify-start font-normal" aria-label={ariaLabel}>
            <span className="truncate">{summary}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        {choices.map((choice) => (
          <DropdownMenuCheckboxItem
            key={choice.value}
            checked={selected.includes(choice.value)}
            onCheckedChange={(checked) => toggle(choice.value, checked)}
          >
            {choice.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Filter-row value input: renders a typed input per the filtered column's cell type — number columns
 * get `<Input type="number">`, date columns a date input, checkbox columns a true/false select, select
 * columns a select of their own choices, everything else plain text — and debounces text/number/date
 * keystrokes so typing never triggers a `setFilters` view-index rebuild per character (PLAN §4.6).
 * `isBetween` renders two of the column's typed input side by side instead of one.
 */
export function DataGridFilterValueInput(props: DataGridFilterValueInputProps): ReactNode {
  const { column, operator, value, onValueChange } = props;
  const labels = useDataGridLabels();
  const columnType = column?.type;

  if (operatorIsAnyOf(operator)) {
    const choices = (column?.options as GridCellTypes["select"]["options"] | undefined)?.choices ?? [];
    const selected = Array.isArray(value) ? value : [];
    return (
      <AnyOfValueInput
        choices={choices}
        selected={selected}
        onValueChange={onValueChange}
        ariaLabel={labels.toolbar.filterValueAriaLabel}
        summary={labels.toolbar.filterValueAnyOfSummary(selected.length)}
      />
    );
  }

  if (operatorIsBetween(operator)) {
    const [from = "", to = ""] = Array.isArray(value) ? value : ["", ""];
    const inputType = columnType === "number" ? "number" : columnType === "date" ? "date" : "text";
    return (
      <BetweenValueInput
        type={inputType}
        from={from}
        to={to}
        onValueChange={onValueChange}
        fromAriaLabel={labels.toolbar.filterValueFromAriaLabel}
        toAriaLabel={labels.toolbar.filterValueToAriaLabel}
      />
    );
  }

  const textValue = typeof value === "string" ? value : "";

  if (columnType === "checkbox") {
    return (
      <Select value={textValue} onValueChange={(next) => onValueChange(next ?? "")}>
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterValueAriaLabel}>
          <SelectValue placeholder={labels.toolbar.filterValuePlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{labels.toolbar.filterValueTrue}</SelectItem>
          <SelectItem value="false">{labels.toolbar.filterValueFalse}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (columnType === "select") {
    const choices = (column?.options as GridCellTypes["select"]["options"] | undefined)?.choices ?? [];
    return (
      <Select value={textValue} onValueChange={(next) => onValueChange(next ?? "")}>
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterValueAriaLabel}>
          <SelectValue placeholder={labels.toolbar.filterValuePlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const inputType = columnType === "number" ? "number" : columnType === "date" ? "date" : "text";
  return (
    <SingleValueInput
      type={inputType}
      value={textValue}
      onValueChange={onValueChange}
      ariaLabel={labels.toolbar.filterValueAriaLabel}
      placeholder={labels.toolbar.filterValuePlaceholder}
    />
  );
}
