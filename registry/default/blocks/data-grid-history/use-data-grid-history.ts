"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useDataGridApi, type DataChange, type DataGridApi, type DataGridPlugin } from "@/registry/default/blocks/data-grid/data-grid";
import { isDev, createHistory } from "@/registry/default/blocks/data-grid/data-grid-sdk";

/** Options for {@link useDataGridHistory}. */
export type UseDataGridHistoryOptions<TData> = {
  /** Maximum number of entries kept on the undo stack; oldest entries are dropped past this. */
  capacity?: number;
  /**
   * Identity of the dataset; a change between renders clears both stacks, so undo after a dataset
   * swap cannot reinsert rows from the old dataset. Omit it and reset with `clear()` instead.
   */
  datasetKey?: string | number;
  /**
   * Which `DataChange.source` values go on the undo stack. Defaults to every source except
   * `"stream"` — a 100-updates/s `updateCells` feed would otherwise evict the user's whole undo
   * stack within seconds. Pass a list to change the set, for example
   * `["edit", "paste", "fill", "delete", "row-op", "import", "stream", "app"]` to record
   * streams too. `source: "history"` (undo/redo applied through the grid) is never recorded,
   * whatever the list says — that is what keeps an undo from pushing a second entry.
   */
  recordSources?: readonly DataChange<TData>["source"][];
};

// Fires at most once per app, dev-only: undo ran over a sparse (lazy) data array.
let warnedSparseData = false;

// `Array.prototype.some` skips holes (the callback never runs for missing indices), so hole
// detection must test indices, not values.
function hasSparseHoles(data: readonly unknown[]): boolean {
  for (let i = 0; i < data.length; i++) if (!(i in data)) return true;
  return false;
}

/** Sources `useDataGridHistory` records when `recordSources` is omitted — everything a user did on purpose (`"history"` is skipped before the filter runs). */
const DEFAULT_RECORD_SOURCES: readonly DataChange<unknown>["source"][] = [
  "edit",
  "paste",
  "fill",
  "delete",
  "row-op",
  "import",
  "app",
];

/** Return value of {@link useDataGridHistory}. */
export type UseDataGridHistoryResult<TData> = {
  /** One entry of the grid's `plugins` prop — the plugin's `onDataChange` observer records the grid's data changes, its `undo`/`redo` commands back the mod+Z/mod+Shift+Z bindings, and its `Mount` hands the grid's api handle to the imperative triggers below. Stable for the hook's lifetime. An inline `plugins={[plugin]}` is fine: re-resolution is gated on entry identity (name + member references), not on the array's. */
  plugin: DataGridPlugin<TData>;
  /** Imperative undo (a toolbar button outside the keyboard bindings); no-op when nothing to undo or the grid is read-only. */
  undo: () => void;
  /** Imperative redo; see {@link UseDataGridHistoryResult.undo}. */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Number of entries on the undo stack; 0 when there is nothing to undo. */
  historySize: number;
  /** Clears both stacks. A dataset change clears them itself when `datasetKey` changes; use `clear` for an imperative reset. */
  clear: () => void;
  /**
   * Applies a programmatic change (the consumer-built op batch) to the grid as one write AND
   * registers it as one undo entry — `commitChange` with `source: "app"`, which the observer
   * records like any user gesture. No-op when the grid is not mounted yet or is read-only.
   * `label` is an optional human-readable entry label.
   */
  record: (change: DataChange<TData>, label?: string) => void;
};

/**
 * Op-based undo/redo as a grid plugin. Records the grid's own `onDataChange` stream (the observer
 * runs after the store write and after the consumer's `onDataChange`), and undoes/redoes by
 * applying the inverted op batch back through the grid's `commitChange` — one write, one emit,
 * so a controlled `data` prop sees the same change the user made.
 *
 * Design: the plugin does not take `data`/`setData` — the grid's store is the write target, and
 * the consumer's controlled-data echo (their `onDataChange` calling their own state setter)
 * stays exactly where it always was. `undo`/`redo` applied through the grid carry
 * `source: "history"`, which the observer skips, so each undo or redo records no second entry.
 */
