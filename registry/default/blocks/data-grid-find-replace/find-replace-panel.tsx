"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const matches = useDataGridSearchMatches();
  const capped = useDataGridSearchCapped();
  const searchedText = useDataGridSearchText();
  const scrollToCell = useDataGridScrollToCellAt();

  const [find, setFind] = useState(() => api.store.getState().searchText);
  const [replacement, setReplacement] = useState("");
  const [searchOptions, setSearchOptions] = useState(() => api.store.getState().searchOptions);
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState<Status>(null);
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 8, right: 8 });
  const findRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    findRef.current?.focus();
    findRef.current?.select();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      settleRef.current?.();
    };
  }, []);

  useLayoutEffect(() => {
    const place = () => {
      const grid = document.querySelector(`[${GRID_ATTR.instance}="${CSS.escape(instanceId)}"]`);
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      setPosition({ top: Math.max(8, rect.top + 8), right: Math.max(8, window.innerWidth - rect.right + 24) });
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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(text, searchOptions), SEARCH_DEBOUNCE_MS);
  };

  const toggle = (key: "matchCase" | "wholeCell") => {
    const next = { ...searchOptions, [key]: !searchOptions[key] };
    setSearchOptions(next);
    setStatus(null);
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
    const plan = planReplace(s, find, replacement, { ...panelStore.getOptions(), ...searchOptions, only });
    const dataBefore = s.data;
    const verdict = plan.patches.length === 0 ? null : api.actions.updateCells(plan.patches, { source: "replace", reorder: "defer" });
    if (verdict?.pending) {
      setStatus({ kind: "validating" });
      settleRef.current?.();
      const unsubscribe = api.store.subscribe((next) => {
        if (next.data === dataBefore) return;
        settleRef.current?.();
        setStatus(null);
        runSearch(find, searchOptions);
      });
      settleRef.current = () => {
        unsubscribe();
        settleRef.current = null;
      };
      return;
    }
    setStatus({
      kind: "replaced",
      replaced: verdict?.applied ?? 0,
      skipped: plan.skipped.length + (verdict?.skipped.length ?? 0),
      more: plan.remaining,
    });
    runSearch(find, searchOptions);
    if (only) {
      const left = api.store.getState().searchMatches.length;
      if (left > 0) goTo(Math.min(cursor, left - 1));
    }
  };

  const replaceOne = () => {
    const ref = refOfMatch();
    if (ref) apply(ref);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (isComposingKey(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      panelStore.close();
      api.focus();
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
  const statusText = (() => {
    if (status?.kind === "validating") return labels.validating;
    if (status?.kind === "replaced") return status.more ? `${labels.replaced(status.replaced, status.skipped)}. ${labels.moreRemain}` : labels.replaced(status.replaced, status.skipped);
    if (find.trim() === "" || searchedText !== find) return "";
    return hasMatches ? labels.position(Math.min(cursor, matches.length - 1) + 1, matches.length, capped) : labels.noMatches;
  })();

  return (
    <div
      role="dialog"
      aria-label={labels.dialogLabel}
      onKeyDown={onKeyDown}
      onCopy={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      style={{ position: "fixed", top: position.top, right: position.right, zIndex: 50 }}
      className="flex w-80 flex-col gap-2 rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground shadow-md"
    >
      <div className="flex items-center gap-1">
        <Input
          ref={findRef}
          value={find}
          maxLength={MAX_REPLACE_INPUT_LENGTH}
          onChange={(event) => onFindChange(event.target.value)}
          onKeyDown={onFindKeyDown}
          aria-label={labels.findLabel}
          placeholder={labels.findLabel}
          className="h-8"
        />
        <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.previous} disabled={!hasMatches} onClick={() => goTo(cursor - 1)}>
          <ChevronUp />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.next} disabled={!hasMatches} onClick={() => goTo(cursor + 1)}>
          <ChevronDown />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.close} onClick={() => { panelStore.close(); api.focus(); }}>
          <X />
        </Button>
      </div>
      {showReplace && (
        <div className="flex items-center gap-1">
          <Input
            value={replacement}
            maxLength={MAX_REPLACE_INPUT_LENGTH}
            onChange={(event) => setReplacement(event.target.value)}
            onKeyDown={onReplaceKeyDown}
            aria-label={labels.replaceLabel}
            placeholder={labels.replaceLabel}
            disabled={readOnly}
            className="h-8"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button type="button" size="sm" variant={searchOptions.matchCase ? "secondary" : "outline"} aria-pressed={searchOptions.matchCase} onClick={() => toggle("matchCase")}>
          {labels.matchCase}
        </Button>
        <Button type="button" size="sm" variant={searchOptions.wholeCell ? "secondary" : "outline"} aria-pressed={searchOptions.wholeCell} onClick={() => toggle("wholeCell")}>
          {labels.wholeCell}
        </Button>
        {showReplace && (
          <>
            <Button type="button" size="sm" disabled={!canReplace || !hasMatches} onClick={replaceOne}>
              {labels.replace}
            </Button>
            <Button type="button" size="sm" disabled={!canReplace || !hasMatches} onClick={() => apply(undefined)}>
              {labels.replaceAll}
            </Button>
          </>
        )}
      </div>
      <div role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
        {statusText}
      </div>
    </div>
  );
}
