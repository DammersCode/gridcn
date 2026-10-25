"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Replace, ReplaceAll, WholeWord, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  useDataGridApi,
  useDataGridLabels,
  useDataGridReadOnly,
  useDataGridScrollToCellAt,
  useDataGridSearchText,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  GRID_ATTR,
  isComposingKey,
  useDataGridInstanceId,
  useDataGridSearchCapped,
  useDataGridSearchMatches,
} from "@/registry/default/blocks/data-grid/data-grid-sdk";
import { MAX_REPLACE_INPUT_LENGTH, planReplace, type ReplaceOptions } from "./plan-replace";

export type PanelStore = {
  getOptions(): ReplaceOptions;
  setOptions(options: ReplaceOptions): void;
  getState(): { open: boolean; mode: "find" | "replace"; openCount: number };
  subscribe(listener: () => void): () => void;
  open(mode: "find" | "replace"): void;
  setMode(mode: "find" | "replace"): void;
  close(): void;
};

type PanelProps = { panelStore: PanelStore };

type Status = { kind: "replaced"; replaced: number; skipped: number; more: boolean } | { kind: "validating" } | null;

const SEARCH_DEBOUNCE_MS = 150;

export function FindReplacePanel({ panelStore }: PanelProps): ReactNode {
  const { open, mode, openCount } = useSyncExternalStore(panelStore.subscribe, panelStore.getState, panelStore.getState);
  if (!open) return null;
  return createPortal(<PanelBody key={openCount} panelStore={panelStore} showReplace={mode === "replace"} />, document.body);
}