export function useDataGridHistory<TData>(opts: UseDataGridHistoryOptions<TData>): UseDataGridHistoryResult<TData> {
  const { capacity, datasetKey, recordSources } = opts;
  const history = useMemo(() => createHistory<TData>({ capacity }), [capacity]);
  // history's canUndo/canRedo are getters on a mutable object; this forces a re-render
  // after every mutating call so callers see them update even when nothing else re-renders
  // this hook (e.g. `clear()`, or a consumer setter that dedupes identical arrays).
  const [, forceUpdate] = useState(0);

  // stale entries reference the old dataset: undo after a swap would resurrect dead rows
  const prevDatasetKey = useRef(datasetKey);
  useEffect(() => {
    if (prevDatasetKey.current === datasetKey) return;
    prevDatasetKey.current = datasetKey;
    history.clear();
    forceUpdate((n) => n + 1);
  }, [datasetKey, history]);

  const recorded = useMemo(
    () => new Set<DataChange<TData>["source"]>(recordSources ?? DEFAULT_RECORD_SOURCES),
    [recordSources],
  );
  const recordedRef = useRef(recorded);
  recordedRef.current = recorded;

  // The grid's imperative handle, stashed by the plugin's Mount (and refreshed by every
  // command/observer ctx): the imperative `undo`/`redo`/`record` triggers below run through it.
  const apiRef = useRef<DataGridApi<TData> | null>(null);

  const undo = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    // a read-only grid never applied the change it would revert (writes are gated), so popping the
    // entry would only lose it
    if (api.store.getState().readOnly) return;
    const change = history.undo();
    if (!change) return;
    // Sparse (lazy) data needs a hole-tolerant getRowId and skips evicted rows silently — flag once, not per undo.
    if (!warnedSparseData && isDev() && hasSparseHoles(api.store.getState().data)) {
      warnedSparseData = true;
      console.warn(
        "[data-grid-history] undo ran over a sparse (lazy) data array: unloaded rows are holes and their ops are skipped. Use a hole-tolerant getRowId and pass a datasetKey (or call clear()) on lazy.reset() or a dataset swap.",
      );
    }
    api.actions.commitChange(change);
    forceUpdate((n) => n + 1);
  }, [history]);

  const redo = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (api.store.getState().readOnly) return;
    const change = history.redo();
    if (!change) return;
    api.actions.commitChange(change);
    forceUpdate((n) => n + 1);
  }, [history]);

  const clear = useCallback(() => {
    history.clear();
    forceUpdate((n) => n + 1);
  }, [history]);

  const record = useCallback(
    (change: DataChange<TData>, label?: string) => {
      const api = apiRef.current;
      if (!api) return;
      // `source: "app"` tags the imperative entry (see DataChange.source); the observer records it
      api.actions.commitChange({ ...change, source: "app", ...(label !== undefined ? { label } : {}) });
      forceUpdate((n) => n + 1);
    },
    [history],
  );

  // The Mount must keep ONE identity for the hook's lifetime (a fresh component type per render
  // would remount it); the api stash touches no hook state, so a once-created closure is safe.
  const mountRef = useRef<ComponentType | null>(null);
  if (mountRef.current === null) {
    const ref = apiRef;
    mountRef.current = function HistoryApiStash(): ReactNode {
      ref.current = useDataGridApi<TData>();
      return null;
    };
  }

  const plugin = useMemo<DataGridPlugin<TData>>(
    () => ({
      name: "history",
      onDataChange: (_next, change) => {
        if (change.source === "history") return;
        if (recordedRef.current.has(change.source)) history.push(change);
        forceUpdate((n) => n + 1);
      },
      commands: {
        undo: {
          when: (ctx) => !ctx.readOnly,
          run: (ctx) => {
            apiRef.current = ctx.api;
            undo();
          },
        },
        redo: {
          when: (ctx) => !ctx.readOnly,
          run: (ctx) => {
            apiRef.current = ctx.api;
            redo();
          },
        },
      },
      Mount: mountRef.current ?? undefined,
    }),
    [history, undo, redo, mountRef.current],
  );

  return {
    plugin,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    historySize: history.size,
    clear,
    record,
  };
}
