"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { applyChange, createHistory, type DataChange } from "@/registry/default/blocks/data-grid/data-grid";

/** Options for {@link useDataGridHistory}. */
export type UseDataGridHistoryOptions<TData> = {
  /** Current data array; the hook diffs/applies against this on every render (like `data` passed to `DataGrid`). */
  data: readonly TData[];
  /** Writes the next array back to the consumer's state (e.g. a `useState` setter). */
  setData: (next: readonly TData[]) => void;
  getRowId: (row: TData, index: number) => string;
  /** Maximum number of entries kept on the undo stack; oldest entries are dropped past this. */
  capacity?: number;
  /**
   * Which `DataChange.source` values go on the undo stack. Defaults to every source except
   * `"stream"` — a 100-updates/s `updateCells` feed would otherwise evict the user's whole undo
   * stack within seconds. Pass a list to change the set, for example
   * `["edit", "paste", "fill", "delete", "row-op", "import", "stream"]` to record streams too.
   * `setData` still runs for every change, recorded or not.
   */
  recordSources?: readonly DataChange<TData>["source"][];
};

/** Sources `useDataGridHistory` records when `recordSources` is omitted — everything a user did on purpose. */
const DEFAULT_RECORD_SOURCES: readonly DataChange<unknown>["source"][] = [
  "edit",
  "paste",
  "fill",
  "delete",
  "row-op",
  "import",
  "history",
];

/** Return value of {@link useDataGridHistory}. */
export type UseDataGridHistoryResult<TData> = {
  /** Pass straight through as `DataGrid`'s `onDataChange`: records the change, then writes `next` via `setData`. */
  onDataChange: (next: readonly TData[], change: DataChange<TData>) => void;
  /** Pass as `DataGrid`'s `onUndo`. No-op when nothing to undo. */
  undo: () => void;
  /** Pass as `DataGrid`'s `onRedo`. No-op when nothing to redo. */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Clears both stacks (e.g. after regenerating/resetting the dataset). */
  clear: () => void;
};

/**
 * Op-based undo/redo wired to a consumer-owned data array. Plugs into core's
 * `onDataChange`/`onUndo`/`onRedo` extension points (PLAN §8) with no core edits.
 *
 * Design: takes `data` + `setData` (mirroring `useState`'s tuple) rather than owning
 * the array itself, so it composes with any state source (useState, a store, a server
 * mutation) — the consumer wires one setter, not a whole controlled-component contract.
 */
export function useDataGridHistory<TData>(opts: UseDataGridHistoryOptions<TData>): UseDataGridHistoryResult<TData> {
  const { data, setData, getRowId, capacity, recordSources } = opts;
  const history = useMemo(() => createHistory<TData>({ capacity }), [capacity]);
  // history's canUndo/canRedo are getters on a mutable object; this forces a re-render
  // after every mutating call so callers see them update even when `setData` alone wouldn't
  // re-render this hook (e.g. `clear()`, or a consumer setter that dedupes identical arrays).
  const [, forceUpdate] = useState(0);

  // mirrors the latest data/getRowId for undo/redo, which run outside the triggering render.
  const dataRef = useRef(data);
  dataRef.current = data;
  const getRowIdRef = useRef(getRowId);
  getRowIdRef.current = getRowId;

  const recorded = useMemo(
    () => new Set<DataChange<TData>["source"]>(recordSources ?? DEFAULT_RECORD_SOURCES),
    [recordSources],
  );

  const onDataChange = useCallback(
    (next: readonly TData[], change: DataChange<TData>) => {
      if (recorded.has(change.source)) history.push(change);
      setData(next);
      forceUpdate((n) => n + 1);
    },
    [history, setData, recorded],
  );

  const undo = useCallback(() => {
    const change = history.undo();
    if (!change) return;
    setData(applyChange(dataRef.current, change, getRowIdRef.current));
    forceUpdate((n) => n + 1);
  }, [history, setData]);

  const redo = useCallback(() => {
    const change = history.redo();
    if (!change) return;
    setData(applyChange(dataRef.current, change, getRowIdRef.current));
    forceUpdate((n) => n + 1);
  }, [history, setData]);

  const clear = useCallback(() => {
    history.clear();
    forceUpdate((n) => n + 1);
  }, [history]);

  return {
    onDataChange,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    clear,
  };
}