function PanelBody({ panelStore, showReplace }: PanelProps & { showReplace: boolean }): ReactNode {
  const api = useDataGridApi();
  const labels = useDataGridLabels().findReplace;
  const readOnly = useDataGridReadOnly();
  const instanceId = useDataGridInstanceId();
  const replaceRowId = useId();
  const matches = useDataGridSearchMatches();
  const capped = useDataGridSearchCapped();
  const searchedText = useDataGridSearchText();
  const scrollToCell = useDataGridScrollToCellAt();

  const [find, setFind] = useState(() => api.store.getState().searchText);
  const pushedTextRef = useRef(find);
  const [replacement, setReplacement] = useState("");
  const [searchOptions, setSearchOptions] = useState(() => api.store.getState().searchOptions);
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState<Status>(null);
  const [position, setPosition] = useState<{ top: number; end: number }>({ top: 8, end: 8 });
  const findRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyTokenRef = useRef(0);
  const replacedRef = useRef<Map<string, Set<string>>>(new Map());
  const [openedFromGrid] = useState(() => {
    const grid = document.querySelector(`[${GRID_ATTR.instance}="${CSS.escape(instanceId)}"]`);
    return grid !== null && grid.contains(document.activeElement);
  });

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      applyTokenRef.current++;
    };
  }, []);

  useEffect(() => {
    if (searchedText === pushedTextRef.current) return;
    pushedTextRef.current = searchedText;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    replacedRef.current.clear();
    setFind(searchedText);
    setStatus(null);
  }, [searchedText]);

  const closePanel = () => {
    panelStore.close();
    if (openedFromGrid) api.focus();
  };

  useLayoutEffect(() => {
    const place = () => {
      const grid = document.querySelector(`[${GRID_ATTR.instance}="${CSS.escape(instanceId)}"]`);
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      const top = Math.max(8, rect.top + 8);
      const end = Math.max(8, (getComputedStyle(grid).direction === "rtl" ? rect.left : window.innerWidth - rect.right) + 24);
      setPosition((current) => (current.top === top && current.end === end ? current : { top, end }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [instanceId]);

  const runSearch = useCallback(
    (text: string, options: { matchCase: boolean; wholeCell: boolean }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      pushedTextRef.current = text;
      api.actions.setSearch(text, options);
    },
    [api],
  );

  const goTo = useCallback(
    (index: number) => {
      const list = api.store.getState().searchMatches;
      if (list.length === 0) return;
      const wrapped = ((index % list.length) + list.length) % list.length;
      setCursor(wrapped);
      const match = list[wrapped]!;
      const col = api.store.getState().visibleColumns.findIndex((c) => c.id === match.columnId);
      if (col === -1) return;
      api.actions.setActiveCellAt({ col, row: match.row });
      scrollToCell({ col, row: match.row });
    },
    [api, scrollToCell],
  );

  const onFindChange = (text: string) => {
    setFind(text);
    setStatus(null);
    replacedRef.current.clear();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text, searchOptions), SEARCH_DEBOUNCE_MS);
  };

  const toggle = (key: "matchCase" | "wholeCell") => {
    const next = { ...searchOptions, [key]: !searchOptions[key] };
    setSearchOptions(next);
    setStatus(null);
    replacedRef.current.clear();
    runSearch(find, next);
  };

  const canReplace = !readOnly && find.trim() !== "";

  const refOfMatch = (): { rowId: string; columnId: string } | null => {
    const s = api.store.getState();
    const active = s.activeCell;
    const activeColumnId = active ? s.visibleColumns[active.col]?.id : undefined;
    const onActive = active && s.searchMatches.find((m) => m.row === active.row && m.columnId === activeColumnId);
    const match = onActive || s.searchMatches[cursor];
    if (!match) return null;
    const dataIndex = s.viewIndex[match.row];
    const row = dataIndex === undefined ? undefined : s.data[dataIndex];
    if (dataIndex === undefined || row === undefined) return null;
    return { rowId: s.getRowId(row, dataIndex), columnId: match.columnId };
  };

  const apply = (only: { rowId: string; columnId: string } | undefined) => {
    const s = api.store.getState();
    if (s.readOnly || s.editing !== null || find.trim() === "") return;
    const replaced = replacedRef.current;
    const skip = only ? undefined : (ref: { rowId: string; columnId: string }) => replaced.get(ref.rowId)?.has(ref.columnId) === true;
    const plan = planReplace(s, find, replacement, { ...panelStore.getOptions(), ...searchOptions, only, skip });
    if (!only) {
      if (!plan.remaining) replaced.clear();
      else for (const { rowId, columnId } of plan.patches) replaced.set(rowId, (replaced.get(rowId) ?? new Set()).add(columnId));
    }
    const verdict = plan.patches.length === 0 ? null : api.actions.updateCells(plan.patches, { source: "replace", reorder: "defer" });
    const token = ++applyTokenRef.current;
    const finish = (settled: { applied: number; skipped: readonly unknown[] } | null) => {
      setStatus({
        kind: "replaced",
        replaced: settled?.applied ?? 0,
        skipped: plan.skipped.length + (settled?.skipped.length ?? 0),
        more: plan.remaining,
      });
      runSearch(find, searchOptions);
      if (only) {
        const left = api.store.getState().searchMatches.length;
        if (left > 0) goTo(Math.min(cursor, left - 1));
      }
    };
    if (verdict?.pending) {
      setStatus({ kind: "validating" });
      void verdict.settled?.then(
        (settled) => {
          if (token === applyTokenRef.current) finish(settled);
        },
        () => {
          if (token === applyTokenRef.current) finish(null);
        },
      );
      return;
    }
    finish(verdict);
  };

  const replaceOne = () => {
    const ref = refOfMatch();
    if (ref) apply(ref);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (isComposingKey(event)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      findRef.current?.focus();
      findRef.current?.select();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    }
  };

  const onFindKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isComposingKey(event)) return;
    event.preventDefault();
    if (debounceRef.current) runSearch(find, searchOptions);
    goTo(cursor + (event.shiftKey ? -1 : 1));
  };

  const onReplaceKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || isComposingKey(event) || !canReplace) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) apply(undefined);
    else replaceOne();
  };

  const hasMatches = matches.length > 0;
  const noResults = status === null && find.trim() !== "" && searchedText === find && !hasMatches;
  const statusText = (() => {
    if (status?.kind === "validating") return labels.validating;
    if (status?.kind === "replaced") return status.more ? `${labels.replaced(status.replaced, status.skipped)}. ${labels.moreRemain}` : labels.replaced(status.replaced, status.skipped);
    if (find.trim() === "") return labels.typeToSearch;
    if (searchedText !== find) return "";
    return hasMatches ? labels.position(Math.min(cursor, matches.length - 1) + 1, matches.length, capped) : labels.noMatches;
  })();

  const optionToggle = (key: "matchCase" | "wholeCell", label: string, icon: ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={searchOptions[key]}
      data-state={searchOptions[key] ? "on" : "off"}
      onClick={() => toggle(key)}
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[Highlight] [&_svg]:size-4",
        searchOptions[key] ? "bg-primary text-primary-foreground forced-colors:border-2 forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]" : "text-muted-foreground hover:bg-muted hover:text-foreground forced-colors:border forced-colors:border-transparent",
      )}
    >
      {icon}
      {searchOptions[key] && <span aria-hidden="true" className="absolute -top-0.5 -end-0.5 size-2 rounded-full bg-primary ring-2 ring-popover forced-colors:hidden" />}
    </button>
  );

  // Not the Popover primitive: the panel docks to the grid corner without a trigger and keeps its own focus and Escape rules.
  return (
    <div
      role="dialog"
      aria-label={labels.dialogLabel}
      {...{ [GRID_ATTR.findReplacePanel]: "" }}
      onKeyDown={onKeyDown}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      style={{ position: "fixed", top: position.top, insetInlineEnd: position.end, zIndex: 50, maxWidth: `calc(100vw - ${position.end}px - 8px)` }}
      className="flex w-80 flex-col gap-1 rounded-lg bg-popover p-2 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10"
    >
      <div className="flex items-center gap-1">
        {!readOnly && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 shrink-0"
            aria-label={labels.toggleReplace}
            aria-expanded={showReplace}
            aria-controls={replaceRowId}
            onClick={() => panelStore.setMode(showReplace ? "find" : "replace")}
          >
            <ChevronRight className={showReplace ? "rotate-90" : "rtl:rotate-180"} />
          </Button>
        )}
        <div data-find-field="" className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-input bg-transparent pe-0.5 focus-within:ring-2 focus-within:ring-ring/50">
          <Input
            ref={findRef}
            value={find}
            maxLength={MAX_REPLACE_INPUT_LENGTH}
            onChange={(event) => onFindChange(event.target.value)}
            onKeyDown={onFindKeyDown}
            aria-label={labels.findLabel}
            placeholder={labels.findLabel}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {optionToggle("matchCase", labels.matchCase, <CaseSensitive />)}
          {optionToggle("wholeCell", labels.wholeCell, <WholeWord />)}
        </div>
        <Button type="button" variant="ghost" size="icon-sm" className="size-8 shrink-0" aria-label={labels.previous} title={labels.previousTitle} disabled={!hasMatches} onClick={() => goTo(cursor - 1)}>
          <ChevronUp />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="size-8 shrink-0" aria-label={labels.next} title={labels.nextTitle} disabled={!hasMatches} onClick={() => goTo(cursor + 1)}>
          <ChevronDown />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" className="size-8 shrink-0" aria-label={labels.close} title={labels.close} onClick={closePanel}>
          <X />
        </Button>
      </div>
      {showReplace && (
        <div id={replaceRowId} className="flex items-center gap-1">
          {!readOnly && <span aria-hidden="true" className="size-8 shrink-0" />}
          <Input
            value={replacement}
            maxLength={MAX_REPLACE_INPUT_LENGTH}
            onChange={(event) => {
              setReplacement(event.target.value);
              replacedRef.current.clear();
            }}
            onKeyDown={onReplaceKeyDown}
            aria-label={labels.replaceLabel}
            placeholder={labels.replaceLabel}
            disabled={readOnly}
            className="h-9 min-w-0 flex-1"
          />
          <Button type="button" variant="ghost" size="icon-sm" className="size-8 shrink-0" aria-label={labels.replace} title={labels.replace} disabled={!canReplace || !hasMatches} onClick={replaceOne}>
            <Replace />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="size-8 shrink-0" aria-label={labels.replaceAll} title={labels.replaceAll} disabled={!canReplace || !hasMatches} onClick={() => apply(undefined)}>
            <ReplaceAll />
          </Button>
        </div>
      )}
      <div role="status" aria-live="polite" title={statusText} className={cn("h-5 truncate px-1 font-mono text-xs tabular-nums", noResults ? "text-destructive" : "text-muted-foreground")}>
        {statusText}
      </div>
    </div>
  );
}
