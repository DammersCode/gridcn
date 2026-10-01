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
  GRID_ATTR,
  useDataGridActions,
  useDataGridLabels,
  useDataGridScrollToCellAt,
  useDataGridSearchCapped,
  useDataGridSearchMatches,
  useDataGridSearchText,
  useDataGridVisibleColumns,
} from "@/registry/default/blocks/data-grid/data-grid";
import { useDataGridInstanceId } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Default debounce (ms) between typing and updating the store's `searchText`. */
const SEARCH_DEBOUNCE_MS = 200;

/** Props for {@link DataGridSearch}. */
export type DataGridSearchProps = {
  className?: string;
  placeholder?: string;
  /**
   * Debounce (ms) between typing and the store's `searchText` update; default 200.
   */
  debounceMs?: number;
  /**
   * "Feels native" bridge: mod+F (Ctrl+F / Cmd+F) with focus inside this grid or its
   * toolbar focuses/selects this input instead of opening the browser's find bar. Native
   * find-in-page can't work over virtualized rows (only the window's rendered rows exist in the
   * DOM), and our search already scrolls to matches — this makes mod+F reach for it directly.
   * Default `true` — when this component is mounted and focus is inside this grid, mod+F
   * unambiguously means "search this grid"; with several grids on one page, mod+F always reaches
   * the grid that holds focus, never a sibling grid's search. The listener is grid-scoped (never
   * window/document globally): focus anywhere else on the page is completely untouched, so a page's own search UI
   * or the browser's native find behave exactly as if this prop didn't exist. Pass `false` to
   * disable and always defer to the browser's native find.
   */
  captureFindShortcut?: boolean;
};

/** True when `target` sits in this grid's DOM, or in a `[data-grid-toolbar]` that holds `input`; never in a sibling grid. */
function isInsideGridScope(target: EventTarget | null, instanceId: string, input: HTMLElement | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(`[${GRID_ATTR.instance}="${instanceId}"]`) !== null) return true;
  const toolbar = target.closest(`[${GRID_ATTR.toolbar}]`);
  return toolbar !== null && input !== null && toolbar.contains(input);
}

/**
 * Quick-search input: debounced write to the store's `searchText`, a match-count badge
 * ("3/17"), and prev/next controls that step through matches in row-major order, moving the
 * active cell to the match and scrolling it into view. Enter/Shift+Enter mirror the buttons;
 * Escape clears the field and the store's search text.
 */
export function DataGridSearch(props: DataGridSearchProps): ReactNode {
  const { className, placeholder, captureFindShortcut = true, debounceMs = SEARCH_DEBOUNCE_MS } = props;
  const labels = useDataGridLabels();
  const actions = useDataGridActions();
  const searchText = useDataGridSearchText();
  const matches = useDataGridSearchMatches();
  const capped = useDataGridSearchCapped();
  const visibleColumns = useDataGridVisibleColumns();
  const scrollToCell = useDataGridScrollToCellAt();
  const instanceId = useDataGridInstanceId();

  // local input value decoupled from the store's debounced searchText, so typing never stalls.
  const [inputValue, setInputValue] = useState(searchText);
  const [matchIndex, setMatchIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // an external clear (e.g. filter reset) should resync the visible input text.
  useEffect(() => {
    setInputValue(searchText);
  }, [searchText]);

  // the match list changes shape (new search, data change) — restart navigation at the first hit,
  // during render (not in an effect) so a shrinking list never paints an out-of-range index ("2/1").
  const [lastMatches, setLastMatches] = useState(matches);
  if (lastMatches !== matches) {
    setLastMatches(matches);
    setMatchIndex(0);
  }

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // No DOM ancestor spans toolbar and root, so listen on document and gate by instance id or the toolbar holding this input.
  useEffect(() => {
    if (!captureFindShortcut) return;

    function onKeyDown(event: KeyboardEvent) {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (!isFind || !isInsideGridScope(event.target, instanceId, inputRef.current)) return;
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
  }, [captureFindShortcut, instanceId]);

  const commitSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => actions.setSearch(value), debounceMs);
    },
    [actions, debounceMs],
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
      actions.setActiveCellAt(coord);
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
