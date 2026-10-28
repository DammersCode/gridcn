"use client";

import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export const SET_FILTER_ROW_HEIGHT = 28;
const OVERSCAN = 8;
const VIEWPORT_ROWS = 8;
const VIEWPORT_HEIGHT = SET_FILTER_ROW_HEIGHT * VIEWPORT_ROWS;

const countFormat = new Intl.NumberFormat("en-US");

export type SetFilterOption = { key: string; label: string; count: number };

const SEARCH_DEBOUNCE_MS = 150;

/** A search box value plus its debounced `query`; the timer clears on unmount. */
export function useDebouncedSearch() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onChange = (value: string) => {
    setDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(value), SEARCH_DEBOUNCE_MS);
  };
  return { draft, query, onChange };
}

/** The options whose label contains `query`, compared as plain case-insensitive text. */
export function filterSetOptions(options: readonly SetFilterOption[], query: string): readonly SetFilterOption[] {
  const needle = query.toLowerCase();
  return needle === "" ? options : options.filter((option) => option.label.toLowerCase().includes(needle));
}

export type SetFilterListProps = {
  options: readonly SetFilterOption[];
  checked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onEnter: () => void;
  idPrefix: string;
  ariaLabel: string;
  className?: string;
  listRef?: Ref<HTMLDivElement>;
};

/** Virtualized multi-select listbox with fixed-height rows; only the rows near the viewport mount. */
export function SetFilterList(props: SetFilterListProps): ReactNode {
  const { options, checked, onToggle, onEnter, idPrefix, ariaLabel, className, listRef } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const lastIndex = options.length - 1;
  const active = Math.min(activeIndex, Math.max(lastIndex, 0));

  const first = Math.max(0, Math.floor(scrollTop / SET_FILTER_ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(lastIndex, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / SET_FILTER_ROW_HEIGHT) + OVERSCAN);
  const optionId = (index: number) => `${idPrefix}-option-${index}`;

  const reveal = (list: HTMLElement, index: number) => {
    const top = index * SET_FILTER_ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + SET_FILTER_ROW_HEIGHT > list.scrollTop + VIEWPORT_HEIGHT) list.scrollTop = top + SET_FILTER_ROW_HEIGHT - VIEWPORT_HEIGHT;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = (to: number) => {
      event.preventDefault();
      const next = Math.min(Math.max(to, 0), lastIndex);
      setActiveIndex(next);
      reveal(event.currentTarget, next);
    };
    switch (event.key) {
      case "ArrowDown":
        return move(active + 1);
      case "ArrowUp":
        return move(active - 1);
      case "Home":
        return move(0);
      case "End":
        return move(lastIndex);
      case " ": {
        event.preventDefault();
        const option = options[active];
        if (option) onToggle(option.key);
        return;
      }
      case "Enter":
        event.preventDefault();
        onEnter();
        return;
    }
  };

  const toggleRef = useRef(onToggle);
  useEffect(() => {
    toggleRef.current = onToggle;
  });
  const select = useCallback((index: number, key: string) => {
    setActiveIndex(index);
    toggleRef.current(key);
  }, []);

  const rows = Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) => {
    const index = first + offset;
    const option = options[index]!;
    return (
      <SetFilterRow
        key={option.key}
        id={optionId(index)}
        optionKey={option.key}
        label={option.label}
        count={option.count}
        index={index}
        setSize={options.length}
        selected={checked.has(option.key)}
        isActive={index === active}
        onSelect={select}
      />
    );
  });

  return (
    <div
      ref={listRef}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-multiselectable="true"
      aria-activedescendant={active >= first && active <= last ? optionId(active) : undefined}
      className={cn("relative overflow-y-auto rounded-md border border-input outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50", className)}
      style={{ height: VIEWPORT_HEIGHT }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={handleKeyDown}
    >
      <div className="relative" style={{ height: options.length * SET_FILTER_ROW_HEIGHT }}>
        {rows}
      </div>
    </div>
  );
}

type SetFilterRowProps = {
  id: string;
  optionKey: string;
  label: string;
  count: number;
  index: number;
  setSize: number;
  selected: boolean;
  isActive: boolean;
  onSelect: (index: number, key: string) => void;
};

const SetFilterRow = memo(function SetFilterRow({ id, optionKey, label, count, index, setSize, selected, isActive, onSelect }: SetFilterRowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-setsize={setSize}
      aria-posinset={index + 1}
      data-active={isActive || undefined}
      className="absolute inset-x-0 flex cursor-default items-center gap-2 rounded-sm px-1.5 text-sm data-[active]:bg-accent data-[active]:text-accent-foreground"
      style={{ top: index * SET_FILTER_ROW_HEIGHT, height: SET_FILTER_ROW_HEIGHT }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(index, optionKey)}
    >
      <Checkbox checked={selected} tabIndex={-1} aria-hidden className="pointer-events-none" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="min-w-14 shrink-0 text-end text-xs text-muted-foreground tabular-nums">{countFormat.format(count)}</span>
    </div>
  );
});
