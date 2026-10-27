"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDataGridActions, useDataGridApi, useDataGridCellTypes, useDataGridLabels, type AnyColumnDef } from "@/registry/default/blocks/data-grid/data-grid";
import {
  GRID_ATTR,
  columnLabelText,
  forEachFilterSpec,
  isComposingKey,
  isFilterGroup,
  pruneFilterSpecs,
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

function HeaderFilterBody(props: { column: AnyColumnDef; onClose: () => void; searchRef: RefObject<HTMLInputElement | null> }): ReactNode {
  const { column, onClose, searchRef } = props;
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
    let inGroup = false;
    for (const node of state.filterState) {
      if (isFilterGroup(node)) forEachFilterSpec([node], (f) => void (inGroup = inGroup || f.columnId === column.id));
    }
    return { ...distinct, inGroup, partial: distinct.hasHoles || state.sortMode === "server", keys, texts, openFilters: state.filterState, initiallyChecked: checkedKeysFromFilters(state.filterState, column.id, keys) };
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
    const typed = filterSetOptions(options, search.draft);
    setChecked((current) => {
      const next = new Set(current);
      const allChecked = typed.length > 0 && typed.every((option) => next.has(option.key));
      for (const option of typed) {
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
    actions.setFilters(pruneFilterSpecs(storeApi.getState().filterState, (filter) => filter.columnId !== column.id));
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

  const status = tooMany ? labels.headerFilterTooManySelected(MAX_SET_FILTER_ENTRIES) : loaded.capped ? labels.headerFilterCapped : labels.headerFilterSelectedCount(checkedVisible, visible.length);
  const selectAllState = visible.length > 0 && checkedVisible === visible.length ? true : checkedVisible > 0 ? "mixed" : false;

  return (
    <>
      <InputGroup>
        <InputGroupAddon align="inline-start" onClick={() => searchRef.current?.focus()}>
          <Checkbox
            aria-label={labels.headerFilterSelectAll}
            checked={selectAllState === true}
            indeterminate={selectAllState === "mixed"}
            onCheckedChange={toggleVisible}
            onClick={(event) => event.stopPropagation()}
          />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
          value={search.draft}
          onChange={(event) => search.onChange(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={labels.headerFilterSearchPlaceholder}
          aria-label={labels.headerFilterSearchPlaceholder}
        />
      </InputGroup>
      <SetFilterList key={query} options={visible} checked={checked} onToggle={toggle} onEnter={apply} idPrefix={listId} ariaLabel={columnLabelText(column)} listRef={listRef} />
      <div aria-live="polite" className={cn("text-xs text-muted-foreground", tooMany && "text-destructive")}>
        <bdi>{status}</bdi>
      </div>
      {loaded.partial && <div className="text-xs text-muted-foreground">{labels.headerFilterLoadedRowsOnly}</div>}
      {loaded.inGroup && <div className="text-xs text-muted-foreground">{labels.headerFilterGroupRows}</div>}
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
  const searchRef = useRef<HTMLInputElement>(null);
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
        initialFocus={searchRef}
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
        <HeaderFilterBody column={column} onClose={() => setOpen(false)} searchRef={searchRef} />
      </PopoverContent>
    </Popover>
  );
}
