"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDebouncedInput } from "@/registry/default/hooks/use-debounce";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import {
  useDataGridActions,
  useDataGridLabels,
  useDataGridScrollToCellAt,
  useDataGridSearchText,
} from "@/registry/default/blocks/data-grid/data-grid";
import {
  useDataGridInstanceId,
  useDataGridStoreApi,
  GRID_ATTR,
  isComposingKey,
  useDataGridInputDebounce,
  useDataGridSearchCapped,
  useDataGridSearchMatches,
  effectivePage,
  fullViewOf,
  pageStartOf,
} from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Props for {@link DataGridSearch}. */
export type DataGridSearchProps = {
  className?: string;
  placeholder?: string;
  /**
   * Debounce (ms) between typing and the store's `searchText` update. Default: the provider's `inputDebounceMs` (200).
   */
  debounceMs?: number;
  /**
   * Mod+F (Ctrl+F / Cmd+F) with focus inside this grid or its toolbar focuses or selects this input
   * instead of opening the browser's find bar, which cannot reach virtualized rows. The listener sits
   * on `document` and acts only when focus is in this grid or its toolbar, so a sibling grid and the
   * rest of the page keep the browser's find. Default `true`; `false` always leaves Mod+F to the browser.
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
  const { className, placeholder, captureFindShortcut = true, debounceMs } = props;
  const labels = useDataGridLabels();
  const actions = useDataGridActions();
  const searchText = useDataGridSearchText();
  const matches = useDataGridSearchMatches();
  const capped = useDataGridSearchCapped();
  const scrollToCell = useDataGridScrollToCellAt();
  const instanceId = useDataGridInstanceId();
  const storeApi = useDataGridStoreApi();

  const providerDebounceMs = useDataGridInputDebounce();
  // the input value is decoupled from the store's debounced searchText, so typing never stalls.
  const input = useDebouncedInput(searchText, (text) => actions.setSearch(text), { delayMs: debounceMs ?? providerDebounceMs });
  const [storedIndex, setMatchIndex] = useState(0);
  const matchIndex = Math.max(0, Math.min(storedIndex, matches.length - 1));
  const inputRef = useRef<HTMLInputElement | null>(null);
  const jumpOnCommitRef = useRef<string | null>(null);

  // restart navigation at the first hit during render, not in an effect: a new query must not paint the old index
  const { matchCase, wholeCell } = storeApi.getState().searchOptions;
  const queryKey = `${JSON.stringify(searchText)}${matchCase}${wholeCell}`;
  const [lastQueryKey, setLastQueryKey] = useState(queryKey);
  if (lastQueryKey !== queryKey) {
    setLastQueryKey(queryKey);
    setMatchIndex(0);
  }

  // No DOM ancestor spans toolbar and root, so listen on document and gate by instance id or the toolbar holding this input.
  useEffect(() => {
    if (!captureFindShortcut) return;

    function onKeyDown(event: KeyboardEvent) {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (!isFind || event.defaultPrevented || !isInsideGridScope(event.target, instanceId, inputRef.current)) return;
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

  const goToMatch = useCallback(
    (index: number) => {
      const { searchMatches, visibleColumns: columns } = storeApi.getState();
      if (searchMatches.length === 0) return;
      const wrapped = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
      setMatchIndex(wrapped);
      const match = searchMatches[wrapped]!; // wrapped is modulo'd into [0, searchMatches.length)
      const col = columns.findIndex((c) => c.id === match.columnId);
      if (col === -1) return;
      const paged = storeApi.getState().pageSize;
      let row = match.row;
      if (paged !== null) {
        const page = Math.floor(match.row / paged) + 1;
        if (effectivePage(storeApi.getState().page, fullViewOf(storeApi.getState().viewIndex).length, paged) !== page) actions.setPage(page);
        if (storeApi.getState().page !== page) return;
        row = match.row - pageStartOf(storeApi.getState().viewIndex);
      }
      const coord = { col, row };
      actions.setActiveCellAt(coord);
      scrollToCell(coord);
    },
    [actions, scrollToCell, storeApi],
  );

  // A controlled parent applies the committed text later, so the first match is known only once searchText has caught up.
  useEffect(() => {
    if (jumpOnCommitRef.current === null || jumpOnCommitRef.current !== searchText) return;
    jumpOnCommitRef.current = null;
    goToMatch(0);
  }, [searchText, matches, goToMatch]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      jumpOnCommitRef.current = null;
      input.cancel();
      actions.setSearch("");
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (input.inputValue !== searchText) {
        jumpOnCommitRef.current = input.inputValue;
        input.flush();
      } else goToMatch(matchIndex + (event.shiftKey ? -1 : 1));
    }
  };

  const hasMatches = matches.length > 0;

  return (
    <div data-grid-search="" className={cn("flex h-8 items-center gap-1", className)}>
      <InputGroup className="w-72" {...{ [GRID_ATTR.keepFocus]: "" }}>
        <InputGroupAddon align="inline-start">
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          ref={inputRef}
          {...input.inputProps}
          onChange={(event) => {
            jumpOnCommitRef.current = null;
            input.inputProps.onChange(event);
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? labels.toolbar.searchPlaceholder}
          aria-label={labels.toolbar.searchAriaLabel}
        />
        {searchText.trim() !== "" && (
          <InputGroupAddon align="inline-end">
            <span data-grid-search-count="" role="status" aria-live="polite" className="min-w-fit text-xs tabular-nums">
              {hasMatches
                ? capped
                  ? labels.toolbar.searchMatchesCapped(matchIndex + 1)
                  : labels.toolbar.searchMatches(matchIndex + 1, matches.length)
                : labels.toolbar.searchNoMatches}
            </span>
          </InputGroupAddon>
        )}
      </InputGroup>
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
