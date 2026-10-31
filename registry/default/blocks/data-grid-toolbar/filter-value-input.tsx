"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useDebouncedInput } from "@/registry/default/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useDataGridCellTypes,
  useDataGridLabels,
  type AnyColumnDef,
  type FilterOperator,
  type GridCellTypes,
} from "@/registry/default/blocks/data-grid/data-grid";
import { resolveFilterValueInput, useDataGridInputDebounce, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { distinctColumnValues } from "./distinct-values";
import { useServerFilterValues } from "./server-filter-values";
import { SetFilterList, filterSetOptions, useDebouncedSearch, type SetFilterOption } from "./set-filter-list";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { operatorIsAnyOf, operatorIsBetween } from "./operators-for-column-type";

/** Props for {@link DataGridFilterValueInput}. */
export type DataGridFilterValueInputProps = {
  /** The filtered column; its cell type's `filter.valueInput` (or the type-name default) picks the widget. */
  column: AnyColumnDef | undefined;
  operator: FilterOperator;
  value: string | [string, string] | string[] | undefined;
  onValueChange: (value: string | [string, string] | string[]) => void;
};

/** Debounces a single text/number/date input's keystrokes into one commit, with the provider's `inputDebounceMs`. */
function useFilterInput(value: string, onValueChange: (value: string) => void) {
  const delayMs = useDataGridInputDebounce();
  return useDebouncedInput(value, onValueChange, { delayMs });
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
  const { inputProps } = useFilterInput(value, onValueChange);
  return (
    <Input
      type={type}
      {...inputProps}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="h-8 w-full"
    />
  );
}

/** The `isBetween` two-input range layout. Each side debounces on its own and commits with the other side's typed text. */
function BetweenValueInput(props: {
  type: "text" | "number" | "date";
  from: string;
  to: string;
  onValueChange: (value: [string, string]) => void;
  fromAriaLabel: string;
  toAriaLabel: string;
}) {
  const { type, from, to, onValueChange, fromAriaLabel, toAriaLabel } = props;
  // Each commit sends the other side as the user sees it, pending text included, so two quick edits keep both values.
  const typedFromRef = useRef(from);
  const typedToRef = useRef(to);
  const fromInput = useFilterInput(from, (next) => onValueChange([next, typedToRef.current]));
  const toInput = useFilterInput(to, (next) => onValueChange([typedFromRef.current, next]));
  useEffect(() => {
    typedFromRef.current = fromInput.inputValue;
    typedToRef.current = toInput.inputValue;
  });

  return (
    <div className="flex items-center gap-1.5">
      <Input type={type} {...fromInput.inputProps} aria-label={fromAriaLabel} className="h-8 w-full" />
      <Input type={type} {...toInput.inputProps} aria-label={toAriaLabel} className="h-8 w-full" />
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
  const selectedLower = new Set(selected.map((value) => value.toLowerCase()));
  const toggle = (choice: string, checked: boolean) => {
    const next = new Set(selectedLower);
    if (checked) next.add(choice.toLowerCase());
    else next.delete(choice.toLowerCase());
    const choiceValues = new Set(choices.map((c) => c.value.toLowerCase()));
    // committed order is the column's own, not click order; values outside `choices` stay last
    onValueChange([...choices.map((c) => c.value).filter((v) => next.has(v.toLowerCase())), ...selected.filter((v) => !choiceValues.has(v.toLowerCase()))]);
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
            checked={selectedLower.has(choice.value.toLowerCase())}
            onCheckedChange={(checked) => toggle(choice.value, checked)}
          >
            {choice.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SetValueBody(props: { column: AnyColumnDef; selected: readonly string[]; onValueChange: (value: string[]) => void }): ReactNode {
  const { column, selected, onValueChange } = props;
  const labels = useDataGridLabels().toolbar;
  const storeApi = useDataGridStoreApi();
  const listId = useId();
  const search = useDebouncedSearch();
  const server = useServerFilterValues(column, search.query);
  const [localOptions] = useState<(SetFilterOption & { text: string })[]>(() =>
    server ? [] : distinctColumnValues(storeApi.getState(), column.id).values.map((value) => (value.key === "" ? { ...value, label: labels.headerFilterBlanks } : value)),
  );
  const options = server ? server.options : localOptions;
  const visible = server ? options : filterSetOptions(options, search.query);
  const serverLine = server?.status === "error" ? labels.headerFilterError : server?.status === "loading" && options.length === 0 ? labels.headerFilterLoading : null;
  const checked = new Set(selected.map((value) => value.toLowerCase()));

  const toggle = (key: string) => {
    const known = new Set(options.map((option) => option.key));
    const next = new Set(checked);
    if (!next.delete(key)) next.add(key);
    onValueChange([...options.filter((option) => next.has(option.key)).map((option) => option.text), ...selected.filter((value) => !known.has(value.toLowerCase()))]);
  };

  return (
    <>
      <Input
        value={search.draft}
        onChange={(event) => search.onChange(event.target.value)}
        placeholder={labels.headerFilterSearchPlaceholder}
        aria-label={labels.headerFilterSearchPlaceholder}
        className="h-8 w-full"
      />
      <SetFilterList key={search.query} options={visible} checked={checked} onToggle={toggle} onEnter={() => {}} idPrefix={listId} ariaLabel={labels.filterValueAriaLabel} />
      {serverLine && (
        <div aria-live="polite" className="text-xs text-muted-foreground">
          {serverLine}
        </div>
      )}
    </>
  );
}

/** The `isAnyOf`/`isNoneOf` input for a column without `choices`: a popover list of the column's distinct values. Values outside the list stay in the selection. */
function SetValueInput(props: { column: AnyColumnDef; selected: readonly string[]; onValueChange: (value: string[]) => void; ariaLabel: string; summary: string }): ReactNode {
  const { ariaLabel, summary, ...body } = props;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" className="h-8 w-full justify-start font-normal" aria-label={ariaLabel}>
            <span className="truncate">{summary}</span>
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64">
        <SetValueBody {...body} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Filter-row value input: renders the widget the filtered column's cell type declares in
 * `filter.valueInput` (a number, date, true/false, choices, or text input, or the type's own
 * component), with a type-name default, and debounces text/number/date keystrokes so typing never
 * triggers a `setFilters` view-index rebuild per character. `isBetween` renders two of the
 * column's typed input side by side instead of one.
 */
export function DataGridFilterValueInput(props: DataGridFilterValueInputProps): ReactNode {
  const { column, operator, value, onValueChange } = props;
  const labels = useDataGridLabels();
  const cellTypes = useDataGridCellTypes();
  const valueInput = column ? resolveFilterValueInput(column, column.type ? cellTypes[column.type] : undefined) : "text";

  if (typeof valueInput !== "string" && column) {
    const CustomInput = valueInput;
    return <CustomInput column={column} operator={operator} value={value} onValueChange={onValueChange} />;
  }
  const inputType = valueInput === "number" ? "number" : valueInput === "date" ? "date" : "text";

  if (operatorIsAnyOf(operator)) {
    const choices = (column?.options as GridCellTypes["select"]["options"] | undefined)?.choices ?? [];
    const selected = Array.isArray(value) ? value : [];
    if (column && choices.length === 0) {
      return (
        <SetValueInput
          column={column}
          selected={selected}
          onValueChange={onValueChange}
          ariaLabel={labels.toolbar.filterValueAriaLabel}
          summary={labels.toolbar.filterValueAnyOfSummary(selected.length)}
        />
      );
    }
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

  if (valueInput === "boolean") {
    const booleanItems = [
      { value: "true", label: labels.toolbar.filterValueTrue },
      { value: "false", label: labels.toolbar.filterValueFalse },
    ];
    return (
      <Select items={booleanItems} value={textValue || null} onValueChange={(next) => onValueChange(next ?? "")}>
        <SelectTrigger className="h-8 w-full" aria-label={labels.toolbar.filterValueAriaLabel}>
          <SelectValue placeholder={labels.toolbar.filterValuePlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {booleanItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (valueInput === "choices") {
    const choices = (column?.options as GridCellTypes["select"]["options"] | undefined)?.choices ?? [];
    return (
      <Select items={choices} value={textValue || null} onValueChange={(next) => onValueChange(next ?? "")}>
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
