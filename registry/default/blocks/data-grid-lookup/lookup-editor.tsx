"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebouncedInput } from "@/registry/default/hooks/use-debounce";
import { useCommitGuard, type CellEditorProps } from "@/registry/default/blocks/data-grid/data-grid";
import { columnLabelText, deepMergeLabels, isComposingKey, useDataGridInputDebounce, useDataGridStoreApi } from "@/registry/default/blocks/data-grid/data-grid-sdk";
import {
  adoptOwner,
  DEFAULT_LABELS,
  MAX_LOOKUP_TEXT,
  readLookup,
  rememberOption,
  sanitizeOptions,
  type LookupOption,
  type LookupOptions,
  type LookupValue,
} from "./lookup-model";

type Fetched = { status: "idle" | "loading" | "ready" | "error"; options: readonly LookupOption[] };

/** Opens on edit start. Typing searches `fetchOptions` after a pause; arrow keys move, Enter or a click picks, Escape cancels. */
export function LookupEditor(props: CellEditorProps<unknown, LookupValue, LookupOptions>) {
  const { value, options, onChange, commit, cancel, column, pending, rejectionCount, initialText, row, rowId } = props;
  const labels = deepMergeLabels(DEFAULT_LABELS, options?.labels);
  const minQueryLength = Math.max(0, options?.minQueryLength ?? 0);
  const providerDelay = useDataGridInputDebounce();
  const delayMs = options?.debounceMs ?? providerDelay;
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useCommitGuard();
  const current = readLookup(value);

  const lastRejectionCount = useRef(rejectionCount ?? 0);
  useEffect(() => {
    if ((rejectionCount ?? 0) !== lastRejectionCount.current) committed.reset();
    lastRejectionCount.current = rejectionCount ?? 0;
  }, [rejectionCount, committed]);

  const [query, setQuery] = useState((initialText ?? "").slice(0, MAX_LOOKUP_TEXT));
  const input = useDebouncedInput(query, setQuery, { delayMs });
  const [fetched, setFetched] = useState<Fetched>({ status: "idle", options: [] });
  const [active, setActive] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(options);
  const target = useRef({ row, rowId, columnId: column.id });
  const grid = useDataGridStoreApi();
  useLayoutEffect(() => {
    if (options?.fetchOptions) adoptOwner(grid, column.id, options.fetchOptions);
    latest.current = options;
    target.current = { row, rowId, columnId: column.id };
  });

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  useEffect(() => {
    const fetchOptions = latest.current?.fetchOptions;
    if (!fetchOptions || query.length < minQueryLength) {
      setFetched({ status: "idle", options: [] });
      return;
    }
    const controller = new AbortController();
    setFetched((prev) => ({ status: "loading", options: prev.options }));
    new Promise<unknown>((resolve) => resolve(fetchOptions({ query, signal: controller.signal, ...target.current })))
      .then((answer) => {
        if (controller.signal.aborted) return;
        const list = sanitizeOptions(answer, latest.current?.maxResults);
        for (const option of list) rememberOption(latest.current?.fetchOptions ?? fetchOptions, option);
        setFetched({ status: "ready", options: list });
        setActive(0);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFetched((prev) => ({ status: "error", options: prev.options }));
      });
    return () => controller.abort();
  }, [query, minQueryLength, attempt]);

  const pick = (option: LookupOption) => {
    if (!committed.tryCommit()) return;
    onChange(option);
    commit({ dx: 0, dy: 0 });
  };

  const typingPending = input.inputValue !== query;
  const list = fetched.options;
  const activeOption = list[Math.min(active, list.length - 1)];
  const optionId = (index: number) => `${listId}-${index}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (list.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (Math.min(index, list.length - 1) + step + list.length) % list.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (typingPending) input.flush();
      else if (activeOption && fetched.status === "ready") pick(activeOption);
      return;
    }
    if (event.key === "Escape") {
      if (committed.tryCommit()) cancel();
      return;
    }
    input.inputProps.onKeyDown(event);
  };

  let statusText = "";
  if (query.length < minQueryLength) statusText = labels.typeMore(minQueryLength - query.length);
  else if (fetched.status === "loading") statusText = labels.searching;
  else if (fetched.status === "error") statusText = labels.error;
  else if (fetched.status === "ready" && list.length === 0) statusText = labels.noResults;

  return (
    <Popover
      open
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key" && isComposingKey(details.event)) {
          details.cancel();
          return;
        }
        if (!next && committed.tryCommit()) cancel();
      }}
    >
      <PopoverTrigger nativeButton={false} render={<span className="block w-full min-w-0 truncate" />}>
        {current?.label ?? ""}
      </PopoverTrigger>
      <PopoverContent data-grid-cell-editor="" align="start" className="w-64 gap-0 p-0 data-open:animate-none data-closed:animate-none">
        <div className="p-1.5">
          <Input
            ref={inputRef}
            {...input.inputProps}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={list.length > 0}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={activeOption ? optionId(Math.min(active, list.length - 1)) : undefined}
            aria-label={columnLabelText(column)}
            aria-busy={pending || fetched.status === "loading" || undefined}
            readOnly={pending}
            maxLength={MAX_LOOKUP_TEXT}
            dir="auto"
            placeholder={current?.label}
            className="h-8 w-full border-none bg-transparent px-2 shadow-none outline-none focus-visible:ring-0"
          />
        </div>
        <ul id={listId} role="listbox" aria-label={columnLabelText(column)} className={cn("max-h-60 overflow-auto p-1", list.length === 0 && "hidden")}>
          {list.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === Math.min(active, list.length - 1)}
              data-active={index === Math.min(active, list.length - 1) ? "" : undefined}
              data-current={option.value === current?.value ? "" : undefined}
              className="cursor-default truncate rounded-md px-2 py-1.5 text-sm data-active:bg-accent data-active:text-accent-foreground data-current:font-medium"
              onPointerDown={(event) => event.preventDefault()}
              onPointerEnter={() => setActive(index)}
              onClick={() => pick(option)}
            >
              <bdi>{option.label}</bdi>
            </li>
          ))}
        </ul>
        <div role="status" aria-live="polite" className={cn("flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground", statusText === "" && "sr-only")}>
          <span>{statusText}</span>
          {fetched.status === "error" && (
            <Button type="button" size="xs" variant="ghost" onClick={() => setAttempt((n) => n + 1)}>
              {labels.retry}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
