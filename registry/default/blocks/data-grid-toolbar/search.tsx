"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useDataGridActions,
  useDataGridLabels,
  useDataGridScrollToCell,
  useDataGridSearchCapped,
  useDataGridSearchMatches,
  useDataGridSearchText,
  useDataGridVisibleColumns,
  gridAttrSelector,
} from "@/registry/default/blocks/data-grid/data-grid";

/** Debounce (ms) between typing and updating the store's `searchText` (PLAN §3). */
const SEARCH_DEBOUNCE_MS = 200;

/** Props for {@link DataGridSearch}. */
export type DataGridSearchProps = {
  className?: string;
  placeholder?: string;
  /**
   * "Feels native" bridge (workplan #54): mod+F (Ctrl+F / Cmd+F) with focus inside the grid or its
   * toolbar focuses/selects this input instead of opening the browser's find bar. Native
   * find-in-page can't work over virtualized rows (only the window's rendered rows exist in the
   * DOM), and our search already scrolls to matches — this makes mod+F reach for it directly.
   * Default `true` — when this component is mounted and focus is inside the grid, mod+F
   * unambiguously means "search this grid". The listener is grid-scoped (never window/document
   * globally): focus anywhere else on the page is completely untouched, so a page's own search UI
   * or the browser's native find behave exactly as if this prop didn't exist. Pass `false` to
   * disable and always defer to the browser's native find.
   */
  captureFindShortcut?: boolean;
};

/** True when `target` sits inside the grid's own DOM (the scroll/root container or the toolbar), never outside it. */
function isInsideGridScope(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(`[role="grid"], ${gridAttrSelector("toolbar")}`) !== null;
}

/**
 * Quick-search input: debounced write to the store's `searchText`, a match-count badge
 * ("3/17"), and prev/next controls that step through matches in row-major order, moving the
 * active cell to the match and scrolling it into view. Enter/Shift+Enter mirror the buttons;
 * Escape clears the field and the store's search text.
 */
export function DataGridSearch(props: DataGridSearchProps): ReactNode {
  const { className, placeholder, captureFindShortcut = true } = props;
  const labels = useDataGridLabels();
  const actions = useDataGridActions();
  const searchText = useDataGridSearchText();
  const matches = useDataGridSearchMatches();
  const capped = useDataGridSearchCapped();
  const visibleColumns = useDataGridVisibleColumns();
  const scrollToCell = useDataGridScrollToCell();

  // local input value decoupled from the store's debounced searchText, so typing never stalls.
  const [inputValue, setInputValue] = useState(searchText);
  const [matchIndex, setMatchIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // an external clear (e.g. filter reset) should resync the visible input text.
  useEffect(() => {
    setInputValue(searchText);
  }, [searchText]);

  // the match list changes shape (new search, data change) — restart navigation at the first hit.
  useEffect(() => {
    setMatchIndex(0);
  }, [matches]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Grid-scoped mod+F capture: no DOM ancestor spans both the toolbar and DataGridRoot (siblings
  // under DataGridProvider, which renders no wrapper element), so this listens on `document` and
  // gates on isInsideGridScope — same closest('[role="grid"]') resolution context-menu.tsx uses
  // for reaching outside DataGridRoot's own subtree. Native find is left untouched outside the grid.
  useEffect(() => {
    if (!captureFindShortcut) return;

    function onKeyDown(event: KeyboardEvent) {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (!isFind || !isInsideGridScope(event.target)) return;
      event.preventDefault();
      const input = inputRef.current;
      if (!input) return;
      if (document.activeElement === input) {
        input.select();
      } else {
        input.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [captureFindShortcut]);

  const commitSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => actions.setSearch(value), SEARCH_DEBOUNCE_MS);
    },
    [actions],
  );

  const goToMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) return;
      const wrapped = ((index % matches.length) + matches.length) % matches.length;
      setMatchIndex(wrapped);
      const match = matches[wrapped]!; // wrapped is modulo'd into [0, matches.length)
      const col = visibleColumns.findIndex((c) => c.id === match.columnId);
      if (col === -1) return;
      const coord = { col, row: match.row };
      actions.setActiveCell(coord);
      scrollToCell(coord);
    },
    [actions, scrollToCell, matches, visibleColumns],
  );

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setInputValue(event.target.value);
      commitSearch(event.target.value);
    },
    [commitSearch],
  );

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setInputValue("");
    actions.setSearch("");
  }, [actions]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        clear();
      } else if (event.key === "Enter") {
        event.preventDefault();
        goToMatch(matchIndex + (event.shiftKey ? -1 : 1));
      }
    },
    [clear, goToMatch, matchIndex],
  );

  const hasMatches = matches.length > 0;

  return (
    <div data-grid-search="" className={cn("flex h-8 items-center gap-1", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute inset-s-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? labels.toolbar.searchPlaceholder}
          aria-label={labels.toolbar.searchAriaLabel}
          className="h-8 w-56 ps-7"
        />
      </div>
      {searchText.trim() !== "" && (
        <span
          data-grid-search-count=""
          role="status"
          aria-live="polite"
          className="min-w-fit shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {hasMatches
            ? capped
              ? labels.toolbar.searchMatchesCapped(matchIndex + 1)
              : labels.toolbar.searchMatches(matchIndex + 1, matches.length)
            : labels.toolbar.searchNoMatches}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.toolbar.searchPreviousMatch}
        disabled={!hasMatches}
        onClick={() => goToMatch(matchIndex - 1)}
      >
        <ChevronUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={labels.toolbar.searchNextMatch}
        disabled={!hasMatches}
        onClick={() => goToMatch(matchIndex + 1)}
      >
        <ChevronDown />
      </Button>
    </div>
  );
}
