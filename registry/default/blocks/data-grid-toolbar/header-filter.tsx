"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDataGridActions, useDataGridApi, useDataGridCellTypes, useDataGridLabels, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import {
  GRID_ATTR,
  columnLabelText,
  isComposingKey,
  resolveFilterOperators,
  useDataGridIsColumnFiltered,
  useDataGridStoreApi,
} from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_SET_FILTER_ENTRIES, checkedKeysFromFilters, planSetFilter } from "./apply-set-filter";
import { distinctColumnValues } from "./distinct-values";
import { SetFilterList, filterSetOptions, useDebouncedSearch, type SetFilterOption } from "./set-filter-list";

/** Props for {@link DataGridHeaderFilter} — matches the core's `renderHeaderFilter` render-prop ctx exactly. */
export type DataGridHeaderFilterProps = {
  column: AnyColumnDef;
  index: number;
};

function HeaderFilterBody(props: { column: AnyColumnDef; onClose: () => void }): ReactNode {
  const { column, onClose } = props;
  const labels = useDataGridLabels().toolbar;
  const cellTypes = useDataGridCellTypes();
  const storeApi = useDataGridStoreApi();
  const actions = useDataGridActions();
  const filtered = useDataGridIsColumnFiltered(column.id);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const [loaded] = useState(() => {
    const state = storeApi.getState();
    const distinct = distinctColumnValues(state, column.id);
    const keys = distinct.values.map((value) => value.key);
    const texts = new Map(distinct.values.map((value) => [value.key, value.text]));
    return { ...distinct, partial: distinct.hasHoles || state.sortMode === "server", keys, texts, openFilters: state.filterState, initiallyChecked: checkedKeysFromFilters(state.filterState, column.id, keys) };
  });
  const options = useMemo<SetFilterOption[]>(
    () => loaded.values.map((value) => (value.key === "" ? { ...value, label: labels.headerFilterBlanks } : value)),
    [loaded.values, labels.headerFilterBlanks],
  );

  const [checked, setChecked] = useState<ReadonlySet<string>>(loaded.initiallyChecked);
  const [applyBlocked, setApplyBlocked] = useState(false);
  const search = useDebouncedSearch();
  const { query } = search;
  const visible = useMemo(() => filterSetOptions(options, query), [options, query]);
  const checkedVisible = visible.reduce((count, option) => count + (checked.has(option.key) ? 1 : 0), 0);

  const allowed = resolveFilterOperators(column, cellTypes[column.type ?? "text"]);
  const plan = planSetFilter({ filters: loaded.openFilters, columnId: column.id, keys: loaded.keys, texts: loaded.texts, checked, allowed });
  const tooMany = applyBlocked || (plan.status === "blocked" && plan.reason === "too-many");
  const canApply = plan.status !== "blocked";

  const toggle = (key: string) => {
    setApplyBlocked(false);
    setChecked((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const toggleVisible = () => {
    setApplyBlocked(false);
    setChecked((current) => {
      const next = new Set(current);
      const allChecked = visible.length > 0 && visible.every((option) => next.has(option.key));
      for (const option of visible) {
        if (allChecked) next.delete(option.key);
        else next.add(option.key);
      }
      return next;
    });
  };

  const apply = () => {
    if (!canApply) return;
    const state = storeApi.getState();
    const fresh = planSetFilter({ filters: state.filterState, columnId: column.id, keys: loaded.keys, texts: loaded.texts, checked, allowed });
    if (fresh.status === "blocked") {
      setApplyBlocked(true);
      return;
    }
    if (fresh.status === "apply") actions.setFilters(fresh.filters);
    onClose();
  };

  const clear = () => {
    actions.setFilters(storeApi.getState().filterState.filter((filter) => filter.columnId !== column.id));
    onClose();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event)) return;
    if (event.key === "ArrowDown" && visible.length > 0) {
      event.preventDefault();
      listRef.current?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  };

  const status = tooMany ? labels.headerFilterTooManySelected(MAX_SET_FILTER_ENTRIES) : loaded.capped ? labels.headerFilterCapped : labels.headerFilterValueCount(visible.length, options.length);
  const selectAllState = visible.length > 0 && checkedVisible === visible.length ? true : checkedVisible > 0 ? "mixed" : false;

  return (
    <>
      <Input
        value={search.draft}
        onChange={(event) => search.onChange(event.target.value)}
        onKeyDown={onSearchKeyDown}
        placeholder={labels.headerFilterSearchPlaceholder}
        aria-label={labels.headerFilterSearchPlaceholder}
        className="h-8 w-full"
      />
      <button
        type="button"
        aria-pressed={selectAllState}
        disabled={visible.length === 0}
        onClick={toggleVisible}
        className="flex h-7 items-center gap-2 rounded-sm px-1.5 text-start text-sm outline-hidden hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <Checkbox
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none"
          checked={selectAllState === true}
          indeterminate={selectAllState === "mixed"}
        />
        {labels.headerFilterSelectAll}
      </button>
      <SetFilterList key={query} options={visible} checked={checked} onToggle={toggle} onEnter={apply} idPrefix={listId} ariaLabel={columnLabelText(column)} listRef={listRef} />
      <div aria-live="polite" className={cn("text-xs text-muted-foreground", tooMany && "text-destructive")}>
        {status}
      </div>
      {loaded.partial && <div className="text-xs text-muted-foreground">{labels.headerFilterLoadedRowsOnly}</div>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!filtered} onClick={clear}>
          {labels.headerFilterClear}
        </Button>
        <Button type="button" size="sm" disabled={!canApply} onClick={apply}>
          {labels.headerFilterApply}
        </Button>
      </div>
    </>
  );
}

/**
 * The per-column set filter: a header button that opens a popover with a searchable, countable
 * list of the column's distinct values. Wire via
 * `<DataGridRoot renderHeaderFilter={(ctx) => <DataGridHeaderFilter {...ctx} />}>`.
 */
export function DataGridHeaderFilter(props: DataGridHeaderFilterProps): ReactNode {
  const { column } = props;
  const labels = useDataGridLabels().toolbar;
  const filtered = useDataGridIsColumnFiltered(column.id);
  const api = useDataGridApi();
  const [open, setOpen] = useState(false);
  const keyboardOpenedRef = useRef(false);
  const columnLabel = columnLabelText(column);

  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        if (next) keyboardOpenedRef.current = (details.event?.target as HTMLElement | null)?.hasAttribute(GRID_ATTR.keyboardOpen) ?? false;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            data-grid-header-filter-trigger=""
            tabIndex={-1}
            aria-label={labels.headerFilterAriaLabel(columnLabel, filtered)}
            className={cn("shrink-0 rounded p-0.5 pointer-coarse:p-[5px] text-muted-foreground outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50", filtered && "text-primary")}
          >
            <Filter className={cn("size-3.5", filtered && "fill-current")} />
          </button>
        }
      />
      <PopoverContent
        data-grid-header-filter-popup=""
        align="start"
        aria-label={labels.headerFilterAriaLabel(columnLabel, false)}
        className="w-64"
        onContextMenu={(event) => event.stopPropagation()}
        finalFocus={() => {
          if (!keyboardOpenedRef.current) return true;
          const active = document.activeElement;
          const focusIsFree = !active || active === document.body || active.closest("[data-grid-header-filter-popup], [data-grid-header-filter-trigger]") !== null;
          if (focusIsFree) api.focus();
          return false;
        }}
      >
        <HeaderFilterBody column={column} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
