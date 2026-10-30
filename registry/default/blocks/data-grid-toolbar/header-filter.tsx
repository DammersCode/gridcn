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
import { MAX_SET_FILTER_ENTRIES, checkedKeysFromFilters, planServerSetFilter, planSetFilter } from "./apply-set-filter";
import { distinctColumnValues, isOwnSetFilter } from "./distinct-values";
import { useServerFilterValues, useServerFilterValuesEnabled } from "./server-filter-values";
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

  const serverEnabled = useServerFilterValuesEnabled(column);
  const [loaded] = useState(() => {
    const state = storeApi.getState();
    let inGroup = false;
    for (const node of state.filterState) {
      if (isFilterGroup(node)) forEachFilterSpec([node], (f) => void (inGroup = inGroup || f.columnId === column.id));
    }
    if (serverEnabled) {
      return { values: [], capped: false, hasHoles: false, inGroup, partial: false, keys: [] as string[], texts: new Map<string, string>(), openFilters: state.filterState, initiallyChecked: new Set<string>() };
    }
    const distinct = distinctColumnValues(state, column.id);
    const keys = distinct.values.map((value) => value.key);
    const texts = new Map(distinct.values.map((value) => [value.key, value.text]));
    return { ...distinct, inGroup, partial: distinct.hasHoles || state.sortMode === "server" || state.filterMode === "server", keys, texts, openFilters: state.filterState, initiallyChecked: checkedKeysFromFilters(state.filterState, column.id, keys) };
  });
  const search = useDebouncedSearch();
  const { query } = search;
  const server = useServerFilterValues(column, query);
  const localOptions = useMemo<SetFilterOption[]>(
    () => loaded.values.map((value) => (value.key === "" ? { ...value, label: labels.headerFilterBlanks } : value)),
    [loaded.values, labels.headerFilterBlanks],
  );
  const options: readonly SetFilterOption[] = server ? server.options : localOptions;

  const known = server ? server.known : loaded.texts;
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const checked = useMemo<ReadonlySet<string>>(() => {
    // A server list may be partial, so without a set entry nothing starts checked.
    const hasEntry = loaded.openFilters.some((node) => isOwnSetFilter(node, column.id));
    const next = server ? (hasEntry ? checkedKeysFromFilters(loaded.openFilters, column.id, [...known.keys()]) : new Set<string>()) : new Set(loaded.initiallyChecked);
    for (const [key, on] of overrides) {
      if (on) next.add(key);
      else next.delete(key);
    }
    return next;
  }, [server, known, loaded.openFilters, loaded.initiallyChecked, column.id, overrides]);
  const [applyBlocked, setApplyBlocked] = useState(false);
  const visible = useMemo(() => (server ? options : filterSetOptions(options, query)), [server, options, query]);
  const checkedVisible = visible.reduce((count, option) => count + (checked.has(option.key) ? 1 : 0), 0);

  const allowed = resolveFilterOperators(column, cellTypes[column.type ?? "text"]);
  const planFor = (filters: typeof loaded.openFilters) =>
    server
      ? planServerSetFilter({ filters, columnId: column.id, known, checked, allowed })
      : planSetFilter({ filters, columnId: column.id, keys: loaded.keys, texts: loaded.texts, checked, allowed });
  const plan = planFor(loaded.openFilters);
  const tooMany = applyBlocked || (plan.status === "blocked" && plan.reason === "too-many");
  const canApply = plan.status !== "blocked";

  const toggle = (key: string) => {
    setApplyBlocked(false);
    setOverrides((current) => new Map(current).set(key, !checked.has(key)));
  };

  const toggleVisible = () => {
    setApplyBlocked(false);
    const typed = server ? options : filterSetOptions(options, search.draft);
    const allChecked = typed.length > 0 && typed.every((option) => checked.has(option.key));
    setOverrides((current) => {
      const next = new Map(current);
      for (const option of typed) next.set(option.key, !allChecked);
      return next;
    });
  };

  const apply = () => {
    if (!canApply) return;
    const state = storeApi.getState();
    const fresh = planFor(state.filterState);
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

  const serverLine = server?.status === "error" ? labels.headerFilterError : server?.status === "loading" && server.options.length === 0 ? labels.headerFilterLoading : null;
  const status = serverLine ?? (tooMany ? labels.headerFilterTooManySelected(MAX_SET_FILTER_ENTRIES) : (server ? server.capped : loaded.capped) ? labels.headerFilterCapped : labels.headerFilterSelectedCount(checkedVisible, visible.length));
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
